'use strict';
// SPOCK wake: seal a step list into an AES-GCM UDP frame for the ESP32 waker,
// then poll the tailnet health URL. Deps (dgram/fetch/clock) are injected for tests.

const crypto = require('crypto');
const path = require('path');

const VER = 0x01;
const OP = { KEY: 0x01, PAUSE: 0x02, TEXT: 0x03, GUI: 0x04 };
const HID = { ESCAPE: 0x29, SPACE: 0x2c, ENTER: 0x28 };
const PROBE_INTERVAL_MS = 3000;
const PROBE_TIMEOUT_MS = 2500;
const BODY_MAX = 1024;
const PIN_RE = /^[\x20-\x7e]{1,64}$/;
const PIN_WARNING = 'PIN may not have worked, check the screen';
const TIMEOUT_HINT = 'Not answering: SPOCK may be hibernated or off, PIN wrong, WSL not started after sign-in, or Windows Tailscale not in unattended mode';

// --- Frame ---

function sealFrame(key, counter, plaintext) {
  const hdr = Buffer.alloc(9);
  hdr[0] = VER;
  hdr.writeBigUInt64BE(BigInt(counter), 1);
  const nonce = Buffer.concat([Buffer.alloc(4), hdr.subarray(1)]);
  const c = crypto.createCipheriv('aes-256-gcm', key, nonce);
  c.setAAD(hdr);
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  return Buffer.concat([hdr, ct, c.getAuthTag()]);
}

const STEP_KINDS = ['key', 'gui', 'pause', 'text'];
const isByte = (v) => Number.isInteger(v) && v >= 0 && v <= 0xff;

// step: exactly one of {key}, {pause}, {text}, {gui}; text "$PIN" is replaced by the PIN.
// Exactly-one keeps the $PIN guard (looks at .text) and the encoder in agreement.
function encodeSteps(steps, pin = '') {
  return Buffer.concat(steps.map((s) => {
    const kinds = s && typeof s === 'object' ? Object.keys(s) : [];
    if (kinds.length !== 1 || !STEP_KINDS.includes(kinds[0])) throw new Error('bad step');
    if (s.key !== undefined) { if (!isByte(s.key)) throw new Error('bad key'); return Buffer.from([OP.KEY, s.key]); }
    if (s.gui !== undefined) { if (!isByte(s.gui)) throw new Error('bad gui'); return Buffer.from([OP.GUI, s.gui]); }
    if (s.pause !== undefined) {
      if (!(Number.isInteger(s.pause) && s.pause >= 0 && s.pause <= 0xffff)) throw new Error('bad pause');
      return Buffer.from([OP.PAUSE, s.pause >> 8, s.pause & 0xff]);
    }
    if (typeof s.text === 'string') {
      const txt = Buffer.from(s.text === '$PIN' ? pin : s.text, 'ascii');
      if (txt.length > 255) throw new Error('text too long');
      return Buffer.concat([Buffer.from([OP.TEXT, txt.length]), txt]);
    }
    throw new Error('bad step');
  }));
}

// Space wakes from Modern Standby (F15 does not); Escape cancels the Hello scan and focuses the PIN field.
const DEFAULT_PIN_STEPS = [
  { key: HID.SPACE }, { pause: 2000 }, { key: HID.ESCAPE }, { pause: 1000 },
  { text: '$PIN' }, { key: HID.ENTER },
];
const WAKE_STEPS = [{ key: HID.SPACE }];

// --- Waker ---

// Positive integer or the default (NaN/garbage/<=0 would break the polling loop).
function posInt(v, def) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : def;
}

