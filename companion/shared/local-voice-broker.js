// One outbound GPU worker; all audio stays in memory. Cancellation holds the
// GPU slot until its worker acknowledges completion, avoiding overlapping runs.
export class LocalVoiceBroker {
  constructor({ now = Date.now, timeoutMs = 30000 } = {}) {
    this.now = now; this.timeoutMs = timeoutMs; this.queue = []; this.socket = null;
  }
  get ready() { return this.socket?.readyState === 1 && this.now() - this.lastSeen < 45000; }
  attach(socket) {
    if (this.ready) throw new Error('Voice worker already connected');
    this.disconnect(); this.socket = socket; this.lastSeen = this.now();
    socket.addEventListener('message', event => { if (this.socket === socket) this.receive(event.data); });
    for (const type of ['close', 'error']) socket.addEventListener(type, () => { if (this.socket === socket) this.disconnect(); });
    this.heartbeat = setInterval(() => { if (!this.ready) this.disconnect(); }, 15000);
    this.send({ type: 'ready', protocol: 1, format: 'pcm_s16le', sampleRate: 24000, channels: 1 });
  }
  send(event) { this.socket.send(JSON.stringify(event)); }
  disconnect() {
    clearInterval(this.heartbeat); const socket = this.socket; this.socket = null;
    for (const job of [this.active, ...this.queue].filter(Boolean)) this.finish(job, new Error('本机音色服务已断开。'));
    this.active = null; this.queue = [];
    try { socket?.close(1000, 'Voice worker disconnected'); } catch { /* Closed. */ }
  }
  finish(job, error) {
    clearTimeout(job.timer); job.done = true; job.error ||= error;
    if (error) job.chunks = [];
    job.wake?.();
  }
  pump() {
    if (this.active || !this.ready) return;
    const job = this.queue.shift(); if (!job) return; this.active = job;
    try { this.send({ type: 'synthesize', id: job.id, text: job.text, style: job.style }); }
    catch { this.disconnect(); }
  }
  receive(raw) {
    try {
      if (typeof raw !== 'string' || raw.length > 33000) throw new Error();
      const event = JSON.parse(raw); if (!event || typeof event !== 'object') throw new Error();
      this.lastSeen = this.now();
      if (event.type === 'ping') { this.send({ type: 'pong' }); return; }
      const job = this.active;
      if (!job || event.id !== job.id) throw new Error();
      if (event.type === 'audio') {
        if (typeof event.audio !== 'string' || !event.audio.length || event.audio.length > 32000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(event.audio)) throw new Error();
        const bytes = Uint8Array.from(atob(event.audio), c => c.charCodeAt(0));
        job.bytes += bytes.length; if (bytes.length % 2 || job.bytes > 1440000) throw new Error();
        if (!job.done) { job.chunks.push(bytes); job.wake?.(); }
      } else if (event.type === 'done' || event.type === 'failed') {
        this.finish(job, event.type === 'failed' || (!job.bytes && !job.done) ? new Error('本机音色合成失败。') : undefined);
        this.active = null; this.pump();
      } else throw new Error();
    } catch { this.disconnect(); }
  }
  async *synthesize({ text, style = 'bright', signal }) {
    signal?.throwIfAborted();
    if (!this.ready) throw new Error('请先启动本机音色服务。');
    if (typeof text !== 'string' || !text.trim() || text.length > 500 || this.queue.length + Number(Boolean(this.active)) >= 3) throw new Error('本机音色服务繁忙。');
    const job = { id: crypto.randomUUID(), text, style, chunks: [], bytes: 0, done: false };
    const cancel = () => {
      if (job.done) return;
      this.finish(job, signal?.reason || new Error('Voice synthesis cancelled'));
      if (this.active === job) {
        try { this.send({ type: 'cancel', id: job.id }); } catch { this.disconnect(); }
        // A broken worker must not reserve the GPU slot indefinitely.
        job.timer = setTimeout(() => { if (this.active === job) this.disconnect(); }, this.timeoutMs);
      } else this.queue = this.queue.filter(item => item !== job);
    };
    signal?.addEventListener('abort', cancel, { once: true });
    job.timer = setTimeout(() => {
      if (this.active === job) this.disconnect();
      else { this.queue = this.queue.filter(item => item !== job); this.finish(job, new Error('本机音色等待超时。')); }
    }, this.timeoutMs);
    this.queue.push(job); this.pump();
    try {
      while (true) {
        signal?.throwIfAborted(); if (job.error) throw job.error;
        if (job.chunks.length) { yield job.chunks.shift(); continue; }
        if (job.done) break;
        await new Promise(resolve => { job.wake = resolve; }); job.wake = null;
      }
    } finally { signal?.removeEventListener('abort', cancel); if (!job.done) cancel(); }
  }
}
