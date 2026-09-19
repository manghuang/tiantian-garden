import test from 'node:test';
import assert from 'node:assert/strict';
import { RelayProvider } from '../src/providers/relay.js';
import { RealtimeProtocol } from '../src/providers/protocol.js';

test('text input can play remote character PCM without requesting a microphone', async t => {
  const keys = ['fetch', 'WebSocket', 'location', 'AudioContext', 'navigator'];
  const saved = Object.fromEntries(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => { for (const [key, descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  let microphones = 0, closed = 0;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia() { microphones++; throw new Error('No microphone requested'); } } } });
  globalThis.location = { href: 'https://garden.example/', protocol: 'https:' };
  globalThis.AudioContext = class {
    sampleRate = 24000; currentTime = 0;
    async resume() {} async close() { closed++; }
    createAnalyser() { return { connect() {}, disconnect() {} }; }
  };
  globalThis.fetch = async () => Response.json({ id: 'speech', transport: 'websocket', socketPath: '/api/session/speech/socket' });
  globalThis.WebSocket = class {
    readyState = 1; bufferedAmount = 0;
    constructor() { queueMicrotask(() => this.onmessage({ data: JSON.stringify({ type: 'garden.ready' }) })); }
    close() { this.readyState = 3; } send() {}
  };
  const provider = new RelayProvider({ providerId: 'deepseek', config: { providers: [{ id: 'deepseek', audio: false, audioOutput: true }] }, emit() {} });
  t.after(() => provider.disconnect()); await provider.connect({}, { consent: true });
  assert.ok(provider.player); assert.equal(provider.stream, undefined); assert.equal(microphones, 0);
  provider.disconnect(); assert.equal(closed, 1);
});

test('missing microphone keeps relay usable in text-only mode', async t => {
  const keys = ['fetch', 'WebSocket', 'location', 'AudioContext', 'navigator'];
  const saved = Object.fromEntries(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => { for (const [key, descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  const events = [], requests = [];
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async () => { const error = new Error('Requested device not found'); error.name = 'NotFoundError'; throw error; } } } });
  globalThis.location = { href: 'https://garden.example/', protocol: 'https:' };
  globalThis.AudioContext = class {
    sampleRate = 24000; currentTime = 0;
    async resume() {} async close() {}
    createAnalyser() { return { connect() {}, disconnect() {}, getByteTimeDomainData() {} }; }
  };
  globalThis.fetch = async (url, options) => { requests.push({ url, method: options?.method }); return Response.json({ id: 'text_session', transport: 'websocket', socketPath: '/api/session/text_session/socket', expiresAt: Date.now() + 60000 }); };
  globalThis.WebSocket = class {
    readyState = 1; bufferedAmount = 0;
    constructor() { queueMicrotask(() => this.onmessage({ data: JSON.stringify({ type: 'garden.ready' }) })); }
    close() { this.readyState = 3; } send() {}
  };
  const provider = new RelayProvider({ config: { csrf: 'test', providers: [{ id: 'openai', audio: true, audioOutput: true }] }, emit: (type, value) => events.push({ type, value }) });
  t.after(() => provider.disconnect());
  await provider.connect({}, { consent: true, audience: 'adult-test' });
  assert.equal(provider.textOnly, true); assert.equal(provider.audio, false); assert.equal(provider.stream, undefined);
  assert.ok(events.some(e => e.type === 'inputMode' && e.value === 'text'));
  assert.ok(events.some(e => e.type === 'notice' && e.value.includes('没有找到麦克风')));
  provider.sendText('你好'); assert.ok(requests.some(e => e.method === 'POST'));
});

test('microphone input and local speech output are independent and VAD interrupts local playback', () => {
  const events = [], sent = []; let callbacks, stopped = 0;
  const provider = new RelayProvider({ providerId: 'deepseek', config: { providers: [{ id: 'deepseek', audio: true, audioOutput: false }] },
    emit: (type, value) => events.push({ type, value }), speech: { speak: async (_text, _settings, handlers) => { callbacks = handlers; }, stop: () => stopped++, level: () => 0.5 } });
  provider.settings = {}; provider.protocol = new RealtimeProtocol({ send() {}, emit() {} });
  provider.socket = { readyState: 1, bufferedAmount: 0, send: raw => sent.push(JSON.parse(raw)), close() {} };
  assert.equal(provider.audio, true); assert.equal(provider.outputAudio, false);
  provider.handle({ type: 'response.created', response: { id: 'first' } });
  provider.handle({ type: 'response.output_audio_transcript.done', response_id: 'first', item_id: 'answer_first', transcript: '你好' });
  callbacks.onStart(); assert.equal(events.at(-1).value, 'speaking'); assert.equal(provider.level(), 0.5);
  provider.handle({ type: 'input_audio_buffer.speech_started' });
  assert.deepEqual(sent.at(-1), { type: 'played', itemId: 'answer_first', playedMs: 0 }); assert.equal(stopped, 1);
  const count = events.length; callbacks.onEnd(); assert.equal(events.length, count);
  provider.disconnect(); assert.equal(stopped, 2);
});

