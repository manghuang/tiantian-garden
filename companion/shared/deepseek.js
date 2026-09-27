import { EMOTIONS, MODEL_ACTIONS, instructions, sessionSettings, validateBehavior } from './behavior.js';

export class DeepSeekError extends Error {
  constructor(message, status = 502) { super(message); this.name = 'DeepSeekError'; this.status = status; }
}

// Server-only adapter. Conversation history must come from the server's session
// store; never pass browser-supplied roles, system instructions or prior replies.
export async function deepseekReply({ env, settings, history = [], text, signal, fetcher = fetch }) {
  if (!env.DEEPSEEK_API_KEY) throw new DeepSeekError('尚未配置 DEEPSEEK_API_KEY。', 503);
  if (typeof text !== 'string' || !text.trim() || text.length > 500) throw new DeepSeekError('请把想说的话控制在 500 字以内。', 400);
  if (!Array.isArray(history) || history.length > 20 || history.some(m => !['user', 'assistant'].includes(m?.role) || typeof m.content !== 'string' || m.content.length > 500)) throw new DeepSeekError('对话状态无效，请重新开始。', 400);
  const normalizedSettings = sessionSettings(settings);
  const actions = MODEL_ACTIONS[normalizedSettings.model];
  const prompt = instructions(normalizedSettings) + `\n当前通道的输出格式：不调用工具，不朗读格式说明；只返回一个 JSON 对象，包含 text、action、emotion 三个字段。text 是面向孩子的简短中文回答；action 可选 ${actions.join('、')}；emotion 可选 ${EMOTIONS.join('、')}。`;
  try {
    const response = await fetcher('https://api.deepseek.com/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.DEEPSEEK_API_KEY}` },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
      body: JSON.stringify({ model: env.DEEPSEEK_MODEL || 'deepseek-flash', thinking: { type: 'disabled' }, stream: false,
        max_tokens: 384, response_format: { type: 'json_object' },
        // JSON-mode continuations need assistant history in the same output
        // format. Plain assistant prose caused blank real API responses.
        messages: [{ role: 'system', content: prompt }, ...history.map(m => ({ role: m.role,
          content: m.role === 'assistant' ? JSON.stringify({ text: m.content, ...(validateBehavior(m, normalizedSettings.model) || { action: 'idle', emotion: 'warm' }) }) : m.content,
        })), { role: 'user', content: text.trim() }],
      }),
    });
    if (!response.ok) { await response.body?.cancel(); throw new DeepSeekError('DeepSeek 暂时无法回应，请稍后再试。', response.status === 429 ? 429 : 502); }
    if (!response.body) throw new DeepSeekError('DeepSeek 没有返回完整回答，请再试一次。');
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let bytes = 0, raw = '';
    try {
      while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.length; if (bytes > 32000) { await reader.cancel(); throw new DeepSeekError('回答过长，请再试一次。'); } raw += decoder.decode(part.value, { stream: true }); }
      raw += decoder.decode();
    } finally { reader.releaseLock(); }
    const choice = JSON.parse(raw).choices?.[0];
    if (choice?.finish_reason !== 'stop' || typeof choice.message?.content !== 'string') throw new DeepSeekError('DeepSeek 没有返回完整回答，请再试一次。');
    const reply = JSON.parse(choice.message.content), behavior = validateBehavior(reply, normalizedSettings.model);
    if (!behavior || typeof reply.text !== 'string' || !reply.text.trim() || reply.text.length > 500) throw new DeepSeekError('回答格式暂时不正确，请再试一次。');
    return { text: reply.text.trim(), ...behavior };
  } catch (error) {
    if (signal?.aborted) throw new DeepSeekError('本次回答已取消。', 499);
    if (error instanceof DeepSeekError) throw error;
    throw new DeepSeekError('DeepSeek 连接超时或回应无效，请稍后再试。');
  }
}
