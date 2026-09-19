// Fallback for mobile browsers that expose AudioWorklet but cannot load its module.
// Keep the same PCM packet/flush protocol and a silent output to avoid microphone echo.
export function compatibleCapture(context) {
  const node = context.createScriptProcessor(2048, 1, 1);
  let mode = 'off', offset = 0, packet = new ArrayBuffer(4800), view = new DataView(packet);
  const port = { onmessage: null, postMessage(data) {
    if (data?.type === 'flush') {
      if (offset) { new Uint8Array(packet).fill(0, offset); sendPacket(); }
      mode = 'off'; port.onmessage?.({ data: { type: 'flushed', token: data.token } });
      return;
    }
    mode = data?.mode === 'capture' ? 'capture' : 'off';
    if (mode === 'off') offset = 0;
  } };
  function sendPacket() {
    const completed = packet;
    packet = new ArrayBuffer(4800); view = new DataView(packet); offset = 0;
    port.onmessage?.({ data: completed });
  }
  node.onaudioprocess = event => {
    event.outputBuffer.getChannelData(0).fill(0);
    if (mode !== 'capture') return;
    for (const sample of event.inputBuffer.getChannelData(0)) {
      const value = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, value < 0 ? value * 32768 : value * 32767, true); offset += 2;
      if (offset === 4800) sendPacket();
    }
  };
  return {
    node, port,
    connect(destination) { node.connect(destination); },
    disconnect() { mode = 'off'; offset = 0; port.onmessage = null; node.onaudioprocess = null; node.disconnect(); },
  };
}
