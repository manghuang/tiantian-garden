import { RealtimeProtocol } from './protocol.js';
import { PCMPlayer, encodePCM } from './pcm-player.js';
import { validateBehavior } from '../../shared/behavior.js';
import { localSpeech } from '../local-speech.js';
import { isMissingMicrophone, microphoneErrorMessage, microphoneFallbackNotice } from './media-errors.js';
import { compatibleCapture } from './compatible-capture.js';

export class RelayProvider {
  constructor({ config, emit, providerId = 'openai', speech = localSpeech }) {
    Object.assign(this, { config, emit, providerId, speech }); this.closed = false; this.muted = false; this.pushToTalk = false; this.captureMode = 'off'; this.audioEndToken = 0;
    this.audio = config.providers?.find(p => p.id === providerId)?.audio !== false;
    this.outputAudio = config.providers?.find(p => p.id === providerId)?.audioOutput ?? this.audio;
  }
  send(event) {
    if (this.closed || this.socket?.readyState !== 1) return;
    if (this.socket.bufferedAmount > 192000) { this.fail('网络暂时跟不上语音，请重新连接。'); return; }
    this.socket.send(JSON.stringify(event));
  }
  fail(message) { if (this.closed) return; this.disconnect(); this.emit('error', message); }
  handleCapture(data) {
    if (data && typeof data === 'object' && data.type === 'flushed') {
      if (data.token !== this.audioEndToken || this.pushToTalk || this.closed) return;
      this.captureMode = 'off'; this.stream?.getAudioTracks().forEach(track => { track.enabled = false; });
      this.send({ type: 'audio_end' }); return;
    }
    if (this.ready && !this.closed && this.captureMode !== 'off') this.send({ type: 'audio', audio: encodePCM(data) });
  }
  async connect(settings, consent, { inputMode = 'voice' } = {}) {
    this.settings = settings; this.abort = new AbortController(); this.emit('state', 'connecting');
    this.textOnly = false;
    if (inputMode === 'text') { this.audio = false; this.textOnly = true; this.emit('inputMode', 'text'); }
    if (this.closed) return;
    try {
      this.protocol = new RealtimeProtocol({ model: this.settings?.model, send: () => {}, emit: (type, value) => { if (!this.closed) this.emit(type, value); } });
      if (this.audio || this.outputAudio) {
      try {
      this.context = new AudioContext({ sampleRate: 24000 });
      await this.context.resume();
      if (this.closed) return;
      if (this.context.sampleRate !== 24000) throw new Error('当前浏览器不支持所需的语音采样率，请换用新版浏览器。');
      } catch {
        if (this.closed) return;
        await this.context?.close().catch(() => {}); this.context = undefined;
        this.audio = false; this.outputAudio = false; this.textOnly = true;
        this.emit('inputMode', 'text'); this.emit('notice', '当前浏览器无法启用声音，已切换为文字互动。');
      }
      }
      if (this.audio) {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('当前浏览器无法使用麦克风。');
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      } catch (error) {
        if (this.closed) return;
        this.audio = false;
        this.textOnly = true;
        this.emit('inputMode', 'text');
        this.emit('notice', isMissingMicrophone(error) ? microphoneFallbackNotice() : `${microphoneErrorMessage(error)} 已切换为文字互动。`);
      }
      if (this.stream) {
        if (this.closed) { this.stream.getTracks().forEach(t => t.stop()); return; }
        this.stream.getAudioTracks().forEach(track => { track.enabled = false; });
        try {
          try {
            await this.context.audioWorklet.addModule(new URL('./pcm-capture.worklet.js?no-inline', import.meta.url));
            if (this.closed) return;
            this.capture = new AudioWorkletNode(this.context, 'garden-capture');
          } catch {
            if (this.closed) return;
            this.capture = compatibleCapture(this.context);
          }
        } catch {
          this.stream.getTracks().forEach(track => track.stop()); this.stream = undefined;
          this.audio = false; this.textOnly = true; this.emit('inputMode', 'text');
          this.emit('notice', '当前浏览器无法启动录音，已切换为文字互动。可以在下方打字继续聊天。');
        }
        if (this.capture) {
        this.source = this.context.createMediaStreamSource(this.stream); this.source.connect(this.capture.node || this.capture);
        // The worklet outputs silence; connecting it keeps recording processing active.
        this.capture.connect(this.context.destination);
        this.capture.port.onmessage = ({ data }) => this.handleCapture(data);
        this.stream.getAudioTracks().forEach(track => { track.enabled = false; });
        }
      }
      }
      if (this.outputAudio) this.player = new PCMPlayer(this.context, speaking => { if (!this.closed) { this.emit('speaking', speaking); this.emit('state', speaking ? 'speaking' : 'ready'); } });
      const response = await fetch('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Session-Token': this.config.csrf }, body: JSON.stringify({ settings, ...consent, provider: this.providerId }), signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(25000)]) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '语音连接失败，请稍后再试。');
      this.sessionId = result.id;
      if (this.closed) { this.closeServerSession(); return; }
      if (result.transport !== 'websocket' || result.socketPath !== `/api/session/${result.id}/socket` || !/^[\w-]{1,128}$/.test(result.id)) throw new Error('语音连接参数无效。');
      const url = new URL(result.socketPath, location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      this.socket = new WebSocket(url, ['garden.v1', `csrf.${this.config.csrf}`]);
      await new Promise((resolve, reject) => {
        const fail = message => { reject(new Error(message)); this.fail(message); };
        this.openTimer = setTimeout(() => fail('语音连接超时，请检查网络后重试。'), 30000);
        this.abort.signal.addEventListener('abort', () => reject(new DOMException('已取消', 'AbortError')), { once: true });
        this.socket.onmessage = ({ data }) => {
          if (this.closed) return;
          try {
            const event = JSON.parse(data);
            if (event.type === 'garden.ready') {
              clearTimeout(this.openTimer); this.ready = true; this.awaitingResponse = true; this.captureMode = this.pushToTalk ? 'capture' : 'off'; this.capture?.port.postMessage({ mode: this.captureMode });
              this.emit('expires', result.expiresAt); this.emit('state', 'ready');
              this.pingTimer = setInterval(() => this.send({ type: 'ping' }), 5000); resolve();
            } else if (event.type === 'garden.error') fail(event.message);
            else this.handle(event);
          } catch { fail('收到无效的语音消息，请重新连接。'); }
        };
        this.socket.onclose = () => { if (!this.closed) fail('语音连接已结束，请重新开始。'); };
        this.socket.onerror = () => { if (!this.closed) fail('语音网络连接失败，请重新开始。'); };
      });
    } catch (error) {
      const closed = this.closed; this.disconnect();
      if (!closed) throw new Error(microphoneErrorMessage(error));
    }
  }
  handle(event) {
    if (event.type === 'garden.pong') return;
    if (event.type === 'garden.notice') { this.emit('notice', event.message); return; }
    if (event.type === 'garden.idle') { this.awaitingResponse = false; this.ignoreNext = false; this.emit('state', 'ready'); return; }
    if (event.type === 'response.created') {
      this.awaitingResponse = false;
      if (this.ignoreNext) { this.ignoreNext = false; this.protocol.interrupted.add(event.response.id); }
    }
    const responseId = event.response_id ?? event.response?.id;
    if (this.protocol.interrupted.has(responseId) && event.type !== 'response.done') return;
    if (event.type === 'garden.behavior') { const behavior = validateBehavior(event.behavior, this.settings?.model); if (behavior) this.emit('behavior', behavior); return; }
    if (event.type === 'response.output_audio.delta') { this.player?.append(event.item_id, event.delta, event.audio_format || 'audio/pcm'); return; }
    if (event.type === 'response.output_audio.done') {
      const pending = this.player?.finish(event.item_id, event.playback_rate);
      void pending?.catch(() => { if (!this.closed) this.emit('notice', '语音格式暂不兼容，请重新开始。'); });
      return;
    }
    if (event.type === 'garden.speech_fallback' || !this.outputAudio && event.type === 'response.output_audio_transcript.done') {
      if (event.type === 'garden.speech_fallback') this.player?.stop();
      this.localItem = event.item_id; const item = this.localItem;
      void this.speech.speak(event.transcript, this.settings, {
        onStart: () => { if (!this.closed && this.localItem === item) { this.emit('speaking', true); this.emit('state', 'speaking'); } },
        onEnd: () => { if (!this.closed && this.localItem === item) { this.localItem = null; this.emit('speaking', false); this.emit('state', 'ready'); } },
        onUnavailable: message => { if (!this.closed && this.localItem === item) this.emit('notice', message + ' 你仍可查看字幕并继续打字。'); },
      });
    }
    if (event.type === 'input_audio_buffer.speech_started') {
      const progress = this.stopPlayback();
      // VAD already cancels the old response on the server. A late playback
      // acknowledgment must never cancel the newly started response.
      if (progress.itemId) this.send({ type: 'played', ...progress });
    }
    if (event.type === 'input_audio_buffer.speech_stopped') this.awaitingResponse = true;
    this.protocol.handle(event);
  }
  sendText(text) { this.interrupt(); this.send({ type: 'text', text }); this.awaitingResponse = true; }
  stopPlayback() {
    const remote = this.player?.stop();
    const progress = remote?.itemId ? remote : this.localItem ? { itemId: this.localItem, playedMs: 0 } : {};
    if (this.localItem || !this.outputAudio) this.speech.stop();
    this.localItem = null; this.emit('speaking', false);
    return progress;
  }
  interrupt() {
    if (this.protocol?.active) this.protocol.interrupted.add(this.protocol.active);
    else if (this.awaitingResponse) this.ignoreNext = true;
    const progress = this.stopPlayback();
    this.send({ type: 'interrupt', ...progress }); this.emit('interrupt'); this.emit('state', 'ready');
  }
  setMuted(muted) {
    this.muted = muted; this.stream?.getAudioTracks().forEach(t => { t.enabled = !muted; });
    this.captureMode = this.ready && !muted ? 'capture' : 'off'; this.capture?.port.postMessage({ mode: this.captureMode }); if (muted) this.send({ type: 'clear' });
  }
  setPushToTalk(pressed) {
    if (pressed) {
      this.context?.resume()?.catch(() => this.emit('notice', '请检查浏览器的声音权限。'));
      this.speech.resume?.();
      this.pushToTalk = true; this.audioEndToken++;
      this.captureMode = 'capture'; this.stream?.getAudioTracks().forEach(track => { track.enabled = true; });
      this.capture?.port.postMessage({ mode: 'capture' });
      return;
    }
    if (!this.pushToTalk && this.captureMode === 'off') return;
    this.pushToTalk = false; const token = ++this.audioEndToken;
    if (!this.capture) { this.captureMode = 'off'; this.stream?.getAudioTracks().forEach(track => { track.enabled = false; }); this.send({ type: 'audio_end' }); return; }
    this.captureMode = 'capture'; this.capture.port.postMessage({ type: 'flush', token });
  }
  resumeAudio() { (this.localItem || !this.outputAudio ? this.speech.resume() : this.context?.resume())?.catch(() => this.emit('notice', '请检查浏览器的声音权限。')); }
  level() { return this.localItem || !this.outputAudio ? this.speech.level() : this.player?.level() || 0; }
  closeServerSession() {
    if (!this.sessionId) return; const id = this.sessionId; this.sessionId = null;
    fetch(`/api/session/${id}`, { method: 'DELETE', headers: { 'X-Session-Token': this.config.csrf }, keepalive: true }).catch(() => {});
  }
  disconnect() {
    this.closed = true; this.ready = false; clearTimeout(this.openTimer); clearInterval(this.pingTimer); this.pushToTalk = false; this.audioEndToken++; this.captureMode = 'off'; this.abort?.abort();
    if (this.localItem || !this.outputAudio) this.speech.stop();
    this.localItem = null;
    this.stream?.getTracks().forEach(t => t.stop());
    if (this.capture) { this.capture.port.onmessage = null; this.capture.port.postMessage({ mode: 'off' }); this.capture.disconnect(); }
    this.source?.disconnect(); this.player?.dispose(); this.socket?.close(); this.context?.close().catch(() => {});
    this.closeServerSession(); this.emit('speaking', false);
  }
}
