export const VOICE_STYLES = Object.freeze({
  bright: { label: '明亮活泼', pitch: 1.38, rate: 1.04, instructions: '使用明亮、清脆、轻盈的卡通女声质感，像一只充满好奇心的小狗。音高略高但不尖锐，语气有微笑感，重音和句尾有自然起伏。开心时轻快，好奇时轻轻上扬；安慰时放缓、放柔。避免播音腔、客服腔、拖长每个字或机械逐字朗读。不要尖叫或持续大笑。' },
  gentle: { label: '温柔讲故事', pitch: 1.18, rate: 0.93, instructions: '使用柔和、轻盈、有微笑感的卡通女声质感。讲故事有自然起伏和短暂停顿，吐字清晰，语速稍慢但不要像播报新闻。安慰时温柔、平静，不夸张卖萌。' },
});
export const VOICE_SAMPLE = '嗨！我是天天！小爪子准备好啦，我们一起去发现有趣的事情吧！';
export function voiceStyle(value) { return Object.hasOwn(VOICE_STYLES, value) ? value : 'bright'; }
export function localChineseVoices(voices) {
  const score = v => (v.localService ? 5 : 0) + (/yaoyao|瑶瑶/i.test(v.name) ? 100 : /xiaoxiao|晓晓/i.test(v.name) ? 95 : /huihui|慧慧/i.test(v.name) ? 80 : /female|女/i.test(v.name) ? 70 : /kangkang|康康|male|男/i.test(v.name) ? -10 : 0);
  // Android browsers do not consistently set localService for system voices.
  // Prefer local voices when the flag is reliable, but keep usable browser
  // voices so SpeechSynthesis can still speak on mobile devices.
  return voices.filter(v => /^(?:zh|cmn|yue)(?:[-_]|$)/i.test(v.lang || '')).sort((a, b) => score(b) - score(a));
}
export function chooseLocalVoice(voices, uri = '') {
  const available = localChineseVoices(voices);
  return available.find(v => v.voiceURI === uri) || available[0];
}
export function localProsody(style, emotion = 'warm') {
  const profile = VOICE_STYLES[voiceStyle(style)];
  if (emotion === 'calm') return { pitch: Math.min(profile.pitch, 1.16), rate: 0.9 };
  return { pitch: profile.pitch, rate: profile.rate };
}
