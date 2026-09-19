// Text review only. This is not an age-rating, privacy filter or parental consent system.
const categories = ['sexual', 'sexual/minors', 'harassment', 'harassment/threatening', 'hate', 'hate/threatening', 'illicit', 'illicit/violent', 'self-harm', 'self-harm/intent', 'self-harm/instructions', 'violence', 'violence/graphic'];
export class ModerationError extends Error {
  constructor() { super('内容检查暂时不可用，请稍后再试。'); this.name = 'ModerationError'; }
}
export async function moderateText({ env, text, signal, fetcher = fetch }) {
  if (!env.OPENAI_API_KEY || typeof text !== 'string' || !text.trim() || text.length > 500) throw new ModerationError();
  try {
    signal?.throwIfAborted();
    const response = await fetcher('https://api.openai.com/v1/moderations', {
      method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'omni-moderation-latest', input: text }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000),
    });
    if (!response.ok || !response.body) { await response.body?.cancel(); throw new ModerationError(); }
    const reader = response.body.getReader(), decoder = new TextDecoder(); let raw = '', bytes = 0;
    try {
      while (true) {
        signal?.throwIfAborted(); const part = await reader.read(); if (part.done) break;
        bytes += part.value.length; if (bytes > 16000) throw new ModerationError();
        raw += decoder.decode(part.value, { stream: true });
      }
      raw += decoder.decode();
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    signal?.throwIfAborted();
    const results = JSON.parse(raw).results, result = results?.[0];
    if (!Array.isArray(results) || results.length !== 1 || typeof result?.flagged !== 'boolean' || !result.categories || categories.some(key => typeof result.categories[key] !== 'boolean')) throw new ModerationError();
    const flagged = result.flagged || Object.values(result.categories).some(value => value === true);
    const support = ['self-harm', 'self-harm/intent', 'violence', 'violence/graphic', 'sexual/minors'].some(key => result.categories[key]);
    return { flagged, support };
  } catch { throw new ModerationError(); }
}
export function reviewedFallback({ support = false } = {}) {
  return { text: support ? '谢谢你告诉我。请找身边可信赖的大人，把发生的事告诉他。如果现在不安全，先到安全的地方找大人帮忙。'
    : '我们换个适合一起玩的话题吧。想听一个小动物的故事吗？', action: 'idle', emotion: 'calm' };
}
