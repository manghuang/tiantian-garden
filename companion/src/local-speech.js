import { chooseLocalVoice, localProsody } from '../shared/voice.js';
import voiceAssets from './voice-assets.json' with { type: 'json' };

export async function waitForVoices(synth = globalThis.speechSynthesis) {
  if (!synth || synth.getVoices().length) return synth?.getVoices() || [];
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timer); synth.removeEventListener('voiceschanged', finish); resolve(synth.getVoices()); };
    const timer = setTimeout(finish, 2500);
    synth.addEventListener('voiceschanged', finish);
  });
}

// SpeechSynthesis is global within a page. A single owner prevents preview/chat overlap.
export class LocalSpeech {
  constructor() { this.generation = 0; }
  stop() {
    this.generation++; clearTimeout(this.timeout); globalThis.speechSynthesis?.cancel();
    this.audio?.pause(); this.source?.disconnect(); this.analyser?.disconnect();
    this.context?.close().catch(() => {}); this.context = null; this.analyser = null; this.audio = null; this.utterance = null;
  }
  async resume() {
    globalThis.speechSynthesis?.resume();
    const generation = this.generation;
    await this.context?.resume();
    if (generation === this.generation && this.audio && !this.audio.ended) await this.audio.play();
  }
  level() {
    if (!this.analyser) return null;
    this.analyser.getByteTimeDomainData(this.samples);
    let sum = 0; for (const v of this.samples) sum += ((v - 128) / 128) ** 2;
    return Math.min(1, Math.sqrt(sum / this.samples.length) * 6);
  }
  async speak(text, settings, { emotion, onStart = () => {}, onEnd = () => {}, onUnavailable = () => {} } = {}) {
    this.stop(); const generation = this.generation;
    // Fixed demo dialogue is bundled as locally synthesized audio. This avoids
    // browsers which enumerate Windows voices but cannot invoke their engine.
    const asset = !settings.localVoice ? voiceAssets[`${settings.voiceStyle || 'bright'}|${text}`] : null;
    if (asset) {
      try {
        this.audio = new Audio(asset); this.context = new AudioContext();
        this.source = this.context.createMediaElementSource(this.audio);
        this.analyser = this.context.createAnalyser(); this.analyser.fftSize = 256;
        this.samples = new Uint8Array(this.analyser.fftSize);
        this.source.connect(this.analyser); this.analyser.connect(this.context.destination);
        this.audio.onended = () => { if (generation === this.generation) { this.stop(); onEnd(); } };
        this.audio.onerror = () => { if (generation === this.generation) { this.stop(); onUnavailable('演示配音没有加载成功，请刷新后再试。'); onEnd(); } };
        await this.context.resume();
        if (generation !== this.generation) return;
        await this.audio.play();
        if (generation !== this.generation) return;
        onStart('瑶瑶 · 本地角色配音');
      } catch { if (generation === this.generation) { this.stop(); onUnavailable('声音暂未获准播放，请再次点击试听或检查浏览器声音权限。'); onEnd(); } }
      return;
    }
    const synth = globalThis.speechSynthesis;
    if (!synth || typeof synth.speak !== 'function') {
      onUnavailable('当前浏览器不支持系统语音朗读；你仍可查看字幕并继续打字。'); onEnd(); return;
    }
    const voices = await waitForVoices(synth);
    if (generation !== this.generation) return;
    const voice = chooseLocalVoice(voices, settings.localVoice);
    const utterance = new SpeechSynthesisUtterance(text);
    this.utterance = utterance;
    if (voice) { utterance.voice = voice; utterance.lang = voice.lang || 'zh-CN'; }
    else utterance.lang = 'zh-CN';
    Object.assign(utterance, localProsody(settings.voiceStyle, emotion));
    let finished = false;
    const finish = () => { if (generation !== this.generation || finished) return; finished = true; clearTimeout(this.timeout); onEnd(); };
    utterance.onstart = () => { if (generation === this.generation) onStart(voice?.name || '系统中文声音'); };
    utterance.onend = finish;
    utterance.onerror = event => { if (generation === this.generation) { console.warn('Local voice unavailable:', event.error, voice?.name || 'system'); onUnavailable('朗读未能完成，请检查手机媒体音量和系统中文语音后再试。'); } finish(); };
    this.timeout = setTimeout(() => { if (generation === this.generation) { synth.cancel(); finish(); } }, 30000);
    try { synth.speak(utterance); } catch { if (generation === this.generation) { onUnavailable('朗读未能启动，请点击页面中的继续播放后再试。'); finish(); } }
  }
}

export const localSpeech = new LocalSpeech();
