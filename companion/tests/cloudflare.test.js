import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../cloudflare/worker.js';
import { GardenControl } from '../cloudflare/control.js';
import { sessionSettings } from '../shared/behavior.js';

const origin = 'https://garden.example';
const code = 'test-only-admission-code-1234567890';
const valid = { consent: true, audience: 'adult-test', sdp: 'v=0\r\noffer', settings: { minutes: 5 } };

test('GPU worker uses a separate server credential and unavailable GPU cannot silently change voice', async () => {
  const f = fixture(undefined, { OPENAI_API_KEY: '', DEEPSEEK_API_KEY: 'test', DEEPSEEK_TTS: 'local-gpu', VOICE_WORKER_TOKEN: 'voice-worker-test-token-1234567890123456' });
  const auth = await f.login();
  const info = await (await f.request('/api/config', undefined, auth)).json();
  const entry = info.providers.find(p => p.id === 'deepseek'); assert.equal(entry.tts, 'local-gpu'); assert.equal(entry.audioOutput, true); assert.equal(entry.voiceReady, false);
  assert.ok(!JSON.stringify(info).includes(f.env.VOICE_WORKER_TOKEN));
  assert.equal((await f.request('/api/voice-worker/socket', undefined, auth)).status, 401);
  assert.equal((await f.request('/api/voice-worker/socket', undefined, { Authorization: `Bearer ${f.env.VOICE_WORKER_TOKEN}` })).status, 401);
  assert.equal((await f.request('/api/voice-worker/socket', undefined, {}, { headers: { Authorization: `Bearer ${f.env.VOICE_WORKER_TOKEN}` } })).status, 426);
  assert.equal((await f.request('/api/session', { ...valid, provider: 'deepseek' }, auth)).status, 503);
});

test('Cloudflare advertises microphone input separately from local output without an OpenAI key', async () => {
  const f = fixture(undefined, { OPENAI_API_KEY: '', DEEPSEEK_API_KEY: 'test', DEEPSEEK_ASR: 'cloudflare', DEEPSEEK_TTS: 'local', AI: { run: async () => ({ text: '你好' }) } });
  const auth = await f.login(); const config = await (await f.request('/api/config', undefined, auth)).json();
  const speech = config.providers.find(p => p.id === 'deepseek');
  assert.equal(speech.audio, true); assert.equal(speech.audioOutput, false); assert.equal(speech.asr, 'cloudflare'); assert.equal(speech.tts, 'local');
  assert.equal(speech.moderation, 'local-rules');
});

test('Cloudflare MiniMax voice selection is advertised and missing custom voice configuration is rejected', async () => {
  const f = fixture(undefined, { OPENAI_API_KEY: '', DEEPSEEK_API_KEY: 'test', DEEPSEEK_TTS: 'cloudflare-minimax', AI: { run: async () => ({}) } });
  const auth = await f.login(); let config = await (await f.request('/api/config', undefined, auth)).json(); let speech = config.providers.find(p => p.id === 'deepseek');
  assert.equal(speech.tts, 'cloudflare-minimax'); assert.equal(speech.audioOutput, true); assert.equal(speech.voiceReady, false); assert.ok(!JSON.stringify(config).includes('CLOUDFLARE_TTS_VOICE_ID'));
  assert.equal((await f.request('/api/session', { ...valid, provider: 'deepseek' }, auth)).status, 503);
  f.env.CLOUDFLARE_TTS_VOICE_ID = 'tiantian-custom-voice'; config = await (await f.request('/api/config', undefined, auth)).json(); speech = config.providers.find(p => p.id === 'deepseek');
  assert.equal(speech.voiceReady, true); const session = await (await f.request('/api/session', { ...valid, provider: 'deepseek' }, auth)).json(); assert.equal(session.transport, 'websocket');
  await f.request(`/api/session/${session.id}`, undefined, auth, { method: 'DELETE' });
});

