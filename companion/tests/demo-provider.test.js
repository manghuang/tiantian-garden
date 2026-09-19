import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoProvider } from '../src/providers/demo.js';
import { localSpeech } from '../src/local-speech.js';

function setup(t) {
  const timers = [], events = [], speeches = [];
  t.mock.method(globalThis, 'setTimeout', fn => { timers.push(fn); return timers.length; });
  t.mock.method(globalThis, 'clearTimeout', () => {});
  t.mock.method(localSpeech, 'stop', () => {});
  t.mock.method(localSpeech, 'speak', async (text, settings, hooks) => { speeches.push({ text, settings, hooks }); hooks.onStart(); });
  const provider = new DemoProvider({ emit: (type, value) => events.push({ type, value }) });
  return { provider, timers, events, speeches };
}

test('rapid replacement and interrupted audio cannot advance a stale story turn', async t => {
  const { provider, timers, events, speeches } = setup(t);
  await provider.connect({ activity: 'story' });
  provider.sendText('故事'); provider.sendText('故事');
  timers[0](); assert.equal(speeches.length, 0); timers[1]();
  assert.equal(provider.conversation.node, 'seed');
  provider.sendText('花盆'); timers[2]();
  speeches[0].hooks.onEnd(); assert.equal(provider.speaking, true);
  assert.equal(provider.conversation.node, 'pot');
  assert.ok(events.some(e => e.type === 'choices' && e.value.includes('画个小太阳')));
  provider.disconnect(); speeches[1].hooks.onEnd(); assert.equal(provider.speaking, false);
});

test('goodbye closes only after its audio finishes; interrupt cancels the pending end', async t => {
  const { provider, timers, speeches, events } = setup(t);
  await provider.connect({ activity: 'chat' });
  provider.sendText('再见'); timers[0]();
  assert.ok(!events.some(e => e.type === 'sessionEnd'));
  provider.interrupt(); speeches[0].hooks.onEnd();
  assert.ok(!events.some(e => e.type === 'sessionEnd'));
  provider.sendText('再见'); timers[1](); speeches[1].hooks.onEnd();
  assert.equal(events.filter(e => e.type === 'sessionEnd').length, 1);
});
