import test from 'node:test';
import assert from 'node:assert/strict';
import { RealtimeProtocol } from '../src/providers/protocol.js';

function harness() { const sent = [], emitted = []; return { sent, emitted, p: new RealtimeProtocol({ send: e => sent.push(e), emit: (type, value) => emitted.push({ type, value }) }) }; }
const call = (id, args = '{"action":"wave","emotion":"happy"}', name = 'perform_behavior') => ({ type: 'function_call', call_id: id, name, arguments: args });
const done = (output, id = 'response1') => ({ type: 'response.done', response: { id, status: 'completed', output } });

test('tool results are returned and follow-up speech forbids another tool loop', () => {
  const { p, sent, emitted } = harness(); p.handle(done([call('c1')]));
  assert.deepEqual(emitted.find(e => e.type === 'behavior').value, { action: 'wave', emotion: 'happy' });
  assert.equal(sent[0].item.type, 'function_call_output'); assert.equal(sent[0].item.call_id, 'c1');
  assert.equal(sent[1].response.tool_choice, 'none');
});
test('duplicate function calls are not replayed', () => {
  const { p, sent, emitted } = harness(); p.handle(done([call('c1')])); p.handle(done([call('c1')]));
  assert.equal(emitted.filter(e => e.type === 'behavior').length, 1); assert.equal(sent.length, 2);
});
test('malformed, unsupported or multiple tool requests cannot run arbitrary behavior', () => {
  for (const item of [call('c1', '{invalid'), call('c1', '{"action":"exec","emotion":"happy"}'), call('c1', '{}', 'shell')]) {
    const { p, sent, emitted } = harness(); p.handle(done([item]));
    assert.equal(emitted.filter(e => e.type === 'behavior').length, 0); assert.equal(JSON.parse(sent[0].item.output).ok, false);
  }
  const { p, emitted } = harness(); p.handle(done([call('c1'), call('c2')])); assert.equal(emitted.filter(e => e.type === 'behavior').length, 1);
});
test('barge-in suppresses stale captions and actions from the interrupted response', () => {
  const { p, emitted } = harness(); p.handle({ type: 'response.created', response: { id: 'r' } });
  p.handle({ type: 'input_audio_buffer.speech_started' });
  p.handle({ type: 'response.output_audio_transcript.delta', response_id: 'r', item_id: 'i', delta: 'late' });
  p.handle(done([call('c1')], 'r'));
  assert.equal(emitted.filter(e => ['behavior', 'delta'].includes(e.type)).length, 0);
});
test('manual interruption cancels generation and clears WebRTC playback', () => {
  const { p, sent } = harness(); p.handle({ type: 'response.created', response: { id: 'r' } }); p.interrupt();
  assert.deepEqual(sent.map(e => e.type), ['response.cancel', 'output_audio_buffer.clear']);
});
test('generation completion does not prematurely close the mouth while buffered audio is playing', () => {
  const { p, emitted } = harness(); p.handle({ type: 'output_audio_buffer.started' }); p.handle(done([]));
  assert.deepEqual(emitted.filter(e => e.type === 'speaking').map(e => e.value), [true]);
  p.handle({ type: 'output_audio_buffer.stopped' }); assert.deepEqual(emitted.filter(e => e.type === 'speaking').map(e => e.value), [true, false]);
});
