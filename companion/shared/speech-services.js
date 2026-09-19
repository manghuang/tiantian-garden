import { VOICE_STYLES, voiceStyle } from './voice.js';

const CLOUDFLARE_TTS_MODELS = new Set(['minimax/speech-2.8-hd', 'minimax/speech-2.8-turbo']);
const CLOUDFLARE_TTS_DEFAULT_MODEL = 'minimax/speech-2.8-turbo';
const CLOUDFLARE_MELOTTS_MODEL = '@cf/myshell-ai/melotts';
const DEFAULT_MELOTTS_LANGUAGE = 'zh';
const OUTPUT_SAMPLE_RATE = 24000;
const MAX_OUTPUT_BYTES = 1440000;
const MAX_WAV_BYTES = 4000000;

export function deepseekSpeech(env) {
  const asr = env.DEEPSEEK_ASR === 'cloudflare' && typeof env.AI?.run === 'function' ? 'cloudflare' : env.OPENAI_API_KEY ? 'openai' : 'none';
  // Keep an unset variable compatible with the original provider matrix. The
  // Cloudflare deployment and .dev.vars.example opt into MeloTTS explicitly;
  // tests, embedded callers and older installations still get OpenAI output
  // when an OpenAI key exists, or local speech when it does not.
  const requestedTTS = typeof env.DEEPSEEK_TTS === 'string' && env.DEEPSEEK_TTS.trim()
    ? env.DEEPSEEK_TTS.trim()
    : (env.OPENAI_API_KEY ? 'openai' : 'local');
  const tts = requestedTTS === 'local-gpu' ? 'local-gpu'
    : requestedTTS === 'cloudflare-melotts' ? 'cloudflare-melotts'
      : ['cloudflare', 'cloudflare-minimax'].includes(requestedTTS) ? 'cloudflare-minimax'
        : requestedTTS === 'openai' ? (env.OPENAI_API_KEY ? 'openai' : 'local')
          : requestedTTS === 'local' ? 'local'
            : env.OPENAI_API_KEY ? 'openai' : 'local';
  const ttsReady = tts === 'cloudflare-minimax' ? cloudflareTTSReady(env) : tts === 'cloudflare-melotts' ? cloudflareMeloTTSReady(env) : true;
  return { asr, tts, audio: asr !== 'none', audioOutput: tts !== 'local', ttsReady };
}

function cloudflareTTSModel(env) {
  const model = typeof env.CLOUDFLARE_TTS_MODEL === 'string' && env.CLOUDFLARE_TTS_MODEL.trim() ? env.CLOUDFLARE_TTS_MODEL.trim() : CLOUDFLARE_TTS_DEFAULT_MODEL;
  return model;
}

function cloudflareTTSVoiceId(env) {
  return typeof env.CLOUDFLARE_TTS_VOICE_ID === 'string' ? env.CLOUDFLARE_TTS_VOICE_ID.trim() : '';
}

export function cloudflareTTSReady(env) {
  const voiceId = cloudflareTTSVoiceId(env);
  return typeof env.AI?.run === 'function' && CLOUDFLARE_TTS_MODELS.has(cloudflareTTSModel(env)) && voiceId.length > 0 && voiceId.length <= 256 && !/[\r\n]/.test(voiceId);
}

export function cloudflareMeloTTSReady(env) {
  return typeof env.AI?.run === 'function';
}

export function cloudflareTTSConfigError(env) {
  const mode = deepseekSpeech(env).tts;
  if (mode === 'cloudflare-melotts') {
    if (!cloudflareMeloTTSReady(env)) return 'Cloudflare Workers AI 的 AI 绑定尚未配置。';
    return '';
  }
  if (mode !== 'cloudflare-minimax') return '';
  if (typeof env.AI?.run !== 'function') return 'Cloudflare Workers AI 的 AI 绑定尚未配置。';
  if (!CLOUDFLARE_TTS_MODELS.has(cloudflareTTSModel(env))) return 'CLOUDFLARE_TTS_MODEL 只支持 minimax/speech-2.8-hd 或 minimax/speech-2.8-turbo。';
  if (!cloudflareTTSVoiceId(env)) return '请在 Worker Secret 中设置 CLOUDFLARE_TTS_VOICE_ID。';
  if (cloudflareTTSVoiceId(env).length > 256 || /[\r\n]/.test(cloudflareTTSVoiceId(env))) return 'CLOUDFLARE_TTS_VOICE_ID 格式无效。';
  return '';
}

