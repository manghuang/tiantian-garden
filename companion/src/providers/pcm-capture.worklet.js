// Mono PCM16LE, 24 kHz, in 100 ms packets. AudioContext resamples microphone input.
class GardenCapture extends AudioWorkletProcessor {
  constructor() {
    super(); this.mode = 'off'; this.offset = 0; this.packet = new ArrayBuffer(4800); this.view = new DataView(this.packet);
    this.port.onmessage = ({ data }) => {
      if (data && typeof data === 'object' && data.type === 'flush') {
        if (this.offset) {
          new Uint8Array(this.packet).fill(0, this.offset);
          this.port.postMessage(this.packet, [this.packet]);
          this.packet = new ArrayBuffer(4800); this.view = new DataView(this.packet); this.offset = 0;
        }
        this.mode = 'off'; this.port.postMessage({ type: 'flushed', token: data.token });
        return;
      }
      const next = typeof data === 'object' && data ? data.mode : data === true ? 'capture' : 'off';
      this.mode = next === 'capture' || next === 'silence' ? next : 'off';
      if (this.mode === 'off') this.offset = 0;
    };
  }
  process(inputs) {
    const samples = inputs[0]?.[0];
    if (this.mode === 'off' || !samples) return true;
    for (const value of samples) {
      const v = this.mode === 'silence' ? 0 : Math.max(-1, Math.min(1, value));
      this.view.setInt16(this.offset, v < 0 ? v * 32768 : v * 32767, true); this.offset += 2;
      if (this.offset === 4800) {
        this.port.postMessage(this.packet, [this.packet]);
        this.offset = 0; this.packet = new ArrayBuffer(4800); this.view = new DataView(this.packet);
      }
    }
    return true;
  }
}
registerProcessor('garden-capture', GardenCapture);
