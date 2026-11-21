'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
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

function fakeEnv(over = {}) {
  const sent = [];
  const logs = [];
  let t = 1_000_000;
  const probes = { answers: [], calls: 0 };
  const env = {
    sent, logs, probes,
    clock: { now: () => t, advance: (ms) => { t += ms; } },
    config: { FRAME_KEY: KEY_HEX, ESP_IP: '192.168.1.50', SPOCK_URL: 'http://spock.ts.net:3000', ...over.config },
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
      return { ok: ans };
    },
    sleep: async (ms) => { t += ms; },
    log: (...a) => logs.push(a.join(' ')),
  };
  env.waker = wake.createWaker(env);
  return env;
}

function fakeReq({ method = 'POST', headers = {}, body = '', ip = '10.0.0.9' } = {}) {
  const r = Readable.from(body ? [Buffer.from(body)] : []);
  r.method = method;
  r.url = '/api/spock/wake';
  r.headers = { host: 'foundation1:3000', 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, ...headers };
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

test('seals frame decodable by the shared vector', () => {
  const frame = wake.sealFrame(Buffer.from(vec.keyHex, 'hex'), BigInt(vec.counter), Buffer.from(vec.plaintextHex, 'hex'));
  assert.equal(frame.toString('hex'), vec.frameHex);
  assert.equal(open(frame, vec.keyHex).toString('hex'), vec.plaintextHex);
});

test('skips frame when panel already answers', async () => {
  const env = fakeEnv();
  env.probes.answers.push(true);
  const r = await env.waker.wake({});
  assert.equal(r.status, 'already_awake');
  assert.equal(env.sent.length, 0);
  assert.equal(env.probes.url, 'http://spock.ts.net:3000/api/health');
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
