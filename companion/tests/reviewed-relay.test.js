import test from 'node:test';
import assert from 'node:assert/strict';
import { ReviewedRelay } from '../shared/reviewed-relay.js';

const keys = ['sexual', 'sexual/minors', 'harassment', 'harassment/threatening', 'hate', 'hate/threatening', 'illicit', 'illicit/violent', 'self-harm', 'self-harm/intent', 'self-harm/instructions', 'violence', 'violence/graphic'];
const review = (flagged = false) => Response.json({ results: [{ flagged, categories: Object.fromEntries(keys.map(k => [k, flagged && k === 'illicit'])) }] });
const created = id => ({ type: 'response.created', response: { id } });
const done = (id, output = [], status = 'completed') => ({ type: 'response.done', response: { id, status, output } });
const voice = (id, item_id = `item_${id}`, bytes = 4800) => ({ type: 'response.output_audio.delta', response_id: id, item_id, delta: Buffer.alloc(bytes).toString('base64') });
const transcript = (id, text = '你好，一起来玩吧！', item_id = `item_${id}`) => ({ type: 'response.output_audio_transcript.done', response_id: id, item_id, transcript: text });
const tool = id => ({ type: 'function_call', call_id: `tool_${id}`, name: 'perform_behavior', arguments: JSON.stringify({ action: 'wave', emotion: 'warm' }) });
const exposed = events => events.filter(e => ['garden.behavior', 'response.output_audio.delta', 'response.output_audio_transcript.delta', 'response.output_audio_transcript.done'].includes(e.type));
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(fetcher = async () => review()) {
  const sent = [], events = []; let closed = 0, time = 0;
  const relay = new ReviewedRelay({ env: { OPENAI_API_KEY: 'test-key' }, settings: {}, send: e => sent.push(e), emit: e => events.push(e), close: () => closed++, fetcher, now: () => time });
  const event = e => relay.upstream(JSON.stringify(e)); relay.start(); event({ type: 'session.updated' });
  return { relay, event, events, sent, closed: () => closed, advance(ms) { time += ms; }, client: e => relay.client(JSON.stringify(e)) };
}

test('Realtime captions, audio and actions remain private until the full output review passes', async () => {
  let release, input; const f = fixture(async (_url, options) => { input = JSON.parse(options.body).input; return new Promise(resolve => { release = resolve; }); });
  f.event(created('r1')); f.event(voice('r1')); f.event({ type: 'response.output_audio_transcript.delta', response_id: 'r1', item_id: 'item_r1', delta: '你好' });
  f.event(transcript('r1')); f.event(done('r1', [tool('1')])); await tick();
  assert.equal(exposed(f.events).length, 0); assert.equal(input, '你好，一起来玩吧！');
  release(review()); await f.relay.queue;
  assert.deepEqual(exposed(f.events).map(e => e.type), ['garden.behavior', 'response.output_audio_transcript.done', 'response.output_audio.delta']);
  assert.equal(f.relay.bytes, 0); assert.equal(f.relay.responses.size, 0);
});

test('tool-only action waits for its checked spoken continuation', async () => {
  const f = fixture(); f.event(created('tool_reply')); f.event(done('tool_reply', [tool('1')]));
  assert.equal(exposed(f.events).length, 0);
  f.event(created('spoken')); f.event(voice('spoken')); f.event(transcript('spoken')); f.event(done('spoken')); await f.relay.queue;
  const action = f.events.find(e => e.type === 'garden.behavior'); assert.equal(action.response_id, 'spoken'); assert.equal(action.behavior.action, 'wave');
  assert.equal(f.events.filter(e => e.type === 'garden.behavior').length, 1);
});

test('flagged, failed or malformed review closes the session without exposing output', async () => {
  for (const fetcher of [async () => review(true), async () => { throw new Error('private body'); }, async () => Response.json({ results: [] })]) {
    const f = fixture(fetcher); f.event(created('r1')); f.event(voice('r1')); f.event(transcript('r1')); f.event(done('r1')); await f.relay.queue;
    assert.equal(exposed(f.events).length, 0); assert.equal(f.closed(), 1); assert.equal(f.relay.responses.size, 0); assert.equal(f.relay.bytes, 0);
    assert.ok(!JSON.stringify(f.events).includes('private body')); assert.equal(f.relay.relay.closed, true);
  }
});