test('Cloudflare advertises MiniMax direct switching without exposing its API key', async () => {
  const f = fixture(undefined, {
    OPENAI_API_KEY: '', DEEPSEEK_API_KEY: 'test', DEEPSEEK_TTS: 'cloudflare-minimax', TTS_PROVIDER: 'minimax_direct',
    MINIMAX_API_KEY: 'sk-api-test', MINIMAX_TTS_VOICE_ID: 'male-qn-qingse',
  });
  const auth = await f.login(); const config = await (await f.request('/api/config', undefined, auth)).json(); const speech = config.providers.find(p => p.id === 'deepseek');
  assert.equal(speech.tts, 'minimax_direct'); assert.equal(speech.ttsProvider, 'minimax_direct'); assert.equal(speech.voiceReady, true); assert.ok(!JSON.stringify(config).includes(f.env.MINIMAX_API_KEY));
  const session = await (await f.request('/api/session', { ...valid, provider: 'deepseek' }, auth)).json(); assert.equal(session.transport, 'websocket');
  await f.request(`/api/session/${session.id}`, undefined, auth, { method: 'DELETE' });
  f.env.MINIMAX_API_KEY = ''; assert.equal((await f.request('/api/session', { ...valid, provider: 'deepseek' }, auth)).status, 503);
});
function storage() {
  let data; let alarm; let queue = Promise.resolve();
  return {
    storage: {
      get: async () => structuredClone(data), put: async (_key, value) => { data = structuredClone(value); },
      setAlarm: async value => { alarm = value; }, deleteAlarm: async () => { alarm = null; },
    },
    blockConcurrencyWhile(fn) { const result = queue.then(fn); queue = result.catch(() => {}); return result; },
    snapshot: () => structuredClone(data), deadline: () => alarm,
  };
}
function fixture(fetcher, extra = {}) {
  const ctx = storage(); const env = { PUBLIC_ORIGIN: origin, ACCESS_CODE: code, OPENAI_API_KEY: 'test-upstream-key', REALTIME_TRANSPORT: 'webrtc', ...extra };
  let control = new GardenControl(ctx, env); let time = Date.now(); control.now = () => time;
  control.fetcher = fetcher || (async () => new Response('v=0\r\nanswer', { status: 201, headers: { Location: '/v1/realtime/calls/rtc_test' } }));
  let assets = 0;
  env.GARDEN = { idFromName: () => 'singleton', get: () => control };
  env.ASSETS = { fetch: async () => { assets++; return new Response('asset'); } };
  const request = (path, body, auth = {}, overrides = {}) => worker.fetch(new Request(origin + path, {
    method: body === undefined ? 'GET' : 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...auth },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), ...overrides,
  }), env);
  return { ctx, env, request, control: () => control, assets: () => assets, advance(ms) { time += ms; },
    replace() { const fetcher = control.fetcher; control = new GardenControl(ctx, env); control.fetcher = fetcher; control.now = () => time; },
    async login() {
      const result = await request('/api/login', { code }); assert.equal(result.status, 200);
      assert.match(result.headers.get('set-cookie'), /HttpOnly; SameSite=Strict; Max-Age=28800; Secure/);
      const Cookie = result.headers.get('set-cookie').split(';')[0];
      const response = await request('/api/config', undefined, { Cookie }); assert.equal(response.status, 200);
      const config = await response.json(); return { Cookie, 'X-Session-Token': config.csrf };
    },
  };
}

