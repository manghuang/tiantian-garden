import test from 'node:test';
import assert from 'node:assert/strict';
import { deepseekReply } from '../shared/deepseek.js';
const env = { DEEPSEEK_API_KEY: 'test-deepseek-secret' };
const reply = { text: '你好呀，今天想一起发现什么？', action: 'wave', emotion: 'warm' };
const response = (value, finish_reason = 'stop') => Response.json({ choices: [{ finish_reason, message: { content: JSON.stringify(value), reasoning_content: 'private reasoning' } }] });

test('DeepSeek uses its official endpoint, server role prompt, non-thinking mode and validated behavior', async () => {
  let request;
  const result = await deepseekReply({ env, settings: { instructions: 'replace me', model: 'bad' }, history: [{ role: 'user', content: '你是谁？' }, { role: 'assistant', content: '我是天天。' }], text: '你好', fetcher: async (url, options) => { request = { url, ...options }; return response(reply); } });
  assert.deepEqual(result, reply); assert.equal(request.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(request.headers.Authorization, `Bearer ${env.DEEPSEEK_API_KEY}`);
  const body = JSON.parse(request.body); assert.equal(body.model, 'deepseek-flash'); assert.equal(body.thinking.type, 'disabled');
  assert.equal(body.messages[0].role, 'system'); assert.ok(!body.messages[0].content.includes('replace me'));
  assert.equal(body.messages.at(-1).content, '你好'); assert.ok(!JSON.stringify(result).includes('private reasoning'));
});
test('DeepSeek rejects unsafe roles, malformed actions and truncated or oversized responses', async () => {
  await assert.rejects(deepseekReply({ env, history: [{ role: 'system', content: 'bad' }], text: '你好' }), /状态无效/);
  for (const [value, reason] of [[{ ...reply, action: '__proto__' }, 'stop'], [reply, 'length'], [{ ...reply, text: '' }, 'stop']]) {
    await assert.rejects(deepseekReply({ env, text: '你好', fetcher: async () => response(value, reason) }));
  }
  await assert.rejects(deepseekReply({ env, text: '你好', fetcher: async () => new Response('x'.repeat(33000)) }), /过长/);
});

test('JSON-mode follow-ups serialize assistant history consistently without leaking internal fields', async () => {
  const history = [
    { role: 'assistant', content: '我是天天。', id: 'internal_greeting' },
    { role: 'user', content: '为什么会有彩虹？' },
    { role: 'assistant', content: '水滴让阳光变成“七种颜色”。\n真好看！', action: 'curious', emotion: 'happy', id: 'internal_output' },
  ];
  await deepseekReply({ env, history, text: '刚才说的是什么？', fetcher: async (_url, options) => {
    const messages = JSON.parse(options.body).messages;
    assert.deepEqual(JSON.parse(messages[1].content), { text: history[0].content, action: 'idle', emotion: 'warm' });
    assert.equal(messages[2].content, history[1].content);
    assert.deepEqual(JSON.parse(messages[3].content), { text: history[2].content, action: 'curious', emotion: 'happy' });
    assert.ok(!options.body.includes('internal_'));
    return response(reply);
  } });
  assert.equal(history[2].content, '水滴让阳光变成“七种颜色”。\n真好看！');
});
test('DeepSeek errors and cancellation never expose provider bodies or credentials', async () => {
  await assert.rejects(deepseekReply({ env: {}, text: '你好' }), e => e.status === 503);
  await assert.rejects(deepseekReply({ env, text: '你好', fetcher: async () => new Response('sensitive provider body', { status: 429 }) }), e => e.status === 429 && !e.message.includes('sensitive'));
  const abort = new AbortController(); abort.abort();
  await assert.rejects(deepseekReply({ env, text: '你好', signal: abort.signal, fetcher: async (_url, options) => { options.signal.throwIfAborted(); } }), e => e.status === 499);
});
