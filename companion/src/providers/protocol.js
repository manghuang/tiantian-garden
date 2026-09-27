import { validateBehavior } from '../../shared/behavior.js';

// Only documented events reach the view; tool arguments are data, never code.
export class RealtimeProtocol {
  constructor({ send, emit, model = 'balanced' }) {
    this.send = send; this.emit = emit; this.model = model; this.active = null; this.interrupted = new Set(); this.handled = new Set();
  }
  interrupt() {
    if (this.active) { this.interrupted.add(this.active); this.send({ type: 'response.cancel', response_id: this.active }); }
    this.send({ type: 'output_audio_buffer.clear' });
    this.emit('speaking', false);
  }
  handle(event) {
    const id = event.response_id ?? event.response?.id;
    if (id && this.interrupted.has(id) && event.type !== 'response.done') return;
    switch (event.type) {
      case 'response.created': this.active = event.response.id; this.emit('state', 'thinking'); break;
      case 'input_audio_buffer.speech_started':
        if (this.active) this.interrupted.add(this.active);
        this.emit('speaking', false); this.emit('state', 'listening'); this.emit('interrupt'); break;
      case 'input_audio_buffer.speech_stopped': this.emit('state', 'thinking'); break;
      case 'conversation.item.input_audio_transcription.completed':
        if (event.transcript?.trim()) this.emit('transcript', { role: 'user', text: event.transcript, id: event.item_id }); break;
      case 'conversation.item.input_audio_transcription.failed': this.emit('notice', '刚才的话没有转成文字，可以慢慢再说一次。'); break;
      case 'response.output_audio_transcript.delta': this.emit('delta', { id: event.item_id, text: event.delta }); break;
      case 'response.output_audio_transcript.done': this.emit('transcript', { role: 'assistant', text: event.transcript, id: event.item_id }); break;
      case 'output_audio_buffer.started': this.emit('speaking', true); this.emit('state', 'speaking'); break;
      case 'output_audio_buffer.stopped':
      case 'output_audio_buffer.cleared': this.emit('speaking', false); this.emit('state', 'ready'); break;
      case 'response.done': {
        if (this.active === id) this.active = null;
        if (this.interrupted.has(id)) { this.interrupted.delete(id); this.emit('responseEnd'); break; }
        if (event.response.status === 'failed') { this.emit('notice', '天天刚刚没能回答，请再试一次。'); this.emit('state', 'ready'); }
        let toolCount = 0;
        for (const item of event.response.output ?? []) {
          if (item.type !== 'function_call' || !item.call_id || this.handled.has(item.call_id)) continue;
          this.handled.add(item.call_id);
          let behavior = null;
          try { behavior = item.name === 'perform_behavior' ? validateBehavior(JSON.parse(item.arguments), this.model) : null; } catch { /* Invalid tool JSON is rejected. */ }
          const accepted = behavior && toolCount === 0;
          if (accepted) this.emit('behavior', behavior);
          this.send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: item.call_id, output: JSON.stringify({ ok: Boolean(accepted), ...(accepted ? behavior : { error: 'Invalid or excess behavior' }) }) } });
          toolCount++;
        }
        // Prevent a recursive tool loop; the follow-up should speak to the child.
        if (toolCount) this.send({ type: 'response.create', response: { tool_choice: 'none' } });
        this.emit('responseEnd');
        break;
      }
      case 'error':
        if (!['response_cancel_not_active', 'output_audio_buffer_clear_not_active'].includes(event.error?.code)) this.emit('notice', '语音服务遇到问题，请重试或重新连接。');
        break;
    }
    if (this.handled.size > 200) this.handled.delete(this.handled.values().next().value);
  }
}
