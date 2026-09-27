import { DemoConversation } from '../../shared/activities.js';
import { localSpeech } from '../local-speech.js';

export class DemoProvider {
  constructor({ emit }) { this.emit = emit; this.generation = 0; }
  async connect(settings) { this.settings = settings; this.conversation = new DemoConversation(settings.activity, settings.model); this.closed = false; this.emit('state', 'ready'); }
  sendText(text) {
    this.interrupt();
    const generation = this.generation;
    this.emit('state', 'thinking');
    this.timer = setTimeout(() => {
      if (this.closed || generation !== this.generation) return;
      const reply = this.conversation.reply(text);
      this.emit('behavior', reply);
      this.emit('transcript', { role: 'assistant', text: reply.text, id: crypto.randomUUID() });
      this.emit('choices', reply.choices);
      const finish = () => { if (generation === this.generation && !this.closed) { clearTimeout(this.speechTimer); this.speaking = false; this.emit('speaking', false); this.emit('state', 'ready'); if (reply.endSession) this.emit('sessionEnd'); } };
      void localSpeech.speak(reply.text, this.settings, {
        emotion: reply.emotion,
        onStart: () => { if (generation !== this.generation) return; this.speaking = true; this.emit('speaking', true); this.emit('state', 'speaking'); },
        onEnd: finish,
        onUnavailable: message => this.emit('notice', message),
      });
    }, 450);
  }
  interrupt() {
    this.generation++; clearTimeout(this.timer); clearTimeout(this.speechTimer);
    localSpeech.stop(); this.speaking = false; this.emit('speaking', false); this.emit('state', 'ready');
  }
  setMuted() {}
  resumeAudio() { void localSpeech.resume().catch(() => this.emit('notice', '声音暂未获准播放，请检查浏览器声音权限。')); }
  // Bundled dialogue drives the mouth from PCM; system speech uses an estimate.
  level() { return this.speaking ? localSpeech.level() ?? 0.2 + 0.5 * Math.abs(Math.sin(performance.now() / 115)) : 0; }
  disconnect() { this.closed = true; this.interrupt(); }
}
