import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalVoiceBroker } from '../shared/local-voice-broker.js';
import { DeepSeekSession } from '../shared/deepseek-session.js';
import { sessionSettings } from '../shared/behavior.js';

class Socket extends EventTarget {
  readyState = 1; sent = [];
  send(raw) { this.sent.push(JSON.parse(raw)); }
  receive(event) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(event) })); }
  close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
}
function fixture(t) { const broker = new LocalVoiceBroker(); const socket = new Socket(); broker.attach(socket); t.after(() => broker.disconnect()); return { broker, socket }; }
const audio = Buffer.from([1, 0, 2, 0]).toString('base64');
test('local GPU broker streams bounded PCM and serializes independent sessions', async t => {
  const { broker, socket } = fixture(t);
  const a = broker.synthesize({ text: '你好' }), b = broker.synthesize({ text: '一起玩' });
  const an = a.next(), bn = b.next(); let id = socket.sent.at(-1).id;
  assert.equal(socket.sent.filter(e => e.type === 'synthesize').length, 1);
  socket.receive({ type: 'audio', id, audio }); assert.deepEqual((await an).value, new Uint8Array([1, 0, 2, 0]));
  socket.receive({ type: 'done', id }); assert.equal((await a.next()).done, true);
  id = socket.sent.at(-1).id; socket.receive({ type: 'audio', id, audio }); socket.receive({ type: 'done', id });
  assert.equal((await bn).value.length, 4); assert.equal((await b.next()).done, true);
});
test('interruption discards late audio and waits for GPU cancellation acknowledgment', async t => {
  const { broker, socket } = fixture(t); const controller = new AbortController();
  const a = broker.synthesize({ text: '第一句', signal: controller.signal }); const an = a.next(); const id = socket.sent.at(-1).id;
  const rejected = assert.rejects(an, { name: 'AbortError' }); controller.abort(); await rejected;
  const b = broker.synthesize({ text: '第二句' }); const bn = b.next();
  assert.equal(socket.sent.at(-1).type, 'cancel');
  socket.receive({ type: 'audio', id, audio }); socket.receive({ type: 'done', id });
  const next = socket.sent.at(-1); assert.equal(next.type, 'synthesize'); assert.notEqual(next.id, id);
  socket.receive({ type: 'audio', id: next.id, audio }); socket.receive({ type: 'done', id: next.id });
  assert.equal((await bn).value.length, 4); await b.next();
});
test('bad worker output closes its socket, rejects pending jobs, and never falls back to another voice', async t => {
  const { broker, socket } = fixture(t);
  const stream = broker.synthesize({ text: '你好' }); const next = stream.next(); const id = socket.sent.at(-1).id;
  const rejected = assert.rejects(next, /断开/); socket.receive({ type: 'audio', id, audio: 'not PCM!' }); await rejected;
  assert.equal(broker.ready, false); assert.equal(socket.readyState, 3);
  await assert.rejects(broker.synthesize({ text: '你好' }).next(), /启动/);
});
test('worker loss rejects every waiting session; duplicate connections and excessive jobs are rejected', async t => {
  const { broker, socket } = fixture(t);
  assert.throws(() => broker.attach(new Socket()), /already/);
  const pending = [1, 2, 3].map(i => broker.synthesize({ text: `句子${i}` }).next());
  await assert.rejects(broker.synthesize({ text: '第四句' }).next(), /繁忙/);
  const assertions = pending.map(p => assert.rejects(p, /断开/)); socket.close(); await Promise.all(assertions);
});
test('DeepSeek local GPU output uses the broker and preserves playback accounting without OpenAI', async () => {
  const events = []; let text;
  const session = new DeepSeekSession({ env: { DEEPSEEK_TTS: 'local-gpu' }, settings: sessionSettings(), emit: e => events.push(e), close() {},
    fetcher: async () => { throw new Error('No OpenAI request expected'); },
    localVoice: { async *synthesize(options) { text = options.text; yield new Uint8Array([1, 0, 2, 0]); } },
  });
  await session.run({ greeting: true });
  assert.match(text, /天天/); assert.equal(events.filter(e => e.type === 'response.output_audio.delta').length, 1);
  assert.equal(events.at(-1).response.status, 'completed'); assert.equal(session.outputs.get('answer_ds_1').bytes, 4);
  session.dispose();
});
