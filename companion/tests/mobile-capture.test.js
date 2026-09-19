import test from 'node:test';
import assert from 'node:assert/strict';
import { RelayProvider } from '../src/providers/relay.js';

function fixture(t, { workletFails = true, fallbackFails = false, permissionDenied = false, audioFails = false } = {}) {
  const keys = ['fetch', 'WebSocket', 'location', 'AudioContext', 'AudioWorkletNode', 'navigator'];
  const saved = keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  t.after(() => { for (const [key, d] of saved) { if (d) Object.defineProperty(globalThis, key, d); else delete globalThis[key]; } });
  const sent = [], events = [], modules = [], track = { enabled: true, stopped: false, stop() { this.stopped = true; } };
  let microphones = 0, processor, resolveModule;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { async getUserMedia() {
    microphones++;
    if (permissionDenied) throw new DOMException('Denied', 'NotAllowedError');
    return { getTracks: () => [track], getAudioTracks: () => [track] };
  } } } });
  globalThis.location = { href: 'https://garden.example/', protocol: 'https:' };
  globalThis.AudioContext = class {
    constructor() { if (audioFails) throw new Error('Unsupported audio'); }
    sampleRate = 24000; currentTime = 0; destination = {};
    async resume() {} async close() {}
    audioWorklet = { addModule: async url => {
      modules.push(url);
      if (workletFails) throw new DOMException("Unable to load a worklet's module.", 'AbortError');
      return new Promise(resolve => { resolveModule = resolve; });
    } };
    createScriptProcessor() {
      if (fallbackFails) throw new Error('Unsupported capture');
      processor = { connect() {}, disconnect() { this.disconnected = true; } }; return processor;
    }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createAnalyser() { return { connect() {}, disconnect() {} }; }
  };
  globalThis.fetch = async () => Response.json({ id: 'mobile', transport: 'websocket', socketPath: '/api/session/mobile/socket' });
  globalThis.WebSocket = class {
    readyState = 1; bufferedAmount = 0;
    constructor() { queueMicrotask(() => this.onmessage({ data: JSON.stringify({ type: 'garden.ready' }) })); }
    send(raw) { sent.push(JSON.parse(raw)); } close() { this.readyState = 3; }
  };
  const provider = new RelayProvider({ providerId: 'deepseek', config: { providers: [{ id: 'deepseek', audio: true, audioOutput: true }] }, emit: (type, value) => events.push({ type, value }), speech: { stop() {} } });
  t.after(() => provider.disconnect());
  return { provider, sent, events, track, modules, microphones: () => microphones, processor: () => processor, resolveModule: () => resolveModule() };
}

test('mobile worklet failure falls back to silent PCM capture, flushes before audio_end and stops on release', async t => {
  const f = fixture(t); await f.provider.connect({}, { consent: true });
  assert.equal(f.provider.audio, true); assert.equal(f.track.enabled, false);
  const output = new Float32Array(2048).fill(1);
  const process = () => f.processor().onaudioprocess({ inputBuffer: { getChannelData: () => new Float32Array(2048).fill(0.5) }, outputBuffer: { getChannelData: () => output } });
  process(); assert.equal(f.sent.length, 0);
  f.provider.setPushToTalk(true); process(); process(); f.provider.setPushToTalk(false);
  assert.deepEqual(f.sent.map(e => e.type), ['audio', 'audio', 'audio_end']);
  assert.ok(output.every(v => v === 0)); assert.equal(f.track.enabled, false);
  const last = Buffer.from(f.sent[1].audio, 'base64'); assert.equal(last.length, 4800); assert.equal(last.readInt16LE(0), 16383); assert.equal(last.readInt16LE(4798), 0);
  process(); assert.equal(f.sent.length, 3);
  f.provider.sendText('你好'); assert.equal(f.sent.at(-1).text, '你好');
  f.provider.disconnect(); assert.equal(f.track.stopped, true); assert.equal(f.processor().onaudioprocess, null);
});

for (const options of [{ fallbackFails: true }, { permissionDenied: true }, { audioFails: true }]) {
  test(`mobile capture failure retains a working text session: ${JSON.stringify(options)}`, async t => {
    const f = fixture(t, options); await f.provider.connect({}, { consent: true });
    assert.equal(f.provider.textOnly, true); assert.equal(f.provider.ready, true);
    assert.ok(f.events.some(e => e.type === 'notice' && e.value.includes('文字互动')));
    f.provider.sendText('继续聊天'); assert.deepEqual(f.sent.at(-1), { type: 'text', text: '继续聊天' });
    if (options.fallbackFails) assert.equal(f.track.stopped, true);
  });
}

test('explicit text mode never requests microphone or loads worklet, and keeps remote playback', async t => {
  const f = fixture(t); await f.provider.connect({}, { consent: true }, { inputMode: 'text' });
  assert.equal(f.microphones(), 0); assert.equal(f.modules.length, 0); assert.ok(f.provider.player);
  f.provider.sendText('我想听故事'); assert.equal(f.sent.at(-1).text, '我想听故事');
});

test('ending during module loading cannot create fallback capture or connect a session', async t => {
  const f = fixture(t, { workletFails: false }); const pending = f.provider.connect({}, { consent: true });
  await new Promise(resolve => setImmediate(resolve)); f.provider.disconnect(); f.resolveModule(); await pending;
  assert.equal(f.track.stopped, true); assert.equal(f.processor(), undefined); assert.equal(f.provider.socket, undefined);
});