test('manual interrupt and barge-in abort pending review, truncate unheard audio and permit the next reply', async () => {
  for (const mode of ['manual', 'speech']) {
    let release, signal, requests = 0;
    const f = fixture(async (_url, options) => { if (++requests > 1) return review(); signal = options.signal; return new Promise(resolve => { release = resolve; }); });
    f.event(created('old')); f.event(voice('old')); f.event(transcript('old')); f.event(done('old')); await tick();
    if (mode === 'manual') f.client({ type: 'interrupt' }); else f.event({ type: 'input_audio_buffer.speech_started' });
    assert.equal(signal.aborted, true); assert.ok(f.sent.some(e => e.type === 'conversation.item.truncate' && e.item_id === 'item_old' && e.audio_end_ms === 0));
    f.event(created('next')); f.event(voice('next')); f.event(transcript('next')); f.event(done('next')); await f.relay.queue;
    assert.ok(exposed(f.events).some(e => e.response_id === 'next')); assert.ok(!exposed(f.events).some(e => e.response_id === 'old'));
    release(review()); await tick(); assert.ok(!exposed(f.events).some(e => e.response_id === 'old'));
  }
});

test('interrupt while audio is generating discards late output and pending tool actions', async () => {
  const f = fixture(); f.event(created('tool')); f.event(done('tool', [tool('1')]));
  f.event(created('voice')); f.event(voice('voice')); f.client({ type: 'interrupt' });
  f.event(transcript('voice')); f.event(done('voice', [], 'cancelled')); await f.relay.queue;
  assert.equal(exposed(f.events).length, 0); assert.equal(f.relay.bytes, 0); assert.equal(f.relay.carried.length, 0); assert.equal(f.closed(), 0);
});

test('unpaired transcripts, oversized output and invalid PCM never pass the gate', async () => {
  for (const mode of ['missing', 'wrong-item', 'long-text', 'long-audio', 'invalid-pcm']) {
    const f = fixture(); f.event(created('r1'));
    if (mode === 'invalid-pcm') f.event({ ...voice('r1'), delta: 'not base64' });
    else if (mode === 'long-audio') { f.event(voice('r1', 'item_r1', 740000)); f.event(voice('r1', 'item_r2', 740000)); }
    else { f.event(voice('r1')); if (mode !== 'missing') f.event(transcript('r1', mode === 'long-text' ? 'a'.repeat(501) : '你好', mode === 'wrong-item' ? 'another' : 'item_r1')); }
    f.event(done('r1')); await f.relay.queue; assert.equal(f.closed(), 1); assert.equal(exposed(f.events).length, 0);
  }
});

test('output review watchdog and session disposal abort pending work and release memory', async () => {
  for (const mode of ['deadline', 'dispose']) {
    let release, signal; const f = fixture(async (_url, options) => { signal = options.signal; return new Promise(resolve => { release = resolve; }); });
    f.event(created('r1')); f.event(voice('r1')); f.event(transcript('r1')); f.event(done('r1')); await tick();
    if (mode === 'deadline') { f.advance(9001); f.relay.checkDeadline(); } else f.relay.dispose();
    assert.equal(signal.aborted, true); assert.equal(f.relay.bytes, 0); assert.equal(f.relay.responses.size, 0);
    release(review()); await tick(); assert.equal(exposed(f.events).length, 0);
  }
});

test('multiple completed responses retain playback order while review requests are pending', async () => {
  let first; let calls = 0; const f = fixture(async () => { if (++calls === 1) return new Promise(resolve => { first = resolve; }); return review(); });
  for (const id of ['r1', 'r2']) { f.event(created(id)); f.event(voice(id)); f.event(transcript(id)); f.event(done(id)); }
  await tick(); assert.equal(calls, 1); first(review()); await f.relay.queue;
  assert.deepEqual(f.events.filter(e => e.type === 'response.output_audio.delta').map(e => e.response_id), ['r1', 'r2']);
});
