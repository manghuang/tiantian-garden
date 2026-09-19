import { deepseekReply } from './deepseek.js';
import { safetyReply } from './behavior.js';
import { speechCloudflareMeloTTS, speechCloudflarePCM, speechPCM, transcribePCM, cloudflareMeloTTSPlaybackRate, deepseekSpeech } from './speech-services.js';
import { SpeechSegmenter } from './speech-segmenter.js';
import { moderateText, ModerationError, reviewedFallback } from './moderation.js';

const encode = bytes => { let text = ''; for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(text); };
const allowed = (value, keys) => Object.keys(value).every(k => keys.includes(k));
export class DeepSeekSession {
  constructor({ env, settings, emit, close, fetcher = fetch, now = Date.now, localVoice }) {
    Object.assign(this, { env, settings, emit, close, fetcher, now, localVoice });
    const speech = deepseekSpeech(env); this.audio = speech.audioOutput; this.audioInput = speech.audio;
    this.history = []; this.outputs = new Map(); this.number = 0; this.closed = false; this.turns = [];
    this.window = now(); this.frames = 0; this.commands = 0; this.budget = 96000; this.audioAt = now();
    this.segmenter = new SpeechSegmenter({
      onStart: () => { this.interrupt(); this.emit({ type: 'input_audio_buffer.speech_started' }); },
      onEnd: pcm => { this.emit({ type: 'input_audio_buffer.speech_stopped' }); void this.run({ pcm }); },
      onLimit: () => { this.emit({ type: 'garden.notice', message: '这句话有点长，停一下，再分成短句说吧。' }); this.emit({ type: 'garden.idle' }); },
    });
  }
  start() { this.emit({ type: 'garden.ready' }); void this.run({ greeting: true }); }
  dispose() { this.closed = true; this.interrupt(); this.history = []; this.outputs.clear(); this.segmenter.reset(); }
  fail() { if (this.closed) return; this.emit({ type: 'garden.error', message: '请求无效或发送过快，请重新开始。' }); this.dispose(); this.close(); }
  interrupt() {
    if (!this.job) return;
    const job = this.job; this.job = null; job.abort.abort();
    if (!this.closed) this.emit({ type: 'response.done', response: { id: job.id, status: 'cancelled', output: [] } });
  }
  checkDeadline() { if (this.job && this.now() - this.job.started > 55000) { this.interrupt(); this.emit({ type: 'garden.notice', message: '回答等得有点久，请再试一次。' }); this.emit({ type: 'garden.idle' }); } }
  client(raw) {
    if (this.closed) return;
    try {
      if (typeof raw !== 'string' || raw.length > 14000) throw new Error();
      const e = JSON.parse(raw), now = this.now();
      if (!e || typeof e !== 'object' || Array.isArray(e)) throw new Error();
      if (now - this.window >= 1000) { this.window = now; this.frames = this.commands = 0; }
      if (++this.frames > 40 || (e.type !== 'audio' && ++this.commands > 12)) throw new Error();
      if (e.type === 'ping' && allowed(e, ['type'])) this.emit({ type: 'garden.pong' });
      else if (e.type === 'clear' && allowed(e, ['type'])) this.segmenter.reset();
      else if (e.type === 'audio_end' && allowed(e, ['type'])) this.segmenter.flush();
      else if (e.type === 'text' && allowed(e, ['type', 'text']) && typeof e.text === 'string' && e.text.trim() && e.text.length <= 500) { this.segmenter.reset(); void this.run({ text: e.text.trim() }); }
      else if (['interrupt', 'played'].includes(e.type) && allowed(e, ['type', 'itemId', 'playedMs'])) {
        if (e.itemId !== undefined) {
          const output = this.outputs.get(e.itemId);
           const maxPlayedMs = output?.maxPlayedMs ?? output?.bytes / 48;
           if (!output || !Number.isInteger(e.playedMs) || e.playedMs < 0 || e.playedMs > maxPlayedMs) throw new Error();
          // We cannot map TTS milliseconds to exact words. Drop the incomplete
          // assistant turn rather than pretending the whole answer was heard.
          this.history = this.history.filter(m => m.id !== e.itemId); this.outputs.delete(e.itemId);
        } else if (e.playedMs !== undefined) throw new Error();
        if (e.type === 'interrupt') this.interrupt();
      } else if (e.type === 'audio' && this.audioInput && allowed(e, ['type', 'audio']) && typeof e.audio === 'string' && e.audio.length > 0 && e.audio.length <= 12800 && e.audio.length % 4 === 0 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(e.audio)) {
        const bytes = Uint8Array.from(atob(e.audio), c => c.charCodeAt(0)); if (bytes.length % 2) throw new Error();
        this.budget = Math.min(96000, this.budget + Math.max(0, now - this.audioAt) * 60); this.audioAt = now; this.budget -= bytes.length;
        if (this.budget < 0) throw new Error(); this.segmenter.append(bytes);
      } else throw new Error();
    } catch { this.fail(); }
  }
  async run({ text, pcm, greeting = false }) {
    this.interrupt();
    this.turns = this.turns.filter(t => t > this.now() - 60000);
    if (this.turns.length >= 20) { this.emit({ type: 'garden.notice', message: '让天天休息一会儿，一分钟后再聊吧。' }); this.emit({ type: 'garden.idle' }); return; }
    this.turns.push(this.now());
    const job = { id: `ds_${++this.number}`, abort: new AbortController(), started: this.now() }; this.job = job;
    const current = () => !this.closed && this.job === job && !job.abort.signal.aborted;
    this.emit({ type: 'response.created', response: { id: job.id } });
    try {
      if (pcm) {
        text = await transcribePCM({ env: this.env, pcm, signal: job.abort.signal, fetcher: this.fetcher });
        if (!current()) return;
        this.emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: `user_${job.id}`, transcript: text });
      }
      let reply = greeting ? { text: '你好呀，我是屏幕里的 AI 小狗天天！今天想聊些什么呢？', action: 'wave', emotion: 'warm' } : safetyReply(text);
      let retain = !reply;
      const review = value => moderateText({ env: this.env, text: value, signal: job.abort.signal, fetcher: this.fetcher });
      if (!reply && this.env.OPENAI_API_KEY) {
        const input = await review(text); if (!current()) return;
        if (input.flagged) { reply = reviewedFallback(input); retain = false; }
      }
      if (!reply) {
        reply = await deepseekReply({ env: this.env, settings: this.settings, history: this.history, text, signal: job.abort.signal, fetcher: this.fetcher });
        if (!current()) return;
        if (this.env.OPENAI_API_KEY) {
          const output = await review(reply.text); if (!current()) return;
          if (output.flagged) { reply = reviewedFallback(); retain = false; }
        }
      }
      if (!current()) return;
      // Keep neither sensitive inputs nor rejected generations in later model context.
      if (!greeting && !retain) this.history = [];
      if (retain) { this.history.push({ role: 'user', content: text }); this.history = this.history.slice(-20); }
      const itemId = `answer_${job.id}`;
      this.emit({ type: 'garden.behavior', response_id: job.id, behavior: { action: reply.action, emotion: reply.emotion } });
      this.emit({ type: 'response.output_audio_transcript.done', response_id: job.id, item_id: itemId, transcript: reply.text });
       const tts = deepseekSpeech(this.env).tts;
       const audioFormat = tts === 'cloudflare-melotts' ? 'audio/mpeg' : 'audio/pcm';
       const output = { bytes: 0, ...(audioFormat === 'audio/mpeg' ? { maxPlayedMs: 30000 } : {}) }; this.outputs.set(itemId, output);
       if (this.outputs.size > 16) this.outputs.delete(this.outputs.keys().next().value);
       if (this.audio) {
        try {
         const speechOptions = { env: this.env, text: reply.text, style: this.settings.voiceStyle, signal: job.abort.signal, fetcher: this.fetcher };
         const stream = tts === 'local-gpu' ? this.localVoice.synthesize(speechOptions) : tts === 'cloudflare-minimax' ? speechCloudflarePCM(speechOptions) : tts === 'cloudflare-melotts' ? speechCloudflareMeloTTS(speechOptions) : speechPCM(speechOptions);
         for await (const bytes of stream) {
           if (!current()) return; output.bytes += bytes.length;
           this.emit({ type: 'response.output_audio.delta', response_id: job.id, item_id: itemId, delta: encode(bytes), ...(audioFormat === 'audio/mpeg' ? { audio_format: audioFormat } : {}) });
         }
         if (audioFormat === 'audio/mpeg') this.emit({ type: 'response.output_audio.done', response_id: job.id, item_id: itemId, audio_format: audioFormat, playback_rate: cloudflareMeloTTSPlaybackRate(this.env, this.settings.voiceStyle) });
        } catch (error) {
          if (!current()) return;
          if (!['cloudflare-melotts', 'cloudflare-minimax'].includes(tts)) throw error;
          this.emit({ type: 'garden.notice', message: tts === 'cloudflare-minimax' ? 'Cloudflare MiniMax 语音暂时不可用，正在尝试本机中文朗读；你仍可继续打字或说话。' : '云端语音暂时不可用，正在尝试本机中文朗读；你仍可继续打字或说话。' });
          this.emit({ type: 'garden.speech_fallback', response_id: job.id, item_id: itemId, transcript: reply.text });
        }
       }
      if (!current()) return;
      this.history.push({ id: itemId, role: 'assistant', content: reply.text, action: reply.action, emotion: reply.emotion }); this.history = this.history.slice(-20);
      this.job = null; this.emit({ type: 'response.done', response: { id: job.id, status: 'completed', output: [] } });
    } catch (error) {
      if (!current()) return; this.job = null;
      this.emit({ type: 'response.done', response: { id: job.id, status: 'failed', output: [] } });
      this.emit({ type: 'garden.notice', message: error instanceof ModerationError ? error.message : '天天刚刚没能完整回答，请再试一次。' });
    }
  }
}