function createWaker(deps) {
  const cfg = deps.config || {};
  const dgram = deps.dgram;
  const doFetch = deps.fetch;
  const now = deps.clock ? deps.clock.now : Date.now;
  const fs = deps.fs || require('fs');
  const counterFile = cfg.SPOCK_COUNTER_FILE || '';
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const baseLog = deps.log || (() => {});
  const timeoutMs = posInt(cfg.SPOCK_WAKE_TIMEOUT_MS, 120000);
  const cooldownMs = posInt(cfg.SPOCK_PIN_COOLDOWN_MS, 300000);
  const espPort = posInt(cfg.ESP_PORT, 9);
  const keyHex = cfg.FRAME_KEY || '';
  const key = /^[0-9a-fA-F]{64}$/.test(keyHex) ? Buffer.from(keyHex, 'hex') : null;
  const spockUrl = (cfg.SPOCK_URL || '').replace(/\/+$/, '');
  let pinSteps = DEFAULT_PIN_STEPS;
  if (cfg.SPOCK_STEPS_JSON) {
    try { pinSteps = JSON.parse(cfg.SPOCK_STEPS_JSON); encodeSteps(pinSteps, ''); } catch { pinSteps = null; }
  }
  const ready = !!(key && cfg.ESP_IP && spockUrl && pinSteps);

  let busy = false;
  let cooldownUntil = 0;
  let lastCounter = 0n;

  // Redacts the PIN from anything logged.
  function logger(pin) {
    return (...a) => {
      let s = a.map((x) => (x instanceof Error ? x.message : String(x))).join(' ');
      if (pin) s = s.split(pin).join('[redacted]');
      baseLog(s);
    };
  }

  async function probe(ms = PROBE_TIMEOUT_MS) {
    try {
      // SPOCK's panel answers 200 locally and 401 to everyone else; anything else
      // (proxy 5xx, redirects, 404) is not the panel.
      const r = await doFetch(`${spockUrl}/api/health`, { signal: AbortSignal.timeout(Math.max(1, ms)) });
      return !!(r && (r.status === 200 || r.status === 401));
    } catch { return false; }
  }

  // Missing file = fresh start; any other read error or bad content throws so nothing is sent.
  function readPersisted() {
    let raw;
    try { raw = fs.readFileSync(counterFile, 'utf8'); } catch (err) {
      if (err && err.code === 'ENOENT') return 0n;
      throw new Error(`counter file unreadable: ${err && err.code ? err.code : err}`);
    }
    const t = String(raw).trim();
    if (!/^\d+$/.test(t)) throw new Error('counter file invalid');
    return BigInt(t);
  }

  // temp + fsync + rename + dir fsync, so a crash cannot roll the counter back.
  function persistCounter(c) {
    const tmp = `${counterFile}.tmp`;
    const fd = fs.openSync(tmp, 'w');
    try { fs.writeSync(fd, `${c}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, counterFile);
    try {
      const dfd = fs.openSync(path.dirname(counterFile), 'r');
      try { fs.fsyncSync(dfd); } finally { fs.closeSync(dfd); }
    } catch { /* best effort: not all platforms fsync directories */ }
  }

  // Counter must never repeat for a key (GCM nonce): persisted across restarts and
  // written before the frame leaves, so a clock step back cannot reuse one.
  function nextCounter() {
    let c = BigInt(now());
    const floor = counterFile ? readPersisted() : 0n;
    if (c <= floor) c = floor + 1n;
    if (c <= lastCounter) c = lastCounter + 1n;
    if (counterFile) persistCounter(c);
    lastCounter = c;
    return c;
  }

  function sendUdp(buf) {
    return new Promise((resolve, reject) => {
      const sock = dgram.createSocket('udp4');
      let done = false;
      const close = () => { try { sock.close(); } catch { /* already closed */ } };
      const settle = (err) => {
        if (done) return;
        done = true;
        close();
        err ? reject(err) : resolve();
      };
      // close on every error, even one after settling, so the socket is never leaked
      if (sock.on) sock.on('error', (err) => { if (done) close(); else settle(err); });
      try { sock.send(buf, espPort, cfg.ESP_IP, (err) => settle(err || null)); } catch (err) { settle(err); }
    });
  }

  async function wake({ pin } = {}) {
    if (!ready) return { status: 'not_configured' };
    if (pin && !pinSteps.some((s) => s.text === '$PIN')) return { status: 'steps_missing_pin', message: 'Configured steps contain no $PIN text step' };
    if (busy) return { status: 'busy', message: 'A wake is already running' };
    if (pin && now() < cooldownUntil) {
      return { status: 'cooldown', message: PIN_WARNING, retryAfterMs: cooldownUntil - now() };
    }
    busy = true;
    const log = logger(pin);
    const t0 = now();
    let deadline;
    try {
      if (await probe()) return { status: 'already_awake', elapsedMs: now() - t0 };
      const steps = pin ? pinSteps : WAKE_STEPS;
      try {
        const frame = sealFrame(key, nextCounter(), encodeSteps(steps, pin));
        await sendUdp(frame);
      } catch (err) {
        log('spock-wake: frame not sent:', err);
        return { status: 'not_sent', message: 'frame not sent' };
      }
      // polling window starts after the send, not before the preflight probe
      deadline = now() + timeoutMs;
      log(`spock-wake: frame sent (${pin ? 'with text' : 'wake key'}), polling`);
      let probes = 0;
      for (;;) {
        if (deadline - now() <= 0) break;
        await sleep(Math.min(PROBE_INTERVAL_MS, deadline - now()));
        const left = deadline - now();
        if (left <= 0) break;
        probes++;
        const up = await probe(Math.min(PROBE_TIMEOUT_MS, left));
        if (up && now() <= deadline) return { status: 'awake', elapsedMs: now() - t0, probes };
      }
      const out = { status: 'timeout', elapsedMs: now() - t0, probes, message: TIMEOUT_HINT };
      if (pin) {
        cooldownUntil = now() + cooldownMs;
        out.message = `${PIN_WARNING}. ${TIMEOUT_HINT}`;
        out.retryAfterMs = cooldownMs;
      }
      log(`spock-wake: timeout after ${out.elapsedMs} ms`);
      return out;
    } finally {
      busy = false;
    }
  }

  return { wake, ready };
}

// --- HTTP ---

function isWakePath(pathname) {
  return pathname === '/api/spock' || pathname.startsWith('/api/spock/');
}

// On overflow: stop buffering and discard the rest, so the 413 can still be written
// (destroying the request first would reset the socket before the client reads it).
function readBodyLimited(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let over = false;
    req.on('data', (c) => {
      if (over) return;
      size += c.length;
      if (size > max) { over = true; chunks.length = 0; reject(Object.assign(new Error('too large'), { code: 413 })); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (over) return;
      const raw = Buffer.concat(chunks).toString();
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(Object.assign(new Error('bad json'), { code: 400 })); }
    });
    req.on('error', reject);
  });
}

function bearerOk(req, expected) {
  const m = (req.headers['authorization'] || '').match(/^Bearer\s+(.+)$/i);
  if (!m || !expected) return false;
  const a = Buffer.from(m[1]);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createWakeHandler({ waker, token, allowedHosts = [], now = Date.now, log = () => {}, maxFails = 5, lockMs = 60000 }) {
  const fails = new Map(); // ip -> {n, until, at}; bounded by MAX_FAIL_IPS
  const MAX_FAIL_IPS = 1000;

  function pruneFails() {
    const t = now();
    for (const [ip, e] of fails) {
      if (e.until > 0 ? e.until <= t : t - e.at > lockMs) fails.delete(ip);
    }
    while (fails.size >= MAX_FAIL_IPS) fails.delete(fails.keys().next().value);
  }

  function send(res, status, data, extra = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin', ...extra });
    res.end(JSON.stringify(data));
  }

  // Token and PIN only from pages served over HTTPS (or localhost): never cleartext on the LAN.
  function secureOrigin(req) {
    const origin = req.headers['origin'] || '';
    if (/^https:\/\//i.test(origin)) return true;
    return /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin);
  }

  function sameOrigin(req) {
    const origin = req.headers['origin'];
    if (!origin) return true;
    const host = req.headers['host'] || '';
    return origin === `http://${host}` || origin === `https://${host}`;
  }

  function hostAllowed(req) {
    const host = (req.headers['host'] || '').toLowerCase();
    const bare = host.replace(/:\d+$/, '');
    return allowedHosts.some((h) => { h = h.toLowerCase(); return h === host || h === bare; });
  }

  async function handle(req, res) {
    const pathname = (req.url || '').split('?')[0];
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Cache-Control': 'no-store', Vary: 'Origin' }); return res.end(); }
    if (!token) return send(res, 503, { error: 'Wake disabled' });
    if (pathname !== '/api/spock/wake') return send(res, 404, { error: 'Not found' });
    if (!allowedHosts.length || !hostAllowed(req) || !sameOrigin(req)) return send(res, 403, { error: 'Forbidden' });
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
    if (!secureOrigin(req)) return send(res, 403, { error: 'https_required' });

    const ip = (req.socket && req.socket.remoteAddress) || '?';
    const f = fails.get(ip);
    if (f && f.until > now()) return send(res, 429, { status: 'locked_out', error: 'Too many failed attempts', retryAfterMs: f.until - now() });
    if (!bearerOk(req, token)) {
      // a stale streak (older than lockMs) starts over
      const cur = f && f.until === 0 && now() - f.at <= lockMs ? f : { n: 0, until: 0, at: 0 };
      cur.n++;
      cur.at = now();
      if (cur.n >= maxFails) { cur.n = 0; cur.until = now() + lockMs; }
      fails.delete(ip);
      pruneFails();
      fails.set(ip, cur);
      return send(res, 401, { error: 'Unauthorized' });
    }
    fails.delete(ip);

    if (!/^application\/json/i.test(req.headers['content-type'] || '')) return send(res, 415, { error: 'Expected JSON' });
    let body;
    try { body = await readBodyLimited(req, BODY_MAX); } catch (e) {
      if (e.code === 413) return send(res, 413, { error: 'Body too large' }, { Connection: 'close' });
      return send(res, 400, { error: 'Invalid JSON' });
    }
    let pin;
    if (body && body.pin !== undefined && body.pin !== '') {
      if (typeof body.pin !== 'string' || !PIN_RE.test(body.pin)) return send(res, 400, { error: 'Invalid PIN' });
      pin = body.pin;
    }
    try {
      const r = await waker.wake({ pin });
      if (r.status === 'steps_missing_pin') return send(res, 500, { error: 'steps_missing_pin' });
      const http = { not_configured: 503, busy: 409, cooldown: 429, not_sent: 502 }[r.status] || 200;
      return send(res, http, r);
    } catch (err) {
      let m = err && err.message ? String(err.message) : 'error';
      if (pin) m = m.split(pin).join('[redacted]');
      log('spock-wake: error', m);
      return send(res, 500, { error: 'Wake failed' });
    }
  }
  handle._failsSize = () => fails.size;
  return handle;
}

module.exports = { sealFrame, encodeSteps, createWaker, createWakeHandler, isWakePath, DEFAULT_PIN_STEPS };