test('Cloudflare requires deployment settings, protects model/voices and keeps API keys private', async () => {
  const f = fixture();
  assert.equal((await worker.fetch(new Request(origin), {})).status, 503);
  const page = await f.request('/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /(?:^|; )connect-src 'self' blob:;/);
  assert.equal((await f.request('/assets/index-test.js')).status, 200);
  for (const path of ['/assets/dog-balanced.glb', '/voices/preview-bright.wav', '/api/config']) assert.equal((await f.request(path)).status, 401);
  assert.equal(f.assets(), 2);
  const auth = await f.login();
  const asset = await f.request('/assets/dog-balanced.glb', undefined, auth); assert.equal(asset.status, 200); assert.equal(asset.headers.get('cache-control'), 'private, no-store');
  const config = await (await f.request('/api/config', undefined, auth)).json();
  assert.equal(config.childUseEnabled, false); assert.ok(!JSON.stringify(config).includes('test-upstream-key'));
  const saved = JSON.stringify(f.ctx.snapshot()); assert.ok(!saved.includes(code)); assert.ok(!saved.includes(auth.Cookie.split('=')[1]));
});

test('Cloudflare accepts the configured workers.dev and custom domain origins', async () => {
  const secondary = 'https://tiantian-garden.catcoder.dpdns.org';
  const f = fixture(undefined, { PUBLIC_ORIGINS: `${origin},${secondary}` });
  const page = await worker.fetch(new Request(secondary, { headers: { Origin: secondary } }), f.env);
  assert.equal(page.status, 200);
  const login = await worker.fetch(new Request(`${secondary}/api/login`, {
    method: 'POST', headers: { Origin: secondary, 'Content-Type': 'application/json' }, body: JSON.stringify({ code }),
  }), f.env);
  assert.equal(login.status, 200);
  assert.equal((await worker.fetch(new Request(`${secondary}/api/auth`, { headers: { Cookie: login.headers.get('set-cookie').split(';')[0] } }), f.env)).status, 200);
  assert.equal((await worker.fetch(new Request('https://evil.example'), f.env)).status, 403);
});

test('Cloudflare rejects cross-origin, wrong CSRF, malformed JSON, oversized bodies and child mode before upstream', async () => {
  let calls = 0; const f = fixture(async () => { calls++; throw new Error(); }); const auth = await f.login();
  assert.equal((await f.request('/api/session', valid, { Cookie: auth.Cookie })).status, 403);
  assert.equal((await f.request('/api/session', valid, auth, { headers: { ...auth, Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await f.request('/api/session', null, auth)).status, 400);
  assert.equal((await f.request('/api/session', { ...valid, sdp: 'v=0' + 'x'.repeat(96000) }, auth)).status, 400);
  assert.equal((await f.request('/api/session', { ...valid, audience: 'child' }, auth)).status, 403);
  assert.equal(calls, 0);
  for (const input of [null, [], true, 'bad']) assert.deepEqual(sessionSettings(input), sessionSettings());
});

test('Cloudflare reserves global and per-login capacity while provider calls are pending; logout cancels a late answer', async () => {
  const offers = []; const hangups = [];
  const f = fixture((url, options) => {
    if (url.endsWith('/hangup')) { hangups.push(url); return Promise.resolve(new Response(null)); }
    offers.push(JSON.parse(options.body.get('session')));
    return new Promise(resolve => offers[offers.length - 1].complete = resolve);
  });
  const a = await f.login(), b = await f.login(), c = await f.login(), d = await f.login();
  const pending = f.request('/api/session', { ...valid, settings: null, instructions: 'bad override' }, a);
  while (offers.length < 1) await new Promise(r => setImmediate(r));
  assert.equal((await f.request('/api/session', valid, a)).status, 429);
  const second = f.request('/api/session', valid, b), third = f.request('/api/session', valid, c);
  while (offers.length < 3) await new Promise(r => setImmediate(r));
  assert.equal((await f.request('/api/session', valid, d)).status, 429);
  assert.equal((await f.request('/api/logout', undefined, a, { method: 'POST' })).status, 204);
  for (let i = 0; i < offers.length; i++) offers[i].complete(new Response('v=0\r\nanswer', { status: 201, headers: { Location: `/calls/rtc_${i}` } }));
  assert.equal((await pending).status, 502); assert.equal((await second).status, 200); assert.equal((await third).status, 200);
  assert.equal(hangups.length, 1); assert.ok(!offers[0].instructions.includes('bad override'));
  assert.equal(offers[0].audio.output.voice, 'coral'); assert.equal(offers[0].max_output_tokens, 512);
  assert.equal(Object.keys(f.ctx.snapshot().calls).length, 2);
});

test('Cloudflare alarm closes expired calls after object replacement; failed hangup retains capacity and retries', async () => {
  let fail = true; let hangs = 0;
  const f = fixture(async url => {
    if (url.endsWith('/hangup')) { hangs++; return new Response(null, { status: fail ? 503 : 200 }); }
    return new Response('v=0\r\nanswer', { status: 201, headers: { Location: '/calls/rtc_alarm' } });
  });
  const a = await f.login(), b = await f.login();
  const response = await f.request('/api/session', valid, a); const session = await response.json();
  assert.equal(response.status, 200); assert.equal(f.ctx.deadline() <= session.expiresAt, true);
  assert.equal((await f.request(`/api/session/${session.id}`, undefined, b, { method: 'DELETE' })).status, 404);
  f.advance(300001); f.replace(); await f.control().alarm();
  assert.equal(hangs, 1); assert.equal(f.ctx.snapshot().calls[session.id].phase, 'closing');
  assert.equal((await f.request('/api/session', valid, a)).status, 429);
  fail = false; f.advance(30001); f.replace(); await f.control().alarm();
  assert.equal(hangs, 2); assert.equal(Object.keys(f.ctx.snapshot().calls).length, 0);
  assert.equal((await f.request('/api/auth', undefined, a)).status, 200);
});

test('Cloudflare rotates admission codes, revokes old logins and closes their calls', async () => {
  const f = fixture(async url => url.endsWith('/hangup') ? new Response(null) : new Response('v=0\r\nanswer', { headers: { Location: '/calls/rtc_rotate' } }));
  const auth = await f.login(); await f.request('/api/session', valid, auth);
  f.env.ACCESS_CODE = 'a-new-long-random-admission-code'; f.replace();
  assert.equal((await f.request('/api/config', undefined, auth)).status, 401);
  await f.control().alarm(); assert.equal(Object.keys(f.ctx.snapshot().calls).length, 0);
});

test('Cloudflare limits login attempts durably and releases failed provider setup slots', async () => {
  const f = fixture(async () => new Response('private upstream body', { status: 401 })); const auth = await f.login();
  const response = await f.request('/api/session', valid, auth); assert.equal(response.status, 502); assert.ok(!(await response.text()).includes('private upstream'));
  assert.equal(Object.keys(f.ctx.snapshot().calls).length, 0);
  for (let i = 0; i < 9; i++) assert.equal((await f.request('/api/login', { code: 'wrong' })).status, 401);
  f.replace(); assert.equal((await f.request('/api/login', { code })).status, 429);
});

test('Cloudflare relay reserves single-use owned connections and rejects cross-site socket upgrades', async () => {
  let upstream = 0;
  const f = fixture(async () => { upstream++; throw new Error(); }, { REALTIME_TRANSPORT: undefined });
  const a = await f.login(), b = await f.login();
  const config = await (await f.request('/api/config', undefined, a)).json(); assert.equal(config.realtimeTransport, 'websocket');
  const response = await f.request('/api/session', { ...valid, settings: { minutes: 5, instructions: 'bad' }, transport: 'webrtc' }, a);
  assert.equal(response.status, 200); const session = await response.json(); assert.equal(session.transport, 'websocket');
  assert.ok(!session.sdp); assert.equal(upstream, 0);
  const saved = f.ctx.snapshot().calls[session.id]; assert.ok(!JSON.stringify(saved).includes('bad')); assert.equal(saved.transport, 'websocket');
  const headers = { ...a, Upgrade: 'websocket', 'Sec-WebSocket-Protocol': `garden.v1, csrf.${a['X-Session-Token']}` };
  assert.equal((await f.request(session.socketPath, undefined, a, { headers: { ...headers, Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await f.request(session.socketPath, undefined, a, { headers: { ...headers, Origin: origin, 'Sec-WebSocket-Protocol': 'garden.v1' } })).status, 403);
  assert.equal((await f.request(session.socketPath, undefined, b, { headers: { ...headers, ...b, Origin: origin, 'Sec-WebSocket-Protocol': `garden.v1, csrf.${b['X-Session-Token']}` } })).status, 404);
  assert.equal((await f.request('/api/session', valid, a)).status, 429);
  assert.equal((await f.request(session.socketPath, undefined, a, { headers: { ...headers, Origin: origin } })).status, 502);
  assert.equal(upstream, 1);
  assert.equal(Object.keys(f.ctx.snapshot().calls).length, 0);
});

test('unclaimed relay reservations expire, and logout closes an active socket without a provider call id', async () => {
  const f = fixture(undefined, { REALTIME_TRANSPORT: undefined }); const a = await f.login();
  const result = await (await f.request('/api/session', valid, a)).json();
  f.advance(35001); await f.control().alarm(); assert.equal(Object.keys(f.ctx.snapshot().calls).length, 0);
  const next = await (await f.request('/api/session', valid, a)).json(); let stopped = 0;
  f.control().sockets.set(next.id, { stop: () => stopped++ });
  await f.control().mutate(s => { s.calls[next.id].phase = 'active'; s.calls[next.id].next = next.expiresAt; });
  assert.equal((await f.request('/api/logout', undefined, a, { method: 'POST' })).status, 204);
  assert.ok(stopped > 0); assert.equal(Object.keys(f.ctx.snapshot().calls).length, 0);
  assert.notEqual(next.id, result.id);
});

test('DeepSeek advertises actual audio capability, validates provider and shares owned capacity', async () => {
  const f = fixture(undefined, { OPENAI_API_KEY: '', DEEPSEEK_API_KEY: 'test-ds-secret', DEEPSEEK_TTS: 'local' }); const a = await f.login();
  const config = await (await f.request('/api/config', undefined, a)).json();
  assert.equal(config.defaultProvider, 'deepseek'); assert.equal(config.providers.find(p => p.id === 'deepseek').audio, false);
  assert.ok(!JSON.stringify(config).includes('test-ds-secret'));
  assert.equal((await f.request('/api/session', { ...valid, provider: 'injected' }, a)).status, 400);
  assert.equal((await f.request('/api/session', valid, a)).status, 503);
  assert.equal((await f.request('/api/session', { ...valid, provider: 'deepseek', consent: false }, a)).status, 400);
  const response = await f.request('/api/session', { ...valid, provider: 'deepseek', sdp: undefined }, a);
  assert.equal(response.status, 200); const session = await response.json(); assert.equal(session.transport, 'websocket');
  assert.equal(f.ctx.snapshot().calls[session.id].provider, 'deepseek');
  f.env.OPENAI_API_KEY = 'test-speech';
  assert.equal((await f.request('/api/session', valid, a)).status, 429);
  const next = await (await f.request('/api/config', undefined, a)).json();
  assert.equal(next.defaultProvider, 'openai'); assert.equal(next.providers.find(p => p.id === 'deepseek').audio, true);
  await f.request(`/api/session/${session.id}`, undefined, a, { method: 'DELETE' });
  f.env.DEEPSEEK_API_KEY = ''; assert.equal((await f.request('/api/session', { ...valid, provider: 'deepseek' }, a)).status, 503);
});