test('text-only DeepSeek connects without audio APIs, stops local speech and revokes server session', async t => {
  const saved = Object.fromEntries(['fetch', 'WebSocket', 'location'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => { for (const [key, descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  const requests = [], sent = [], events = [], callbacks = []; let stops = 0;
  globalThis.location = { href: 'https://garden.example/', protocol: 'https:' };
  globalThis.fetch = async (url, options) => { requests.push({ url, options }); return Response.json({ id: 'session_ds', transport: 'websocket', socketPath: '/api/session/session_ds/socket', expiresAt: Date.now() + 60000 }); };
  globalThis.WebSocket = class {
    constructor(url, protocols) {
      assert.equal(url.href, 'wss://garden.example/api/session/session_ds/socket'); assert.deepEqual(protocols, ['garden.v1', 'csrf.test']);
      this.readyState = 1; this.bufferedAmount = 0; queueMicrotask(() => this.onmessage({ data: JSON.stringify({ type: 'garden.ready' }) }));
    }
    send(raw) { sent.push(JSON.parse(raw)); }
    close() { this.readyState = 3; }
  };
  const provider = new RelayProvider({ providerId: 'deepseek', config: { csrf: 'test', providers: [{ id: 'deepseek', audio: false }] },
    emit: (type, value) => events.push({ type, value }), speech: { stop() { stops++; }, async speak(_text, _settings, handlers) { callbacks.push(handlers); }, level: () => null } });
  t.after(() => provider.disconnect());
  await provider.connect({ voiceStyle: 'bright' }, { consent: true, audience: 'adult-test' });
  assert.equal(JSON.parse(requests[0].options.body).provider, 'deepseek'); assert.equal(provider.stream, undefined); assert.equal(provider.context, undefined);
  provider.handle({ type: 'response.created', response: { id: 'greeting' } });
  provider.handle({ type: 'response.output_audio_transcript.done', response_id: 'greeting', item_id: 'item_1', transcript: '你好' });
  provider.handle({ type: 'response.done', response: { id: 'greeting', status: 'completed', output: [] } });
  callbacks[0].onStart(); assert.equal(events.at(-1).value, 'speaking');
  provider.sendText('继续');
  assert.deepEqual(sent.slice(-2), [{ type: 'interrupt', itemId: 'item_1', playedMs: 0 }, { type: 'text', text: '继续' }]);
  const length = events.length; callbacks[0].onStart(); callbacks[0].onEnd(); assert.equal(events.length, length);
  provider.handle({ type: 'garden.idle' }); assert.equal(provider.awaitingResponse, false); assert.equal(provider.ignoreNext, false);
  provider.handle({ type: 'garden.notice', message: '稍后再试' }); assert.equal(events.at(-1).value, '稍后再试');
  provider.disconnect(); assert.ok(stops >= 2); assert.equal(provider.socket.readyState, 3);
  assert.equal(requests.at(-1).url, '/api/session/session_ds'); assert.equal(requests.at(-1).options.method, 'DELETE');
});

test('ending during audio initialization cannot subsequently request microphone permission', async t => {
  const saved = Object.fromEntries(['navigator', 'AudioContext', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => { for (const [key, descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  let resume, microphones = 0, requests = 0, contextsClosed = 0;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async () => { microphones++; throw new Error('Must not request the mic after ending'); } } } });
  globalThis.AudioContext = class { constructor() { this.sampleRate = 24000; } resume() { return new Promise(resolve => { resume = resolve; }); } async close() { contextsClosed++; } };
  globalThis.fetch = async () => { requests++; return Response.json({}); };
  const provider = new RelayProvider({ config: {}, emit() {} });
  const connecting = provider.connect({}, { consent: true }); provider.disconnect(); resume(); await connecting;
  assert.equal(microphones, 0); assert.equal(requests, 0); assert.equal(contextsClosed, 1);
});

test('ending while permission is pending stops any late microphone stream immediately', async t => {
  const saved = Object.fromEntries(['navigator', 'AudioContext', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => { for (const [key, descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  let permit, stopped = 0, requests = 0;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: () => new Promise(resolve => { permit = resolve; }) } } });
  globalThis.AudioContext = class { constructor() { this.sampleRate = 24000; } async resume() {} async close() {} };
  globalThis.fetch = async () => { requests++; return Response.json({}); };
  const provider = new RelayProvider({ config: {}, emit() {} }); const connecting = provider.connect({}, { consent: true });
  await new Promise(resolve => setImmediate(resolve)); provider.disconnect();
  permit({ getTracks: () => [{ stop() { stopped++; } }] }); await connecting;
  assert.equal(stopped, 1); assert.equal(requests, 0); assert.equal(provider.capture, undefined);
});

test('cancelled session creation aborts HTTP and revokes a late successful reservation', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  let complete, signal; const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, method: options.method });
    if (options.method === 'DELETE') return new Response(null, { status: 204 });
    signal = options.signal; return new Promise(resolve => { complete = resolve; });
  };
  const provider = new RelayProvider({ providerId: 'deepseek', config: { csrf: 'test', providers: [{ id: 'deepseek', audio: false }] }, emit() {}, speech: { stop() {} } });
  const connecting = provider.connect({}, { consent: true }); provider.disconnect(); assert.equal(signal.aborted, true);
  complete(Response.json({ id: 'late_reservation' })); await connecting;
  assert.deepEqual(requests, [{ url: '/api/session', method: 'POST' }, { url: '/api/session/late_reservation', method: 'DELETE' }]);
  assert.equal(provider.sessionId, null); assert.equal(provider.socket, undefined);
});
