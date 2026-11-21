'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { EventEmitter } = require('node:events');
const http = require('node:http');
const wake = require('../spock-wake.cjs');

const vec = require('./fixtures/frame-v1.json');
const KEY_HEX = vec.keyHex;
const TOKEN = 'a'.repeat(48);
const PIN = '482915';

function open(frame, keyHex) {
  const hdr = frame.subarray(0, 9);
  const nonce = Buffer.concat([Buffer.alloc(4), hdr.subarray(1)]);
  const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), nonce);
  d.setAAD(hdr);
  d.setAuthTag(frame.subarray(frame.length - 16));
  return Buffer.concat([d.update(frame.subarray(9, frame.length - 16)), d.final()]);
}

function fakeFs(files = {}) {
  const f = { files: { ...files }, writes: [] };
  f.readFileSync = (p) => { if (!(p in f.files)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return f.files[p]; };
  f.writeFileSync = (p, d) => { f.writes.push(p); f.files[p] = String(d); };
  f.renameSync = (a, b) => { f.files[b] = f.files[a]; delete f.files[a]; };
  f.mkdirSync = () => {};
  return f;
}

function fakeEnv(over = {}) {
  const sent = [];
  const logs = [];
  let t = 1_000_000;
  const probes = { answers: [], calls: 0 };
  const env = {
    sent, logs, probes,
    clock: { now: () => t, advance: (ms) => { t += ms; } },
    config: { FRAME_KEY: KEY_HEX, ESP_IP: '192.168.1.50', SPOCK_URL: 'http://spock.ts.net:3000', SPOCK_COUNTER_FILE: '/data/ctr', ...over.config },
    dgram: {
      createSocket: () => ({
        send: (buf, port, ip, cb) => { sent.push({ buf: Buffer.from(buf), port, ip }); cb(over.sendError || null); },
        close: () => {},
      }),
    },
    fetch: async (url) => {
      probes.calls++;
      probes.url = url;
      const ans = probes.answers.length ? probes.answers.shift() : (over.defaultAnswer ?? false);
      if (ans instanceof Error) throw ans;
      // false = no HTTP reply (asleep); true = 200; a number = that HTTP status
      if (ans === false) throw new Error('timeout');
      const status = ans === true ? 200 : ans;
      return { ok: status >= 200 && status < 300, status };
    },
    sleep: async (ms) => { env.sleeps.push(ms); t += ms; },
    sleeps: [],
    fs: over.fs || fakeFs(),
    log: (...a) => logs.push(a.join(' ')),
  };
  env.waker = wake.createWaker(env);
  return env;
}

function fakeReq({ method = 'POST', headers = {}, body = '', ip = '10.0.0.9' } = {}) {
  const r = Readable.from(body ? [Buffer.from(body)] : []);
  r.method = method;
  r.url = '/api/spock/wake';
  r.headers = { host: 'foundation1:3000', origin: 'https://foundation1:3000', 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, ...headers };
  r.socket = { remoteAddress: ip };
  return r;
}

function fakeRes() {
  const res = {
    status: 0, headers: {}, body: '',
    setHeader(k, v) { res.headers[k.toLowerCase()] = v; },
    writeHead(s, h = {}) { res.status = s; for (const k of Object.keys(h)) res.headers[k.toLowerCase()] = h[k]; },
    end(b = '') { res.body += b; res.done = true; },
  };
  return res;
}

function handlerFor(env, over = {}) {
  return wake.createWakeHandler({
    waker: env.waker, token: TOKEN, allowedHosts: ['foundation1:3000'], now: env.clock.now, ...over,
  });
}

// fixture ops: tap F15, pause 500, tap Escape, Win+L, pause 1200, type "12ab"
const VEC_STEPS = [{ key: 0x6a }, { pause: 500 }, { key: 0x29 }, { gui: 0x0f }, { pause: 1200 }, { text: '12ab' }];

test('seals frame decodable by the shared vector', () => {
  const pt = wake.encodeSteps(VEC_STEPS);
  assert.equal(pt.toString('hex'), vec.plaintextHex);
  const frame = wake.sealFrame(Buffer.from(vec.keyHex, 'hex'), BigInt(vec.counter), pt);
  assert.equal(frame.toString('hex'), vec.frameHex);
  assert.equal(open(frame, vec.keyHex).toString('hex'), vec.plaintextHex);
});

test('default PIN steps encode to exact bytes ending with Enter', () => {
  const pt = wake.encodeSteps(wake.DEFAULT_PIN_STEPS, PIN);
  const pinHex = Buffer.from(PIN).toString('hex');
  assert.equal(pt.toString('hex'), `012c0207d001290203e80306${pinHex}0128`);
  assert.equal(pt.subarray(-2).toString('hex'), '0128');
});

test('rejects steps without exactly one of key/gui/pause/text', () => {
  for (const s of [{}, { key: 1, text: '$PIN' }, { gui: 1, pause: 5 }, { key: 1, gui: 2 }, { foo: 1 }, { key: 300 }, { key: -1 }, { gui: 1.5 }]) {
    assert.throws(() => wake.encodeSteps([s], PIN), undefined, JSON.stringify(s));
  }
  // a mixed step would hide $PIN from the guard: config is refused entirely
  const env = fakeEnv({ config: { SPOCK_STEPS_JSON: JSON.stringify([{ key: 0x2c, text: '$PIN' }]) } });
  assert.equal(env.waker.ready, false);
});

test('skips frame when panel already answers', async () => {
  const env = fakeEnv();
  env.probes.answers.push(true);
  const r = await env.waker.wake({});
  assert.equal(r.status, 'already_awake');
  assert.equal(env.sent.length, 0);
  assert.equal(env.probes.url, 'http://spock.ts.net:3000/api/health');
});

test('counts HTTP status below 500 as awake (panel answers 401 to non-localhost)', async () => {
  const env = fakeEnv();
  env.probes.answers.push(401);
  const r = await env.waker.wake({});
  assert.equal(r.status, 'already_awake');
  assert.equal(env.sent.length, 0);
});

test('5xx gateway reply does not count as awake', async () => {
  const env = fakeEnv();
  env.probes.answers.push(502, 503, 200);
  const r = await env.waker.wake({});
  assert.equal(r.status, 'awake');
  assert.equal(env.sent.length, 1);
  assert.equal(r.probes, 2);
});

test('sends Space-only steps without a PIN', async () => {
  const env = fakeEnv();
  env.probes.answers.push(false, false, true);
  const r = await env.waker.wake({});
  assert.equal(r.status, 'awake');
  assert.equal(env.sent.length, 1);
  assert.equal(env.sent[0].ip, '192.168.1.50');
  assert.equal(env.sent[0].port, 9);
  assert.equal(open(env.sent[0].buf, KEY_HEX).toString('hex'), '012c');
  assert.ok(r.elapsedMs >= 6000);
});

test('never logs or returns the PIN', async () => {
  const env = fakeEnv();
  env.probes.answers.push(false, true);
  const r = await env.waker.wake({ pin: PIN });
  const pt = open(env.sent[0].buf, KEY_HEX);
  assert.ok(pt.includes(Buffer.from(PIN)), 'PIN is sealed into the frame');
  // default steps: Space, pause 2000, Escape, pause 1000, then the PIN
  assert.equal(pt.subarray(0, 10).toString('hex'), '012c0207d001290203e8');
  assert.ok(!JSON.stringify(r).includes(PIN));
  assert.ok(!env.logs.join('\n').includes(PIN));
  // handler path: response and logs stay PIN-free, even when logging an error containing it
  const env2 = fakeEnv({ sendError: new Error(`boom ${PIN}`) });
  const h = handlerFor(env2);
  const res = fakeRes();
  await h(fakeReq({ body: JSON.stringify({ pin: PIN }) }), res);
  assert.equal(res.status, 502);
  assert.ok(!res.body.includes(PIN));
  assert.ok(!env2.logs.join('\n').includes(PIN));
});

test('cooldown after failed PIN wake', async () => {
  const env = fakeEnv({ config: { SPOCK_WAKE_TIMEOUT_MS: '9000', SPOCK_PIN_COOLDOWN_MS: '300000' } });
  const r = await env.waker.wake({ pin: PIN });
  assert.equal(r.status, 'timeout');
  assert.match(r.message, /PIN may not have worked, check the screen/);
  assert.equal(env.sent.length, 1);
  const r2 = await env.waker.wake({ pin: PIN });
  assert.equal(r2.status, 'cooldown');
  assert.equal(env.sent.length, 1);
  const r3 = await env.waker.wake({});
  assert.notEqual(r3.status, 'cooldown');
  env.clock.advance(300_001);
  const r4 = await env.waker.wake({ pin: PIN });
  assert.notEqual(r4.status, 'cooldown');
});

test('refuses unauthenticated request', async () => {
  const env = fakeEnv();
  const h = handlerFor(env);
  for (const headers of [{ authorization: '' }, { authorization: 'Bearer wrong' }, { authorization: `Bearer ${'b'.repeat(48)}` }, { authorization: 'Basic x' }, { authorization: 'Bearer zz' }]) {
    const res = fakeRes();
    await h(fakeReq({ headers, body: '{}' }), res);
    assert.equal(res.status, 401);
  }
  assert.equal(env.sent.length, 0);
  // lockout after repeated failures, even with the right token
  const res = fakeRes();
  await h(fakeReq({ body: '{}' }), res);
  assert.equal(res.status, 429);
  assert.equal(env.sent.length, 0);
  // disabled when token unset; cross-origin and unknown host refused
  const off = fakeRes();
  await handlerFor(env, { token: '' })(fakeReq({ body: '{}' }), off);
  assert.equal(off.status, 503);
  const xo = fakeRes();
  await handlerFor(env)(fakeReq({ headers: { origin: 'http://evil.example' }, body: '{}' }), xo);
  assert.equal(xo.status, 403);
  const bh = fakeRes();
  await handlerFor(env)(fakeReq({ headers: { host: 'evil.example' }, body: '{}' }), bh);
  assert.equal(bh.status, 403);
  const big = fakeRes();
  await handlerFor(env)(fakeReq({ body: JSON.stringify({ pin: 'x'.repeat(4000) }), ip: '10.0.0.10' }), big);
  assert.equal(big.status, 413);
  assert.equal(env.sent.length, 0);
});

test('refuses concurrent wake', async () => {
  const env = fakeEnv();
  let release;
  env.waker = wake.createWaker({ ...env, sleep: () => new Promise((r) => { release = r; }) });
  const first = env.waker.wake({});
  await new Promise((r) => setImmediate(r));
  const second = await env.waker.wake({});
  assert.equal(second.status, 'busy');
  assert.equal(env.sent.length, 1);
  env.probes.answers.push(true);
  release();
  assert.equal((await first).status, 'awake');
});

test('no wildcard CORS on the route', async () => {
  const env = fakeEnv();
  env.probes.answers.push(true);
  const h = handlerFor(env);
  const pre = fakeRes();
  await h(fakeReq({ method: 'OPTIONS', headers: { origin: 'http://evil.example' } }), pre);
  assert.equal(pre.status, 204);
  assert.ok(!Object.keys(pre.headers).some((k) => k.startsWith('access-control-')));
  const ok = fakeRes();
  await h(fakeReq({ body: '{}' }), ok);
  assert.equal(ok.status, 200);
  assert.ok(!Object.keys(ok.headers).some((k) => k.startsWith('access-control-')));
  assert.equal(ok.headers['cache-control'], 'no-store');
  // server routes the wake path before the global CORS block
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.cjs'), 'utf8');
  assert.ok(src.indexOf('isWakePath(pathname)') > 0);
  assert.ok(src.indexOf('isWakePath(pathname)') < src.indexOf("'Access-Control-Allow-Origin'"));
});

test('refuses PIN wake when steps have no $PIN text step', async () => {
  const env = fakeEnv({ config: { SPOCK_STEPS_JSON: JSON.stringify([{ key: 0x6a }, { pause: 100 }]) } });
  const r = await env.waker.wake({ pin: PIN });
  assert.equal(r.status, 'steps_missing_pin');
  assert.equal(env.sent.length, 0);
  const res = fakeRes();
  await handlerFor(env)(fakeReq({ body: JSON.stringify({ pin: PIN }) }), res);
  assert.equal(res.status, 500);
  assert.match(res.body, /steps_missing_pin/);
  assert.ok(!res.body.includes(PIN));
  assert.equal(env.sent.length, 0);
  // no PIN: Space still works
  env.probes.answers.push(false, true);
  assert.equal((await env.waker.wake({})).status, 'awake');
});

test('failed-auth map is bounded', async () => {
  const env = fakeEnv();
  const h = handlerFor(env);
  for (let i = 0; i < 1500; i++) {
    await h(fakeReq({ headers: { authorization: 'Bearer wrong' }, body: '{}', ip: `10.1.${i >> 8}.${i & 255}` }), fakeRes());
  }
  assert.ok(h._failsSize() <= 1000, `size ${h._failsSize()}`);
  env.clock.advance(10 * 60_000);
  await h(fakeReq({ headers: { authorization: 'Bearer wrong' }, body: '{}', ip: '10.9.9.9' }), fakeRes());
  assert.equal(h._failsSize(), 1);
});

test('counter strictly increases within the same millisecond', async () => {
  const env = fakeEnv();
  const w = wake.createWaker({ ...env, sleep: async () => {} });
  for (let i = 0; i < 3; i++) {
    env.probes.answers.push(false, true);
    assert.equal((await w.wake({})).status, 'awake');
  }
  const ctrs = env.sent.map((s) => s.buf.readBigUInt64BE(1));
  assert.equal(ctrs.length, 3);
  assert.ok(ctrs[0] < ctrs[1] && ctrs[1] < ctrs[2]);
});

test('counter persists across restarts and beats a lagging clock', async () => {
  const fs1 = fakeFs({ '/data/ctr': '5000000\n' });
  const env = fakeEnv({ fs: fs1 });
  env.probes.answers.push(false, true);
  assert.equal((await env.waker.wake({})).status, 'awake');
  const c1 = env.sent[0].buf.readBigUInt64BE(1);
  assert.equal(c1, 5000001n, 'persisted+1 wins over Date.now()');
  assert.equal(fs1.files['/data/ctr'].trim(), '5000001');
  // new waker instance (restart) on the same file
  const env2 = fakeEnv({ fs: fs1 });
  env2.probes.answers.push(false, true);
  await env2.waker.wake({});
  assert.equal(env2.sent[0].buf.readBigUInt64BE(1), 5000002n);
});

test('counter is written before the frame is sent; unwritable counter blocks send', async () => {
  const fs1 = fakeFs();
  const env = fakeEnv({ fs: fs1 });
  let persistedAtSend;
  const send = env.dgram.createSocket;
  env.dgram.createSocket = () => { const s = send(); const o = s.send; s.send = (...a) => { persistedAtSend = fs1.files['/data/ctr']; o(...a); }; return s; };
  env.waker = wake.createWaker(env);
  env.probes.answers.push(false, true);
  await env.waker.wake({});
  assert.equal(persistedAtSend.trim(), String(env.sent[0].buf.readBigUInt64BE(1)));
  const bad = fakeFs();
  bad.writeFileSync = () => { throw new Error('EROFS'); };
  const env2 = fakeEnv({ fs: bad });
  env2.probes.answers.push(false);
  const r = await env2.waker.wake({});
  assert.equal(r.status, 'not_sent');
  assert.equal(env2.sent.length, 0);
});

test('socket error (bind failure) settles the send and clears busy', async () => {
  const env = fakeEnv();
  let closed = 0;
  env.dgram = {
    createSocket: () => {
      const s = new EventEmitter();
      s.send = () => { setImmediate(() => s.emit('error', new Error('EADDRINUSE'))); };
      s.close = () => { closed++; };
      return s;
    },
  };
  env.waker = wake.createWaker(env);
  env.probes.answers.push(false);
  const r = await env.waker.wake({});
  assert.equal(r.status, 'not_sent');
  assert.equal(closed, 1);
  env.probes.answers.push(true);
  assert.equal((await env.waker.wake({})).status, 'already_awake', 'busy cleared');
});

test('deadline bounds sleeps and ignores a probe answer after it', async () => {
  const env = fakeEnv({ config: { SPOCK_WAKE_TIMEOUT_MS: '4000' } });
  const r = await env.waker.wake({});
  assert.equal(r.status, 'timeout');
  assert.deepEqual(env.sleeps, [3000, 1000]);
  assert.ok(r.elapsedMs <= 4000, `elapsed ${r.elapsedMs}`);
  // a probe that answers only after the deadline does not count
  const env2 = fakeEnv({ config: { SPOCK_WAKE_TIMEOUT_MS: '4000' } });
  let n = 0;
  env2.fetch = async (url, init) => {
    n++;
    if (n === 1) throw new Error('timeout');
    env2.clock.advance(2000);
    return { status: 200, init };
  };
  env2.waker = wake.createWaker(env2);
  const r2 = await env2.waker.wake({});
  assert.equal(r2.status, 'timeout');
});

test('PIN requires an https or localhost Origin', async () => {
  for (const origin of ['http://foundation1:3000', undefined]) {
    const env = fakeEnv();
    const res = fakeRes();
    const headers = origin ? { origin, host: 'foundation1:3000' } : { origin: undefined };
    await handlerFor(env)(fakeReq({ headers, body: JSON.stringify({ pin: PIN }) }), res);
    assert.equal(res.status, 403, String(origin));
    assert.equal(JSON.parse(res.body).error, 'https_required');
    assert.equal(env.sent.length, 0);
  }
  for (const [origin, host] of [['https://foundation1:3000', 'foundation1:3000'], ['http://localhost:5173', 'localhost:5173'], ['http://127.0.0.1:3000', '127.0.0.1:3000']]) {
    const env = fakeEnv();
    env.probes.answers.push(true);
    const res = fakeRes();
    await handlerFor(env, { allowedHosts: [host] })(fakeReq({ headers: { origin, host }, body: JSON.stringify({ pin: PIN }) }), res);
    assert.equal(res.status, 200, origin);
  }
  // PIN-less wake over plain HTTP still works
  const env = fakeEnv();
  env.probes.answers.push(true);
  const res = fakeRes();
  await handlerFor(env)(fakeReq({ headers: { origin: 'http://foundation1:3000' }, body: '{}' }), res);
  assert.equal(res.status, 200);
});

test('stale failed-auth record is reset before counting', async () => {
  const env = fakeEnv();
  const h = handlerFor(env);
  const bad = () => h(fakeReq({ headers: { authorization: 'Bearer wrong' }, body: '{}' }), fakeRes());
  for (let i = 0; i < 4; i++) await bad();
  env.clock.advance(60_001);
  for (let i = 0; i < 4; i++) await bad();
  env.probes.answers.push(true);
  const res = fakeRes();
  await h(fakeReq({ body: '{}' }), res);
  assert.equal(res.status, 200);
});

test('lockout and PIN cooldown responses carry retryAfterMs', async () => {
  const env = fakeEnv({ config: { SPOCK_WAKE_TIMEOUT_MS: '3000', SPOCK_PIN_COOLDOWN_MS: '300000' } });
  const h = handlerFor(env);
  for (let i = 0; i < 5; i++) await h(fakeReq({ headers: { authorization: 'Bearer wrong' }, body: '{}' }), fakeRes());
  env.clock.advance(10_000);
  const locked = fakeRes();
  await h(fakeReq({ body: '{}' }), locked);
  assert.equal(locked.status, 429);
  assert.equal(JSON.parse(locked.body).retryAfterMs, 50_000);
  // PIN timeout reports the cooldown, and the next PIN request is refused with the remainder
  const t = fakeRes();
  await h(fakeReq({ body: JSON.stringify({ pin: PIN }), ip: '10.0.0.77' }), t);
  assert.equal(JSON.parse(t.body).status, 'timeout');
  assert.equal(JSON.parse(t.body).retryAfterMs, 300_000);
  env.clock.advance(1000);
  const c = fakeRes();
  await h(fakeReq({ body: JSON.stringify({ pin: PIN }), ip: '10.0.0.77' }), c);
  assert.equal(c.status, 429);
  assert.equal(JSON.parse(c.body).retryAfterMs, 299_000);
});

test('oversized body: client receives 413 over a real socket', async () => {
  const env = fakeEnv();
  const h = handlerFor(env, { allowedHosts: ['127.0.0.1'] });
  const srv = http.createServer((req, res) => { h(req, res); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const { port } = srv.address();
  try {
    const body = JSON.stringify({ pin: 'x'.repeat(200_000) });
    const got = await new Promise((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1', port, method: 'POST', path: '/api/spock/wake',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, 'content-length': Buffer.byteLength(body) },
      }, (res) => {
        let b = '';
        res.on('data', (c) => { b += c; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
      });
      req.on('error', reject);
      req.end(body);
    });
    assert.equal(got.status, 413);
    assert.equal(got.headers.connection, 'close');
    assert.match(got.body, /too large/i);
    assert.equal(env.sent.length, 0);
  } finally {
    srv.close();
  }
});