async function transcribeCloudflare(env, pcm, signal) {
  const bytes = pcmWav(pcm); let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  const deadline = boundedSignal(signal); deadline.throwIfAborted();
  let abort;
  try {
    // The binding does not expose upstream cancellation. Stop waiting on abort
    // and discard late results; the provider may still finish that invocation.
    const cancelled = new Promise((_, reject) => { abort = () => reject(deadline.reason); deadline.addEventListener('abort', abort, { once: true }); });
    const result = await Promise.race([env.AI.run('@cf/openai/whisper-large-v3-turbo', {
      audio: btoa(binary), language: 'zh', task: 'transcribe', vad_filter: true, condition_on_previous_text: false,
    }), cancelled]);
    if (typeof result?.text !== 'string' || !result.text.trim() || result.text.length > 500) throw new Error();
    return result.text.trim();
  } catch {
    if (signal?.aborted) throw signal.reason;
    throw new Error('语音识别暂时没有完成，请稍后再说一次。');
  } finally { deadline.removeEventListener('abort', abort); }
}

export function pcmWav(pcm) {
  if (!(pcm instanceof Uint8Array) || !pcm.length || pcm.length % 2 || pcm.length > 960000) throw new Error('语音片段无效或超过 20 秒。');
  const bytes = new Uint8Array(44 + pcm.length), v = new DataView(bytes.buffer);
  const ascii = (offset, text) => [...text].forEach((c, i) => v.setUint8(offset + i, c.charCodeAt(0)));
  ascii(0, 'RIFF'); v.setUint32(4, 36 + pcm.length, true); ascii(8, 'WAVE'); ascii(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 24000, true); v.setUint32(28, 48000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  ascii(36, 'data'); v.setUint32(40, pcm.length, true); bytes.set(pcm, 44); return bytes;
}
const boundedSignal = signal => signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000);
async function checked(response) {
  if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error('语音服务暂时不可用，请稍后再试。'); }
  return response;
}

