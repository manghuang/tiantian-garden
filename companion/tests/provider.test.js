import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAIProvider } from '../src/providers/openai.js';
import { RealtimeProtocol } from '../src/providers/protocol.js';

test('text submitted before response.created is queued and cancelled after acknowledgment', () => {
  const sent = []; const provider = new OpenAIProvider({ config: {}, emit: () => {} });
  provider.channel = { readyState: 'open', send: raw => sent.push(JSON.parse(raw)) };
  provider.protocol = new RealtimeProtocol({ send: event => provider.send(event), emit: () => {} });
  provider.submitText('第一句'); provider.sendText('第二句'); provider.sendText('第三句');
  assert.equal(sent.filter(e => e.type === 'response.create').length, 1);
  assert.deepEqual(provider.pendingTexts, ['第二句', '第三句']);
  provider.handleEvent({ type: 'response.created', response: { id: 'r1' } });
  assert.ok(sent.some(e => e.type === 'response.cancel' && e.response_id === 'r1'));
});
test('disconnect stops microphone tracks, playback, RTC and audio graph', () => {
  const events = [];
  const provider = new OpenAIProvider({ config: {}, emit: () => {} });
  provider.stream = { getTracks: () => [{ stop: () => events.push('track') }] };
  provider.channel = { close: () => events.push('channel') }; provider.pc = { close: () => events.push('peer') };
  provider.audio = { pause: () => events.push('audio'), srcObject: {} };
  provider.source = { disconnect: () => events.push('source') };
  provider.context = { close: async () => events.push('context') };
  provider.disconnect();
  assert.deepEqual(events, ['track', 'channel', 'peer', 'audio', 'source', 'context']); assert.equal(provider.audio.srcObject, null); assert.equal(provider.closed, true);
});
test('muting disables actual microphone tracks and clears queued input audio', () => {
  const events = [], track = { enabled: true };
  const provider = new OpenAIProvider({ config: {}, emit: () => {} });
  provider.stream = { getAudioTracks: () => [track] }; provider.channel = { readyState: 'open', send: raw => events.push(JSON.parse(raw)) };
  provider.setMuted(true); assert.equal(track.enabled, false); assert.equal(events[0].type, 'input_audio_buffer.clear');
  provider.setMuted(false); assert.equal(track.enabled, true);
});

test('push-to-talk only enables the OpenAI microphone while the button is held', () => {
  const track = { enabled: false };
  const provider = new OpenAIProvider({ config: {}, emit: () => {} });
  provider.stream = { getAudioTracks: () => [track] };
  provider.setPushToTalk(true); assert.equal(track.enabled, true);
  provider.setPushToTalk(false); assert.equal(track.enabled, false);
});
