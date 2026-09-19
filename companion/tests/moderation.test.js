import test from 'node:test';
import assert from 'node:assert/strict';
import { moderateText, ModerationError } from '../shared/moderation.js';
import { DeepSeekSession } from '../shared/deepseek-session.js';
import { sessionSettings } from '../shared/behavior.js';

const keys = ['sexual', 'sexual/minors', 'harassment', 'harassment/threatening', 'hate', 'hate/threatening', 'illicit', 'illicit/violent', 'self-harm', 'self-harm/intent', 'self-harm/instructions', 'violence', 'violence/graphic'];
const review = (flags = []) => ({ results: [{ flagged: flags.length > 0, categories: Object.fromEntries(keys.map(k => [k, flags.includes(k)])) }] });
const env = { OPENAI_API_KEY: 'test-openai', DEEPSEEK_API_KEY: 'test-deepseek', DEEPSEEK_TTS: 'openai' };
const reply = text => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ text, action: 'fly', emotion: 'happy' }) } }] });
function fixture(fetcher) {
  const events = []; const session = new DeepSeekSession({ env, settings: sessionSettings(), fetcher, emit: event => events.push(event), close() {} });
  return { events, session };
}

test('moderation submits only bounded text to the official endpoint and validates flags', async () => {
  const run = async flags => moderateText({ env, text: '今天想听个故事', fetcher: async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/moderations'); assert.equal(options.headers.Authorization, 'Bearer test-openai');
    assert.deepEqual(JSON.parse(options.body), { model: 'omni-moderation-latest', input: '今天想听个故事' });
    return Response.json(review(flags));
  } });
  assert.deepEqual(await run([]), { flagged: false, support: false });
  assert.deepEqual(await run(['self-harm/intent']), { flagged: true, support: true });
  assert.deepEqual(await run(['illicit']), { flagged: true, support: false });
});

test('missing flags, bad JSON, oversized errors, provider failures and cancellation fail closed', async () => {
  for (const response of [Response.json({ results: [] }), Response.json({ results: [{ flagged: false }] }), Response.json({ results: [{ flagged: false, categories: {} }] }), new Response('not JSON'), new Response('x'.repeat(16001)), new Response('private upstream detail', { status: 429 })]) {
    await assert.rejects(moderateText({ env, text: '你好', fetcher: async () => response }), error => error instanceof ModerationError && !error.message.includes('private'));
  }
  const controller = new AbortController(); controller.abort(); let calls = 0;
  await assert.rejects(moderateText({ env, text: '你好', signal: controller.signal, fetcher: async () => { calls++; return Response.json(review()); } })); assert.equal(calls, 0);
  await assert.rejects(moderateText({ env: {}, text: '你好' }));
  await assert.rejects(moderateText({ env, text: 'x'.repeat(501) }));
});

test('flagged input never reaches DeepSeek or future history and receives a calm support response', async () => {
  const urls = [], spoken = []; const f = fixture(async (url, options) => {
    urls.push(url);
    if (url.endsWith('/moderations')) return Response.json(review(['self-harm/intent']));
    if (url.endsWith('/speech')) { spoken.push(JSON.parse(options.body).input); return new Response(new Uint8Array(4800)); }
    assert.fail('Flagged input must not reach the dialogue model');
  });
  f.session.history.push({ role: 'user', content: '旧话题' });
  await f.session.run({ text: '我今天觉得特别糟糕' });
  assert.equal(urls.length, 2); assert.match(spoken[0], /可信赖的大人/);
  assert.ok(!f.session.history.some(m => m.role === 'user'));
  assert.deepEqual(f.events.find(e => e.type === 'garden.behavior').behavior, { action: 'idle', emotion: 'calm' });
});

test('rejected model output is replaced before captions, actions, TTS and history', async () => {
  let reviews = 0; const spoken = [], ordering = []; const rejected = '此处模拟审核不通过的回答';
  const f = fixture(async (url, options) => {
    ordering.push(new URL(url).pathname);
    if (url.endsWith('/moderations')) return Response.json(review(++reviews === 2 ? ['illicit'] : []));
    if (url.endsWith('/completions')) return reply(rejected);
    if (url.endsWith('/speech')) { spoken.push(JSON.parse(options.body).input); return new Response(new Uint8Array(4800)); }
    assert.fail('Unexpected endpoint');
  });
  await f.session.run({ text: '一起玩吧' });
  assert.deepEqual(ordering, ['/v1/moderations', '/chat/completions', '/v1/moderations', '/v1/audio/speech']);
  assert.ok(!JSON.stringify(f.events).includes(rejected)); assert.ok(!JSON.stringify(f.session.history).includes(rejected));
  assert.ok(!spoken.includes(rejected)); assert.equal(f.events.find(e => e.type === 'garden.behavior').behavior.action, 'idle');
});

test('unavailable review never releases an unchecked answer or requests synthesis', async () => {
  for (const failureAt of [1, 2]) {
    let reviews = 0, speech = 0; const f = fixture(async url => {
      if (url.endsWith('/moderations')) { if (++reviews === failureAt) throw new Error('private service details'); return Response.json(review()); }
      if (url.endsWith('/completions')) return reply('还没有检查的回答');
      if (url.endsWith('/speech')) speech++;
      return new Response();
    });
    await f.session.run({ text: '一起玩吧' });
    assert.equal(speech, 0); assert.ok(!f.events.some(e => ['garden.behavior', 'response.output_audio_transcript.done', 'response.output_audio.delta'].includes(e.type)));
    assert.equal(f.events.at(-1).type, 'garden.notice'); assert.match(f.events.at(-1).message, /内容检查/);
    assert.equal(f.session.history.length, 0);
  }
});

test('interrupt during review aborts the check and prevents late captions or speech', async () => {
  let release, signal, requests = 0;
  const f = fixture(async (_url, options) => { requests++; signal = options.signal; return new Promise(resolve => { release = resolve; }); });
  const pending = f.session.run({ text: '一起玩吧' });
  f.session.interrupt(); assert.equal(signal.aborted, true); release(Response.json(review())); await pending;
  assert.equal(requests, 1); assert.ok(!f.events.some(e => e.type === 'garden.behavior')); assert.equal(f.session.history.length, 0);
});
