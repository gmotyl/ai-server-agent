'use strict';
// SPOCK wake: seal a step list into an AES-GCM UDP frame for the ESP32 waker,
// then poll the tailnet health URL. Deps (dgram/fetch/clock) are injected for tests.

const crypto = require('crypto');

const VER = 0x01;
const OP = { KEY: 0x01, PAUSE: 0x02, TEXT: 0x03, GUI: 0x04 };
const HID = { F15: 0x6a, ESCAPE: 0x29, SPACE: 0x2c, ENTER: 0x28 };
const PROBE_INTERVAL_MS = 3000;
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

// step: {key}, {pause}, {text}, {gui}; text "$PIN" is replaced by the PIN
function encodeSteps(steps, pin) {
  return Buffer.concat(steps.map((s) => {
    if (s.key !== undefined) return Buffer.from([OP.KEY, s.key]);
    if (s.gui !== undefined) return Buffer.from([OP.GUI, s.gui]);
    if (s.pause !== undefined) {
      if (!(s.pause >= 0 && s.pause <= 0xffff)) throw new Error('bad pause');
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

const DEFAULT_PIN_STEPS = [
  { key: HID.F15 }, { pause: 1500 }, { key: HID.ESCAPE }, { pause: 500 },
  { key: HID.SPACE }, { pause: 1200 }, { text: '$PIN' }, { key: HID.ENTER },
];
const F15_STEPS = [{ key: HID.F15 }];

// --- Waker ---

function createWaker(deps) {
  const cfg = deps.config || {};
  const dgram = deps.dgram;
  const doFetch = deps.fetch;
  const now = deps.clock ? deps.clock.now : Date.now;
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const baseLog = deps.log || (() => {});
  const timeoutMs = parseInt(cfg.SPOCK_WAKE_TIMEOUT_MS || '120000', 10);
  const cooldownMs = parseInt(cfg.SPOCK_PIN_COOLDOWN_MS || '300000', 10);
  const espPort = parseInt(cfg.ESP_PORT || '9', 10);
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

  async function probe() {
    try {
      const r = await doFetch(`${spockUrl}/api/health`, { signal: AbortSignal.timeout(2500) });
      return !!(r && r.ok);
    } catch { return false; }
  }

  function nextCounter() {
    let c = BigInt(now());
    if (c <= lastCounter) c = lastCounter + 1n;
    lastCounter = c;
    return c;
  }

  function sendUdp(buf) {
    return new Promise((resolve, reject) => {
      const sock = dgram.createSocket('udp4');
      sock.send(buf, espPort, cfg.ESP_IP, (err) => { sock.close(); err ? reject(err) : resolve(); });
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
    try {
      if (await probe()) return { status: 'already_awake', elapsedMs: now() - t0 };
      const steps = pin ? pinSteps : F15_STEPS;
      const frame = sealFrame(key, nextCounter(), encodeSteps(steps, pin));
      try {
        await sendUdp(frame);
      } catch (err) {
        log('spock-wake: frame not sent:', err);
        return { status: 'not_sent', message: 'frame not sent' };
      }
      log(`spock-wake: frame sent (${pin ? 'with text' : 'F15'}), polling`);
      let probes = 0;
      while (now() - t0 < timeoutMs) {
        await sleep(PROBE_INTERVAL_MS);
        probes++;
        if (await probe()) return { status: 'awake', elapsedMs: now() - t0, probes };
      }
      const out = { status: 'timeout', elapsedMs: now() - t0, probes, message: TIMEOUT_HINT };
      if (pin) { cooldownUntil = now() + cooldownMs; out.message = `${PIN_WARNING}. ${TIMEOUT_HINT}`; }
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

function readBodyLimited(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > max) { reject(Object.assign(new Error('too large'), { code: 413 })); req.destroy && req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
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

  function send(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin' });
    res.end(JSON.stringify(data));
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

    const ip = (req.socket && req.socket.remoteAddress) || '?';
    const f = fails.get(ip);
    if (f && f.until > now()) return send(res, 429, { error: 'Too many failed attempts' });
    if (!bearerOk(req, token)) {
      const cur = f && f.until === 0 ? f : { n: 0, until: 0, at: 0 };
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
      return send(res, e.code === 413 ? 413 : 400, { error: e.code === 413 ? 'Body too large' : 'Invalid JSON' });
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
