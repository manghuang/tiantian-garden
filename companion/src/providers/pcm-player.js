export function encodePCM(buffer) {
  const bytes = new Uint8Array(buffer); let raw = '';
  for (let i = 0; i < bytes.length; i += 8192) raw += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(raw);
}
export function decodePCM(encoded) {
  const raw = atob(encoded);
  if (!raw.length || raw.length % 2) throw new Error('Invalid PCM');
  const samples = new Float32Array(raw.length / 2);
  for (let i = 0; i < samples.length; i++) {
    const value = raw.charCodeAt(i * 2) | raw.charCodeAt(i * 2 + 1) << 8;
    samples[i] = (value >= 32768 ? value - 65536 : value) / 32768;
  }
  return samples;
}

function decodeBinary(encoded) {
  const raw = atob(encoded);
  if (!raw.length) throw new Error('Invalid audio');
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function joinedBytes(chunks, total) {
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

export class PCMPlayer {
  constructor(context, state) {
    this.context = context; this.state = state; this.nodes = new Set(); this.items = new Map(); this.next = 0;
    this.analyser = context.createAnalyser(); this.analyser.fftSize = 256; this.analyser.connect(context.destination);
    this.samples = new Uint8Array(256); this.generation = 0;
  }
  append(itemId, encoded, format = 'audio/pcm') {
    if (format === 'audio/mpeg') { this.appendMpeg(itemId, encoded); return; }
    if (format !== 'audio/pcm') throw new Error('Unsupported audio format');
    const samples = decodePCM(encoded); const item = this.items.get(itemId) || { itemId, format, segments: [] };
    if (item.format !== format) throw new Error('Mixed audio formats');
    const buffer = this.context.createBuffer(1, samples.length, 24000); buffer.copyToChannel(samples, 0);
    this.schedule(item, buffer, samples.length / 24000);
  }
  appendMpeg(itemId, encoded) {
    const bytes = decodeBinary(encoded); const item = this.items.get(itemId) || { itemId, format: 'audio/mpeg', segments: [], chunks: [], total: 0 };
    if (item.format !== 'audio/mpeg' || item.finished) throw new Error('Invalid compressed audio sequence');
    item.total += bytes.length;
    if (item.total > 1440000) throw new Error('Playback backlog');
    item.chunks.push(bytes); this.items.set(itemId, item);
    if (this.items.size > 16) this.items.delete(this.items.keys().next().value);
  }
  async finish(itemId, playbackRate = 1) {
    const item = this.items.get(itemId);
    if (!item || item.format !== 'audio/mpeg') return;
    if (item.decoding) return item.decoding;
    item.finished = true; const generation = this.generation; const bytes = joinedBytes(item.chunks, item.total);
    const rate = Number.isFinite(playbackRate) ? Math.min(1.15, Math.max(0.85, playbackRate)) : 1;
    item.decoding = Promise.resolve().then(() => this.context.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))).then(buffer => {
      if (generation !== this.generation || this.items.get(itemId) !== item) return;
      this.schedule(item, buffer, buffer.duration / rate, rate);
    }, error => {
      if (generation === this.generation && this.items.get(itemId) === item) throw error;
    }).finally(() => { if (this.items.get(itemId) === item) item.decoding = null; });
    return item.decoding;
  }
  schedule(item, buffer, duration, playbackRate = 1) {
    const now = this.context.currentTime; const start = Math.max(now + 0.025, this.next);
    if (start + duration - now > 30) throw new Error('Playback backlog');
    item.segments.push({ start, duration }); this.items.set(item.itemId, item);
    if (this.items.size > 16) this.items.delete(this.items.keys().next().value);
    const node = this.context.createBufferSource(); node.buffer = buffer;
    if (node.playbackRate) node.playbackRate.value = playbackRate;
    node.connect(this.analyser);
    node.onended = () => {
      node.disconnect(); this.nodes.delete(node);
      if (!this.nodes.size) this.state(false);
    };
    node.itemId = item.itemId; this.nodes.add(node); this.next = start + duration;
    node.start(start); this.state(true);
  }
  stop() {
    this.generation++;
    const now = this.context.currentTime;
    const items = [...this.items.values()];
    const current = items.find(item => item.segments.some(s => s.start + s.duration > now));
    // Sum actual scheduled segments: network gaps are not heard audio, and an
    // item may receive another packet after its earlier source has ended.
    const heard = current?.segments.reduce((sum, s) => sum + Math.max(0, Math.min(s.duration, now - s.start)), 0) || 0;
    const progress = current ? { itemId: current.itemId, playedMs: Math.floor(heard * 1000) } : {};
    for (const node of this.nodes) { node.onended = null; try { node.stop(); } catch { /* Ended. */ } node.disconnect(); }
    this.nodes.clear(); this.items.clear(); this.next = 0; this.state(false); return progress;
  }
  level() {
    this.analyser.getByteTimeDomainData(this.samples); let sum = 0;
    for (const v of this.samples) sum += ((v - 128) / 128) ** 2;
    return Math.min(1, Math.sqrt(sum / this.samples.length) * 6);
  }
  dispose() { this.stop(); this.analyser.disconnect(); }
}
