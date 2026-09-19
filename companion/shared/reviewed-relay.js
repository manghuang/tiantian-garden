import { VoiceRelay } from './voice-relay.js';
import { moderateText } from './moderation.js';

// Realtime output is buffered in RAM until its complete transcript is checked.
// Input audio still goes directly to Realtime; this is not an input review gate.
export class ReviewedRelay {
  constructor(options) {
    this.options = options; this.emit = options.emit; this.now = options.now || Date.now;
    this.closed = false; this.responses = new Map(); this.carried = []; this.bytes = 0; this.queue = Promise.resolve();
    this.relay = new VoiceRelay({ ...options, emit: event => this.accept(event) });
  }
  start() { this.relay.start(); }
  upstream(raw) { this.relay.upstream(raw); }
  client(raw) {
    // Validation, rate limits and authoritative command handling stay in VoiceRelay.
    try { if (typeof raw === 'string' && raw.length <= 14000 && ['interrupt', 'text'].includes(JSON.parse(raw)?.type)) this.cancel(); } catch { /* Validated below. */ }
    this.relay.client(raw);
  }
  checkDeadline() {
    this.relay.checkDeadline();
    for (const response of this.responses.values()) if (response.reviewAt !== undefined && this.now() - response.reviewAt > 9000) { this.fail('内容检查等待太久，请稍后重新开始。'); break; }
  }
  fail(message) { if (!this.closed) this.relay.fail(message); }
  dispose() {
    if (this.closed) return;
    this.closed = true; this.relay.closed = true;
    for (const response of this.responses.values()) response.abort.abort();
    this.responses.clear(); this.carried = []; this.bytes = 0;
    this.relay.texts = []; this.relay.items.clear(); this.relay.handled.clear(); this.relay.cancelled.clear();
  }
  remove(response) {
    if (!this.responses.delete(response.id)) return;
    this.bytes -= response.bytes; response.abort.abort();
    response.audio = []; response.transcripts.clear(); response.actions = [];
  }
  cancel() {
    this.carried = []; this.queue = Promise.resolve();
    for (const response of [...this.responses.values()]) {
      // None of this buffered audio reached the browser, so none was heard.
      for (const itemId of response.items) {
        if (this.relay.items.has(itemId)) {
          this.options.send({ type: 'conversation.item.truncate', item_id: itemId, content_index: 0, audio_end_ms: 0 });
          this.relay.items.delete(itemId);
        }
      }
      if (response.done) this.emit({ type: 'response.done', response: { id: response.id, status: 'cancelled', output: [] } });
      this.remove(response);
    }
  }
  accept(event) {
    if (this.closed) return;
    if (event.type === 'garden.error') { this.dispose(); this.emit(event); return; }
    if (event.type === 'input_audio_buffer.speech_started') this.cancel();
    const id = event.response_id ?? event.response?.id;
    if (event.type === 'response.created') {
      if (this.responses.has(id) || this.responses.size >= 3) { this.fail('回答积压，请重新开始。'); return; }
      this.responses.set(id, { id, audio: [], items: new Set(), transcripts: new Map(), actions: this.carried.splice(0), bytes: 0, abort: new AbortController() });
      this.emit(event); return;
    }
    const response = this.responses.get(id);
    if (['response.output_audio.delta', 'response.output_audio_transcript.delta', 'response.output_audio_transcript.done', 'garden.behavior'].includes(event.type)) {
      if (!response || response.done) { this.fail('语音回答顺序无效，请重新开始。'); return; }
      if (event.type === 'garden.behavior') { if (response.actions.length < 1) response.actions.push(event.behavior); return; }
      if (event.type === 'response.output_audio_transcript.delta') return; // Never leak unchecked partial captions.
      if (event.type === 'response.output_audio_transcript.done') {
        if (response.transcripts.has(event.item_id) || typeof event.transcript !== 'string' || !event.transcript.trim() || event.transcript.length > 500 || response.transcripts.size >= 4) { this.fail('回答文字不完整或过长，请重新开始。'); return; }
        response.transcripts.set(event.item_id, event); return;
      }
      const encoded = event.delta;
      if (!encoded || encoded.length % 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) { this.fail('回答音频格式无效。'); return; }
      const bytes = encoded.length / 4 * 3 - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0);
      if (bytes % 2 || this.bytes + bytes > 1440000 || response.audio.length >= 2000) { this.fail('回答音频过长，请重新开始。'); return; }
      response.bytes += bytes; this.bytes += bytes; response.items.add(event.item_id); response.audio.push(event); return;
    }
    if (event.type !== 'response.done') { this.emit(event); return; }
    if (!response) { this.emit(event); return; }
    if (event.response.status !== 'completed') { this.remove(response); this.emit(event); return; }
    if (!response.audio.length && !response.transcripts.size) {
      // A tool-only response precedes the spoken continuation; hold its action.
      this.carried = response.actions.slice(0, 1); this.remove(response); this.emit(event); return;
    }
    const text = [...response.transcripts.values()].map(e => e.transcript).join('\n');
    if (!response.audio.length || !text.trim() || text.length > 500 || [...response.items].some(itemId => !response.transcripts.has(itemId))) { this.fail('回答缺少完整的语音或文字，已停止播放。'); return; }
    response.done = event; response.reviewAt = this.now();
    this.queue = this.queue.then(() => this.review(response)).catch(() => this.fail('内容检查暂时不可用，请重新开始。'));
  }
  async review(response) {
    const current = () => !this.closed && this.responses.get(response.id) === response && !response.abort.signal.aborted;
    if (!current()) return;
    try {
      const result = await moderateText({ env: this.options.env, text: [...response.transcripts.values()].map(e => e.transcript).join('\n'), signal: response.abort.signal, fetcher: this.options.fetcher });
      if (!current()) return;
      if (result.flagged) { this.fail('刚才的回答没有通过内容检查，互动已停止。请换个话题重新开始。'); return; }
      for (const behavior of response.actions) this.emit({ type: 'garden.behavior', response_id: response.id, behavior });
      for (const transcript of response.transcripts.values()) this.emit(transcript);
      // Bound individual frames while releasing a complete checked utterance.
      for (const event of response.audio) for (let offset = 0; offset < event.delta.length; offset += 32000) this.emit({ ...event, delta: event.delta.slice(offset, offset + 32000) });
      this.emit(response.done); this.remove(response);
    } catch { if (current()) this.fail('内容检查暂时不可用，互动已停止，请稍后再试。'); }
  }
}