function numberSetting(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function cloudflareMeloTTSLanguage(env) {
  const language = typeof env.CLOUDFLARE_MELOTTS_LANG === 'string' ? env.CLOUDFLARE_MELOTTS_LANG.trim().toLowerCase() : '';
  return /^[a-z]{2}(?:-[a-z]{2})?$/.test(language) ? language : DEFAULT_MELOTTS_LANGUAGE;
}

export function cloudflareMeloTTSPlaybackRate(env, style) {
  const fallback = VOICE_STYLES[voiceStyle(style)].rate;
  return numberSetting(env.CLOUDFLARE_MELOTTS_PLAYBACK_RATE, fallback, 0.85, 1.15);
}

function cloudflareTTSInput(env, text, style) {
  const selected = voiceStyle(style);
  const defaultSpeed = selected === 'gentle' ? 0.93 : 1.04;
  const defaultEmotion = selected === 'gentle' ? 'calm' : 'happy';
  const emotions = new Set(['happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised', 'calm', 'fluent']);
  const emotion = typeof env.CLOUDFLARE_TTS_EMOTION === 'string' && emotions.has(env.CLOUDFLARE_TTS_EMOTION.trim()) ? env.CLOUDFLARE_TTS_EMOTION.trim() : defaultEmotion;
  return {
    format: 'wav',
    pitch: numberSetting(env.CLOUDFLARE_TTS_PITCH, 0, -12, 12),
    speed: numberSetting(env.CLOUDFLARE_TTS_SPEED, defaultSpeed, 0.5, 2),
    text,
    voice_id: cloudflareTTSVoiceId(env),
    volume: numberSetting(env.CLOUDFLARE_TTS_VOLUME, 1, 0, 10),
    emotion,
  };
}

async function* meloTTSStream({ env, text, signal }) {
  if (!cloudflareMeloTTSReady(env)) throw new Error(cloudflareTTSConfigError(env) || 'Cloudflare MeloTTS 尚未配置。');
  const deadline = boundedSignal(signal); deadline.throwIfAborted(); let abort; let reader;
  try {
    const cancelled = new Promise((_, reject) => { abort = () => reject(deadline.reason); deadline.addEventListener('abort', abort, { once: true }); });
    const response = await Promise.race([env.AI.run(CLOUDFLARE_MELOTTS_MODEL, {
      prompt: text, lang: cloudflareMeloTTSLanguage(env),
    }, { returnRawResponse: true }), cancelled]);
    if (!response?.ok || !response.body || typeof response.body.getReader !== 'function') {
      await response?.body?.cancel?.(); throw new Error();
    }
    const contentType = response.headers?.get?.('content-type') || '';
    if (/json/i.test(contentType)) { await response.body.cancel(); throw new Error(); }
    reader = response.body.getReader(); let total = 0;
    while (true) {
      deadline.throwIfAborted(); const part = await reader.read(); if (part.done) break;
      if (!(part.value instanceof Uint8Array) || !part.value.length) continue;
      total += part.value.length;
      if (total > MAX_OUTPUT_BYTES) { await reader.cancel(); throw new Error('回答音频过长，请重新开始。'); }
      for (let offset = 0; offset < part.value.length; offset += 24000) {
        deadline.throwIfAborted(); yield part.value.slice(offset, offset + 24000);
      }
    }
    if (!total) throw new Error();
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    if (error?.message === '回答音频过长，请重新开始。') throw error;
    throw new Error('Cloudflare MeloTTS 暂时没有返回可播放音频。');
  } finally {
    try { await reader?.cancel?.(); } catch { /* The provider may already have closed the stream. */ }
    reader?.releaseLock?.(); deadline.removeEventListener('abort', abort);
  }
}

async function boundedBytes(response, signal) {
  const reader = response.body.getReader(); const chunks = []; let total = 0;
  try {
    while (true) {
      signal.throwIfAborted(); const part = await reader.read(); if (part.done) break;
      total += part.value.length;
      if (total > MAX_WAV_BYTES) { await reader.cancel(); throw new Error('回答音频过长，请重新开始。'); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

function ascii(bytes, offset, length) {
  let value = '';
  for (let i = 0; i < length; i++) value += String.fromCharCode(bytes[offset + i]);
  return value;
}

function wavPCM16(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 44 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WAVE') throw new Error('语音服务返回格式无效。');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); let format = null; let dataStart = -1; let dataLength = 0;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const type = ascii(bytes, offset, 4); const length = view.getUint32(offset + 4, true); const start = offset + 8; const end = start + length;
    if (end > bytes.length) throw new Error('语音服务返回格式无效。');
    if (type === 'fmt ' && length >= 16) format = { audioFormat: view.getUint16(start, true), channels: view.getUint16(start + 2, true), sampleRate: view.getUint32(start + 4, true), blockAlign: view.getUint16(start + 12, true), bits: view.getUint16(start + 14, true) };
    if (type === 'data' && dataStart < 0) { dataStart = start; dataLength = length; }
    offset = end + (length % 2);
  }
  if (!format || format.audioFormat !== 1 || format.channels < 1 || format.channels > 2 || format.bits !== 16 || format.blockAlign !== format.channels * 2 || !format.sampleRate || dataStart < 0 || !dataLength || dataLength % format.blockAlign) throw new Error('语音服务返回格式无效。');
  const frames = dataLength / format.blockAlign; const source = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame++) {
    let sum = 0;
    for (let channel = 0; channel < format.channels; channel++) sum += view.getInt16(dataStart + frame * format.blockAlign + channel * 2, true);
    source[frame] = sum / format.channels;
  }
  const targetFrames = Math.max(1, Math.round(frames * OUTPUT_SAMPLE_RATE / format.sampleRate));
  if (targetFrames * 2 > MAX_OUTPUT_BYTES) throw new Error('回答音频过长，请重新开始。');
  const output = new Uint8Array(targetFrames * 2); const target = new DataView(output.buffer);
  for (let frame = 0; frame < targetFrames; frame++) {
    const position = frame * format.sampleRate / OUTPUT_SAMPLE_RATE; const left = Math.min(frames - 1, Math.floor(position)); const right = Math.min(frames - 1, left + 1); const fraction = position - left;
    const sample = Math.max(-32768, Math.min(32767, Math.round(source[left] + (source[right] - source[left]) * fraction)));
    target.setInt16(frame * 2, sample, true);
  }
  return output;
}

async function cloudflareTTSWav({ env, text, style, signal, fetcher }) {
  if (!cloudflareTTSReady(env)) throw new Error(cloudflareTTSConfigError(env) || 'Cloudflare 天天音色服务尚未配置。');
  const deadline = boundedSignal(signal); deadline.throwIfAborted(); let abort;
  try {
    const cancelled = new Promise((_, reject) => { abort = () => reject(deadline.reason); deadline.addEventListener('abort', abort, { once: true }); });
    const result = await Promise.race([env.AI.run(cloudflareTTSModel(env), cloudflareTTSInput(env, text, style)), cancelled]);
    const audioUrl = result?.result?.audio ?? result?.audio;
    if (typeof audioUrl !== 'string' || !/^https:\/\//.test(audioUrl)) throw new Error('语音服务返回格式无效。');
    const response = await checked(await fetcher(audioUrl, { signal: deadline }));
    if (response.headers.get('content-type')?.includes('json')) { await response.body.cancel(); throw new Error('语音服务返回格式无效。'); }
    return wavPCM16(await boundedBytes(response, deadline));
  } finally { deadline.removeEventListener('abort', abort); }
}

export async function* speechCloudflarePCM({ env, text, style, signal, fetcher = fetch }) {
  const pcm = await cloudflareTTSWav({ env, text, style, signal, fetcher });
  for (let offset = 0; offset < pcm.length; offset += 24000) { signal?.throwIfAborted(); yield pcm.slice(offset, offset + 24000); }
}

export async function* speechCloudflareMeloTTS({ env, text, style, signal }) {
  for await (const bytes of meloTTSStream({ env, text, signal })) yield bytes;
}

export async function transcribePCM({ env, pcm, signal, fetcher = fetch }) {
  if (deepseekSpeech(env).asr === 'cloudflare') return transcribeCloudflare(env, pcm, signal);
  const body = new FormData(); body.set('file', new Blob([pcmWav(pcm)], { type: 'audio/wav' }), 'speech.wav');
  body.set('model', env.OPENAI_TRANSCRIPTION_MODEL || 'gpt-4o-mini-transcribe'); body.set('language', 'zh'); body.set('response_format', 'json');
  const response = await checked(await fetcher('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` }, body, signal: boundedSignal(signal),
  }));
  const reader = response.body.getReader(); let bytes = 0, raw = ''; const decoder = new TextDecoder();
  try {
    while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.length; if (bytes > 8000) { await reader.cancel(); throw new Error('识别内容过长，请分成短句。'); } raw += decoder.decode(part.value, { stream: true }); }
    raw += decoder.decode();
  } finally { reader.releaseLock(); }
  const text = JSON.parse(raw).text;
  if (typeof text !== 'string' || !text.trim() || text.length > 500) throw new Error('刚才没有听清，请慢慢再说一次。');
  return text.trim();
}
export async function* speechPCM({ env, text, style, signal, fetcher = fetch }) {
  const response = await checked(await fetcher('https://api.openai.com/v1/audio/speech', {
    method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }, signal: boundedSignal(signal),
    body: JSON.stringify({ model: env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts', input: text,
      voice: env.OPENAI_CUSTOM_VOICE_ID ? { id: env.OPENAI_CUSTOM_VOICE_ID } : env.OPENAI_TTS_VOICE || 'coral',
      instructions: VOICE_STYLES[voiceStyle(style)].instructions, response_format: 'pcm' }),
  }));
  if (response.headers.get('content-type')?.includes('json')) { await response.body.cancel(); throw new Error('语音服务返回格式无效。'); }
  const reader = response.body.getReader(); let carry = null, total = 0;
  try {
    while (true) {
      signal?.throwIfAborted(); const part = await reader.read(); if (part.done) break;
      let bytes = part.value; total += bytes.length;
      if (total > MAX_OUTPUT_BYTES) throw new Error('回答音频过长，请重新开始。');
      if (carry !== null) { const joined = new Uint8Array(bytes.length + 1); joined[0] = carry; joined.set(bytes, 1); bytes = joined; carry = null; }
      if (bytes.length % 2) { carry = bytes.at(-1); bytes = bytes.subarray(0, -1); }
      for (let offset = 0; offset < bytes.length; offset += 24000) yield bytes.slice(offset, offset + 24000);
    }
    if (!total || carry !== null) throw new Error('回答音频不完整，请再试一次。');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
