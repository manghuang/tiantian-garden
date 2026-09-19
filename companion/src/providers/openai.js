import { RealtimeProtocol } from './protocol.js';
import { isMissingMicrophone, microphoneErrorMessage, microphoneFallbackNotice } from './media-errors.js';

export class OpenAIProvider {
  constructor({ config, emit }) { this.config = config; this.emit = emit; this.closed = false; this.muted = false; this.pushToTalk = false; this.pendingTexts = []; }
  send(event) {
    if (this.channel?.readyState === 'open') {
      if (event.type === 'response.create') this.generating = true;
      this.channel.send(JSON.stringify(event));
    }
  }
  handleEvent(event) {
    if (event.type === 'response.done' && (!this.protocol.active || this.protocol.active === event.response?.id)) this.generating = false;
    this.protocol.handle(event);
    if (event.type === 'response.created' && this.cancelOnStart) { this.cancelOnStart = false; this.protocol.interrupt(); }
  }
  async connect(settings, consent, { inputMode = 'voice' } = {}) {
    this.closed = false;
    this.textOnly = false;
    this.abort = new AbortController();
    this.emit('state', 'connecting');
    try {
      if (inputMode === 'text') { this.textOnly = true; this.emit('inputMode', 'text'); }
      else {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('请使用支持麦克风的浏览器，并通过 localhost 或 HTTPS 打开。');
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      } catch (error) {
        if (!isMissingMicrophone(error)) throw error;
        this.textOnly = true;
        this.emit('inputMode', 'text');
        this.emit('notice', microphoneFallbackNotice());
      }
      }
      this.stream?.getAudioTracks().forEach(track => { track.enabled = false; });
      if (this.closed) { this.stream?.getTracks().forEach(t => t.stop()); return; }
      this.context = new AudioContext();
      await this.context.resume();
      this.pc = new RTCPeerConnection();
      this.audio = new Audio(); this.audio.autoplay = true;
      this.pc.ontrack = ({ streams: [stream] }) => {
        if (this.closed || !stream) return;
        this.audio.srcObject = stream;
        this.audio.play().catch(() => this.emit('notice', '浏览器暂停了声音，点击“恢复声音”即可继续。'));
        this.analyser = this.context.createAnalyser(); this.analyser.fftSize = 256;
        this.source = this.context.createMediaStreamSource(stream); this.source.connect(this.analyser);
        this.samples = new Uint8Array(this.analyser.fftSize);
      };
      if (this.stream) for (const track of this.stream.getTracks()) this.pc.addTrack(track, this.stream);
      else this.pc.addTransceiver('audio', { direction: 'recvonly' });
      this.channel = this.pc.createDataChannel('oai-events');
      this.protocol = new RealtimeProtocol({ send: e => this.send(e), emit: (type, value) => {
        if (this.closed) return;
        if (type === 'responseEnd' && this.pendingTexts.length && !this.protocol.active && !this.generating) {
          const texts = this.pendingTexts.splice(0);
          for (const text of texts) this.addTextItem(text);
          this.send({ type: 'response.create' });
        }
        this.emit(type, value);
      } });
      this.channel.onmessage = ({ data }) => { try { this.handleEvent(JSON.parse(data)); } catch { this.emit('notice', '收到了一条无法读取的语音消息。'); } };
      this.pc.onconnectionstatechange = () => {
        if (!this.closed && ['failed', 'disconnected', 'closed'].includes(this.pc.connectionState)) { this.emit('error', '语音连接断开了，请重新开始。'); this.disconnect(); }
      };
      this.channel.onclose = () => { if (!this.closed) { this.emit('error', '语音通道已关闭，请重新开始。'); this.disconnect(); } };
      const opened = new Promise((resolve, reject) => {
        this.openTimer = setTimeout(() => reject(new Error('语音连接超时，请检查网络。')), 30000);
        this.channel.onopen = () => { clearTimeout(this.openTimer); resolve(); };
        this.abort.signal.addEventListener('abort', () => { clearTimeout(this.openTimer); reject(new DOMException('已取消', 'AbortError')); }, { once: true });
      });
      // Attach a rejection handler immediately, even while SDP fetch is pending.
      opened.catch(() => {});
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      const response = await fetch('/api/session', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Session-Token': this.config.csrf },
        body: JSON.stringify({ sdp: offer.sdp, settings, ...consent }), signal: this.abort.signal,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '连接失败，请稍后再试。');
      this.sessionId = result.id;
      if (this.closed) { this.closeServerSession(); return; }
      await this.pc.setRemoteDescription({ type: 'answer', sdp: result.sdp });
      await opened;
      if (this.closed) return;
      this.emit('expires', result.expiresAt);
      this.emit('state', 'ready');
      this.send({ type: 'response.create', response: { instructions: '请用一句话介绍你是屏幕里的 AI 小狗天天，再问孩子今天想聊什么。', tool_choice: 'none' } });
    } catch (error) {
      const wasClosed = this.closed;
      this.disconnect();
      if (!wasClosed) throw new Error(microphoneErrorMessage(error));
    }
  }
  addTextItem(text) {
    this.send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } });
  }
  submitText(text) {
    this.addTextItem(text);
    this.send({ type: 'response.create' });
  }
  sendText(text) {
    if (this.protocol?.active || this.generating) {
      this.pendingTexts.push(text);
      if (this.protocol?.active) this.protocol.interrupt(); else this.cancelOnStart = true;
    }
    else { this.protocol?.interrupt(); this.submitText(text); }
  }
  interrupt() { this.pendingTexts = []; if (this.generating && !this.protocol?.active) this.cancelOnStart = true; this.protocol?.interrupt(); this.emit('state', 'ready'); }
  setMuted(muted) { this.muted = muted; this.stream?.getAudioTracks().forEach(t => { t.enabled = !muted; }); if (muted) this.send({ type: 'input_audio_buffer.clear' }); }
  setPushToTalk(pressed) {
    this.pushToTalk = Boolean(pressed);
    this.stream?.getAudioTracks().forEach(track => { track.enabled = this.pushToTalk; });
  }
  resumeAudio() { this.context?.resume(); this.audio?.play().catch(() => this.emit('notice', '声音还未恢复，请检查浏览器的声音权限。')); }
  level() {
    if (!this.analyser) return 0;
    this.analyser.getByteTimeDomainData(this.samples);
    let sum = 0; for (const v of this.samples) sum += ((v - 128) / 128) ** 2;
    return Math.min(1, Math.sqrt(sum / this.samples.length) * 6);
  }
  closeServerSession() {
    if (!this.sessionId) return;
    const id = this.sessionId; this.sessionId = null;
    fetch(`/api/session/${id}`, { method: 'DELETE', headers: { 'X-Session-Token': this.config.csrf }, keepalive: true }).catch(() => {});
  }
  disconnect() {
    this.closed = true; this.pendingTexts = []; this.generating = false; this.cancelOnStart = false; this.abort?.abort(); clearTimeout(this.openTimer);
    this.stream?.getTracks().forEach(t => t.stop()); this.channel?.close(); this.pc?.close();
    if (this.audio) { this.audio.pause(); this.audio.srcObject = null; }
    this.source?.disconnect(); this.analyser?.disconnect();
    this.context?.close().catch(() => {}); this.analyser = null;
    this.closeServerSession(); this.emit('speaking', false);
  }
}
