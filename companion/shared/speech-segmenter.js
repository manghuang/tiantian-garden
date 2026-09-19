// Conservative energy gate for the chained provider: 200 ms speech onset,
// 1.1 s pause, 300 ms pre-roll, max 20 s per utterance. Not semantic VAD.
export class SpeechSegmenter {
  constructor({ onStart, onEnd, onLimit }) { Object.assign(this, { onStart, onEnd, onLimit }); this.reset(); }
  reset() { this.pre = []; this.chunks = []; this.bytes = 0; this.voiced = 0; this.silence = 0; this.recording = false; this.dropping = false; }
  flush() {
    if (!this.recording || this.dropping || !this.bytes) { this.reset(); return false; }
    const pcm = new Uint8Array(this.bytes); let offset = 0;
    for (const chunk of this.chunks) { pcm.set(chunk, offset); offset += chunk.length; }
    this.reset(); this.onEnd(pcm); return true;
  }
  append(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); let sum = 0;
    for (let i = 0; i < bytes.length; i += 2) sum += (view.getInt16(i, true) / 32768) ** 2;
    const speaking = Math.sqrt(sum / (bytes.length / 2)) >= 0.012;
    const ms = bytes.length / 48;
    this.silence = speaking ? 0 : this.silence + ms;
    if (this.dropping) { if (this.silence >= 1100) this.reset(); return; }
    if (!this.recording) {
      this.pre.push(bytes); while (this.pre.reduce((n, b) => n + b.length, 0) > 14400) this.pre.shift();
      this.voiced = speaking ? this.voiced + ms : 0;
      if (this.voiced < 200) return;
      this.recording = true; this.chunks = this.pre; this.pre = []; this.bytes = this.chunks.reduce((n, b) => n + b.length, 0); this.onStart();
    } else { this.chunks.push(bytes); this.bytes += bytes.length; }
    if (this.bytes > 960000) { this.chunks = []; this.bytes = 0; this.dropping = true; this.onLimit(); return; }
    if (this.silence >= 1100) {
      const pcm = new Uint8Array(this.bytes); let offset = 0;
      for (const chunk of this.chunks) { pcm.set(chunk, offset); offset += chunk.length; }
      this.reset(); this.onEnd(pcm);
    }
  }
}
