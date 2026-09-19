import { realtimeSession } from './realtime-session.js';
import { validateBehavior } from './behavior.js';

const isId = value => typeof value === 'string' && /^[\w-]{1,128}$/.test(value);
const exact = (value, keys) => Object.keys(value).every(key => keys.includes(key));
const pcm = value => typeof value === 'string' && value.length > 0 && value.length <= 12800 && value.length % 4 === 0 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);

// This is an application protocol, not a tunnel for arbitrary Realtime events.
export class VoiceRelay {
  constructor({ env, settings, send, emit, close, now = Date.now }) {
    Object.assign(this, { env, settings, send, emit, close, now });
    this.closed = false; this.ready = false; this.pending = false; this.active = null;
    this.cancelled = new Set(); this.handled = new Set(); this.finished = new Set(); this.items = new Map(); this.texts = [];
    this.window = now(); this.frames = 0; this.commands = 0; this.audioBudget = 96000; this.audioAt = now(); this.audioBuffered = false; this.audioCommitted = false;
  }
  fail(message = '语音连接已关闭，请重新开始。') {
    if (this.closed) return;
    this.closed = true; this.texts = []; this.items.clear(); this.handled.clear(); this.cancelled.clear(); this.audioBuffered = false; this.audioCommitted = false;
    this.emit({ type: 'garden.error', message }); this.close();
  }
  start() {
    const session = realtimeSession(this.env, this.settings, { manualInput: true }); delete session.model;
    session.audio.input.format = { type: 'audio/pcm', rate: 24000 };
    session.audio.output.format = { type: 'audio/pcm', rate: 24000 };
    this.send({ type: 'session.update', session });
  }
  request(response = {}) { this.pending = true; this.turnAt = this.now(); this.send({ type: 'response.create', response }); }
  checkDeadline() { if ((this.pending || this.active) && this.now() - this.turnAt > 45000) this.fail('回答等待太久，请重新开始。'); }
  interrupt() {
    if (this.active) {
      if (!this.cancelled.has(this.active)) this.send({ type: 'response.cancel', response_id: this.active });
      this.cancelled.add(this.active);
    } else if (this.pending) this.cancelOnStart = true;
  }
  client(raw) {
    if (this.closed) return;
    try {
      if (typeof raw !== 'string' || raw.length > 14000) throw new Error();
      const e = JSON.parse(raw);
      if (!e || typeof e !== 'object' || Array.isArray(e) || !this.ready) throw new Error();
      const now = this.now();
      if (now - this.window >= 1000) { this.window = now; this.frames = 0; this.commands = 0; }
      if (++this.frames > 40 || (e.type !== 'audio' && ++this.commands > 12)) throw new Error();
      switch (e.type) {
        case 'audio': {
          if (!exact(e, ['type', 'audio']) || !pcm(e.audio)) throw new Error();
          const bytes = e.audio.length / 4 * 3 - (e.audio.endsWith('==') ? 2 : e.audio.endsWith('=') ? 1 : 0);
          if (bytes % 2) throw new Error();
          this.audioBudget = Math.min(96000, this.audioBudget + Math.max(0, now - this.audioAt) * 60);
          this.audioAt = now; this.audioBudget -= bytes;
          if (this.audioBudget < 0) throw new Error();
          if (!this.audioBuffered) { this.interrupt(); this.emit({ type: 'input_audio_buffer.speech_started' }); }
          this.audioBuffered = true;
          this.send({ type: 'input_audio_buffer.append', audio: e.audio }); break;
        }
        case 'audio_end':
          if (!exact(e, ['type'])) throw new Error();
          if (this.audioBuffered) { this.audioBuffered = false; this.audioCommitted = true; this.send({ type: 'input_audio_buffer.commit' }); this.drain(); }
          break;
        case 'text':
          if (!exact(e, ['type', 'text']) || typeof e.text !== 'string' || !e.text.trim() || e.text.length > 500 || this.texts.length >= 3) throw new Error();
          this.texts.push(e.text.trim()); this.interrupt(); this.drain(); break;
        case 'played':
        case 'interrupt':
          if (!exact(e, ['type', 'itemId', 'playedMs'])) throw new Error();
          if (e.itemId !== undefined) {
            const item = this.items.get(e.itemId);
            if (!item || !Number.isInteger(e.playedMs) || e.playedMs < 0 || e.playedMs > item.bytes / 48) throw new Error();
            this.send({ type: 'conversation.item.truncate', item_id: e.itemId, content_index: 0, audio_end_ms: e.playedMs });
            this.items.delete(e.itemId);
          } else if (e.playedMs !== undefined) throw new Error();
          if (e.type === 'interrupt') this.interrupt(); break;
        case 'clear':
          if (!exact(e, ['type'])) throw new Error();
          this.audioBuffered = false; this.audioCommitted = false; this.send({ type: 'input_audio_buffer.clear' }); break;
        case 'ping':
          if (!exact(e, ['type'])) throw new Error();
          this.emit({ type: 'garden.pong' }); break;
        default: throw new Error();
      }
    } catch { this.fail('语音请求格式无效或发送过快，请重新开始。'); }
  }
  drain() {
    if (!this.ready || this.active || this.pending) return;
    if (this.texts.length) {
      for (const text of this.texts.splice(0)) this.send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } });
      this.request(); return;
    }
    if (this.audioCommitted) { this.audioCommitted = false; this.request(); }
  }
  upstream(raw) {
    if (this.closed) return;
    try {
      if (typeof raw !== 'string' || raw.length > 1500000) throw new Error();
      const e = JSON.parse(raw); const id = e.response_id ?? e.response?.id;
      if (e.type === 'session.created') return;
      if (e.type === 'session.updated') {
        if (this.ready) return;
        this.ready = true; this.emit({ type: 'garden.ready' });
        this.request({ instructions: '请用一句话介绍你是屏幕里的 AI 小狗天天，再问今天想聊什么。', tool_choice: 'none' });
        return;
      }
      if (!this.ready && e.type !== 'error') return;
      if (e.type === 'response.created') {
        if (!isId(e.response?.id)) throw new Error();
        this.pending = false; this.active = id; this.turnAt = this.now();
        this.emit({ type: e.type, response: { id } });
        if (this.cancelOnStart) { this.cancelOnStart = false; this.interrupt(); }
        return;
      }
      if (id && this.cancelled.has(id) && e.type !== 'response.done') return;
      switch (e.type) {
        case 'input_audio_buffer.speech_started':
          this.interrupt(); this.emit({ type: e.type }); break;
        case 'input_audio_buffer.speech_stopped': this.emit({ type: e.type }); break;
        case 'conversation.item.input_audio_transcription.completed':
          if (isId(e.item_id) && typeof e.transcript === 'string') this.emit({ type: e.type, item_id: e.item_id, transcript: e.transcript.slice(0, 4000) }); break;
        case 'conversation.item.input_audio_transcription.failed': this.emit({ type: e.type }); break;
        case 'response.output_audio.delta': {
          if (!isId(e.item_id) || !isId(id) || typeof e.delta !== 'string' || e.delta.length > 1000000) throw new Error();
          const item = this.items.get(e.item_id) || { bytes: 0 };
          item.bytes += e.delta.length / 4 * 3 - (e.delta.endsWith('==') ? 2 : e.delta.endsWith('=') ? 1 : 0);
          if (item.bytes > 48 * 30000) throw new Error(); // 30 seconds per short response.
          this.items.set(e.item_id, item);
          if (this.items.size > 16) this.items.delete(this.items.keys().next().value);
          this.emit({ type: e.type, response_id: id, item_id: e.item_id, delta: e.delta }); break;
        }
        case 'response.output_audio_transcript.delta':
        case 'response.output_audio_transcript.done':
          if (isId(e.item_id) && isId(id)) this.emit({ type: e.type, response_id: id, item_id: e.item_id, ...(e.type.endsWith('.done') ? { transcript: String(e.transcript || '').slice(0, 4000) } : { delta: String(e.delta || '').slice(0, 4000) }) }); break;
        case 'response.done': {
          if (!isId(id)) throw new Error();
          if (this.finished.has(id)) return;
          this.finished.add(id); if (this.finished.size > 200) this.finished.delete(this.finished.values().next().value);
          if (!Array.isArray(e.response.output) || e.response.output.length > 8) throw new Error();
          if (id === this.active) { this.active = null; this.pending = false; }
          const cancelled = this.cancelled.delete(id);
          let count = 0;
          for (const item of e.response.output || []) {
            if (item.type !== 'function_call' || !isId(item.call_id) || this.handled.has(item.call_id)) continue;
            this.handled.add(item.call_id);
            let behavior = null;
            try { if (item.name === 'perform_behavior' && typeof item.arguments === 'string' && item.arguments.length <= 1000) behavior = validateBehavior(JSON.parse(item.arguments)); } catch { /* Rejected below. */ }
            const accepted = !cancelled && !this.toolContinuation && e.response.status === 'completed' && count === 0 && Boolean(behavior);
            if (accepted) this.emit({ type: 'garden.behavior', response_id: id, behavior });
            this.send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: item.call_id, output: JSON.stringify(accepted ? { ok: true, ...behavior } : { ok: false, error: 'Invalid or excess behavior' }) } });
            count++;
          }
          this.emit({ type: e.type, response: { id, status: e.response.status, output: [] } });
          if (this.handled.size > 200) this.handled.delete(this.handled.values().next().value);
          if (this.texts.length) { this.toolContinuation = false; this.drain(); }
          else if (count && !cancelled && !this.toolContinuation) { this.toolContinuation = true; this.request({ tool_choice: 'none' }); }
          else { this.toolContinuation = false; this.drain(); }
          break;
        }
        case 'error':
          if (!['response_cancel_not_active', 'conversation_already_has_active_response'].includes(e.error?.code)) this.fail('语音服务遇到问题，请稍后重新连接。');
          break;
      }
    } catch { this.fail('语音服务返回了无效内容，请重新连接。'); }
  }
}
