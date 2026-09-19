import './style.css';
import { icon } from './icons.js';
import { DogScene } from './dog-scene.js';
import { ACTIONS, ACTIVITIES, sessionSettings } from '../shared/behavior.js';
import { createProvider } from './providers/index.js';
import { localChineseVoices, VOICE_SAMPLE } from '../shared/voice.js';
import { localSpeech, waitForVoices } from './local-speech.js';
import { enterGarden } from './access.js';

const bootstrapConfig = await enterGarden();

document.querySelector('#app').innerHTML = `
  <header class="site-header"><a class="brand" href="/" aria-label="天天的小花园首页"><span class="brand-icon">${icon('paw')}</span><span>天天的小花园<small>A LITTLE WORLD OF WONDER</small></span></a>
    <div class="header-actions"><span class="header-note">给好奇心一点陪伴</span><button class="quiet-button" id="parent-button">${icon('settings')}家长设置</button><button class="quiet-button" id="logout-button" hidden>退出登录</button></div>
  </header>
  <main>
    <section class="page-heading"><div><p class="eyebrow"><span></span> LITTLE FRIEND, BIG ADVENTURES</p><h1>你好呀，<span>小小探险家。</span></h1><p class="subtitle">说说今天的开心事，或者，和天天一起做个小小的白日梦。</p></div><div class="session-clock">${icon('clock')}<span id="clock-label">每次 10 分钟，刚刚好</span></div></section>
    <div class="workspace">
      <section class="garden" aria-label="天天的互动花园">
        <div class="garden-top"><span class="location-pill">${icon('leaf')} 天天的秘密花园</span><span class="mode-badge" id="mode-badge">本地演示</span></div>
        <div class="sun" aria-hidden="true"></div><div class="cloud cloud-one" aria-hidden="true"></div><div class="cloud cloud-two" aria-hidden="true"></div>
        <div class="hill hill-back" aria-hidden="true"></div><div class="hill hill-front" aria-hidden="true"></div>
        <div class="flower flower-one" aria-hidden="true">✿</div><div class="flower flower-two" aria-hidden="true">✿</div><div class="flower flower-three" aria-hidden="true">✿</div>
        <div class="hello-note" id="hello-note">一起玩吧！<span>♡</span></div>
        <div id="scene"></div>
        <div class="motion-shortcuts" aria-label="体验动作"><button data-showcase="wave">招招手</button><button data-showcase="happy">开心小跳</button><button data-showcase="fly">飞一下</button></div>
        <div class="loading" id="loading"><span class="loading-paw">${icon('paw')}</span><strong id="loading-label">天天正在走进花园…</strong><span>第一次见面需要加载精细模型</span><div class="progress-track"><i id="progress"></i></div></div>
        <div class="character-label"><span class="online-dot"></span><strong>天天</strong><span id="action-label">轻轻呼吸</span></div>
        <div class="view-controls"><span>拖动看看我</span><button id="reset-view" class="icon-button" aria-label="恢复模型视角" title="恢复视角">${icon('rotate')}</button><button id="quality" class="icon-button" aria-label="切换省电显示" aria-pressed="false" title="省电显示：隐藏细毛">${icon('leaf')}</button></div>
        <div class="garden-bottom"><span>${icon('shield')}我是屏幕里的 AI 小伙伴</span><button id="wave-button">和我打招呼 ${icon('paw')}</button></div>
      </section>
      <section class="conversation" aria-label="和天天聊天">
        <div class="conversation-heading"><span class="small-paw">${icon('paw')}</span><div><h2>和天天说说话</h2><p id="state-label"><span class="online-dot"></span>我在这里，慢慢来</p></div><button id="clear-chat" class="text-button" title="清除本页字幕">清空</button></div>
        <div id="messages" role="log" aria-live="polite" aria-label="对话字幕"></div>
        <div class="suggestions" id="suggestions"><span>不知道说什么？试试看</span><button data-prompt="天天，你好！">天天，你好呀 👋</button><button data-prompt="给我讲一个故事">给我讲个故事 ${icon('book')}</button><button data-prompt="你会飞吗？">你会飞吗？ ${icon('spark')}</button></div>
        <div id="activity-choices" class="activity-choices" aria-label="故事和游戏选项" hidden></div>
        <div id="notice" class="notice" role="status" hidden></div>
        <div class="voice-zone" id="voice-zone"><div class="voice-wave" id="voice-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
          <button id="voice-button" class="primary-button">${icon('mic')}<span>开始互动</span></button>
          <p id="voice-hint">演示模式 · 点击话题或输入文字</p>
          <div class="call-controls" id="call-controls" hidden><button id="interrupt-button">${icon('stop')}打断</button><button id="resume-audio">${icon('volume')}恢复声音</button><button id="end-button">结束互动</button></div>
        </div>
        <form id="text-form"><label class="sr-only" for="text-input">想对天天说的话</label><input id="text-input" maxlength="500" autocomplete="off" placeholder="也可以打字告诉我…"><button type="submit" aria-label="发送消息">${icon('arrow')}</button></form>
        <p class="privacy-note">字幕仅在本页暂存，结束互动后清除</p>
      </section>
    </div>
    <section class="activity-section"><div class="section-caption"><h2>今天想一起做什么？</h2><span>从一个小小的好奇开始</span></div><div class="activities">
      <button class="activity active" data-activity="chat" aria-pressed="true"><span class="activity-icon peach">${icon('chat')}</span><span><strong>聊聊天</strong><small>每一种心情，都可以说</small></span>${icon('arrow')}</button>
      <button class="activity" data-activity="story" aria-pressed="false"><span class="activity-icon lavender">${icon('book')}</span><span><strong>听故事</strong><small>下一页，藏着什么呢</small></span>${icon('arrow')}</button>
      <button class="activity" data-activity="discover" aria-pressed="false"><span class="activity-icon sage">${icon('leaf')}</span><span><strong>好奇时间</strong><small>给世界一个为什么</small></span>${icon('arrow')}</button>
      <button class="activity" data-activity="play" aria-pressed="false"><span class="activity-icon yellow">${icon('spark')}</span><span><strong>一起玩</strong><small>猜一猜，笑一笑</small></span>${icon('arrow')}</button>
    </div></section>
    <footer><span>${icon('leaf')} 慢慢长大，好好玩耍。</span><span>为 4–8 岁设计 · 建议家长陪伴体验</span></footer>
  </main>
  <dialog id="settings-dialog"><form id="settings-form"><div class="dialog-heading"><div><p class="eyebrow">A MOMENT FOR PARENTS</p><h2>让陪伴，更适合孩子</h2></div><button type="button" class="icon-button close-dialog" aria-label="关闭家长设置">${icon('close')}</button></div>
    <label>互动服务<select id="provider-select"></select></label><p class="field-note" id="provider-note"></p>
    <div class="form-row"><label>表达年龄<select id="age-select"><option value="4-5">4–5 岁 · 更短、更简单</option><option value="6-8">6–8 岁 · 多一点探索</option></select></label><label>每次互动<select id="minutes-select"><option value="5">5 分钟</option><option value="10" selected>10 分钟</option><option value="15">15 分钟</option></select></label></div>
    <div class="form-row"><label>声音风格<select id="voice-style-select"><option value="bright">明亮活泼 · 卡通女声</option><option value="gentle">温柔讲故事</option></select></label><label>动作表现<select id="motion-select"><option value="natural">自然</option><option value="lively" selected>活泼（默认）</option><option value="expressive">夸张</option></select></label></div>
    <label>本机演示音色<select id="local-voice-select"><option value="">角色配音 · 瑶瑶（推荐）</option></select></label>
    <div class="preview-buttons"><button type="button" id="preview-voice">${icon('volume')}试听本机声音</button><button type="button" id="stop-preview">停止试听</button></div>
    <p id="voice-preview-note" class="field-note" role="status">这是角色化合成声音，不是动画原声。实时语音使用服务器配置的音色，声音风格在新会话生效。</p>
    <div class="preview-buttons" aria-label="动作预览"><button type="button" data-motion="wave">看看招手</button><button type="button" data-motion="happy">开心小跳</button><button type="button" data-motion="curious">好奇歪头</button></div>
    <p class="field-note">动作预览会应用所选动作档位并关闭设置，方便观察天天。</p>
    <label class="check-row"><input type="checkbox" id="lightweight-check">省电显示：隐藏细毛，降低画面负担</label>
    <div class="parent-info">${icon('shield')}<p id="voice-data-info">天天是 AI 角色，声音由合成服务生成。实时语音只在按住“按住说话”按钮时发送麦克风音频；本应用不保存录音，也不写入聊天记录。服务方的数据处理规则需要由部署者单独确认。</p></div>
    <p class="field-note">当前是本机原型。首次语音测试请由成年人进行；正式儿童使用需完成数据保留、内容安全和家长同意配置。</p>
    <button class="primary-button" type="submit" id="save-settings">保存设置</button></form></dialog>
  <dialog id="consent-dialog"><div class="dialog-heading"><div><p class="eyebrow">BEFORE WE SAY HELLO</p><h2>开始前，请家长看一看</h2></div><button class="icon-button close-dialog" aria-label="关闭语音确认">${icon('close')}</button></div>
    <p id="voice-consent-info" class="dialog-copy">开启后，只有按住“按住说话”按钮时，麦克风音频才会发送给语音服务，用于理解和生成语音；松开按钮后会立即提交当前语句并停止采集。结束互动后会关闭麦克风并清除本页字幕。</p>
    <label>本次使用者<select id="audience-select"><option value="adult-test">成年人开发 / 体验测试</option><option value="child">儿童（由家长陪伴）</option></select></label>
    <p id="child-use-note" class="field-note"></p>
    <label class="check-row"><input type="checkbox" id="consent-check">我已了解本次数据的用途和接收方，并同意连接。</label>
    <button id="confirm-voice" class="primary-button" disabled>${icon('mic')}同意并使用按住说话</button>
  </dialog>
  <dialog id="rest-dialog"><span class="rest-icon">${icon('leaf')}</span><h2>小花园也要休息一下啦</h2><p class="dialog-copy">今天的互动结束了。看看窗外，伸个懒腰，去找身边的人说说话吧。</p><button class="primary-button close-dialog">好呀，休息一下</button></dialog>
`;

const $ = id => document.getElementById(id);
let config, scene, provider, active = false, connecting = false, pushTalking = false, pushTalkPhase = 'idle', activePointerId = null, activeInput = null, modelReady = false, lightweight = false, textOnlyInput = false;
let selectedProvider = 'demo', settings = sessionSettings(), expiresAt = 0, sessionVersion = 0, state = 'ready';
let localVoice = '', motion = 'lively', previewing = false, pendingInitialText = '';
const messageElements = new Map();
const prompts = { chat: '天天，你好！', story: '给我讲一个故事', discover: '为什么会有彩虹？', play: '我们来猜动物吧' };

function notice(text) { $('notice').textContent = text || ''; $('notice').hidden = !text; }
function addMessage(role, text, id = crypto.randomUUID()) {
  let item = messageElements.get(id);
  if (!item) {
    item = document.createElement('div'); item.className = `message ${role}`;
    const label = document.createElement('span'); label.className = 'message-author'; label.textContent = role === 'user' ? '你' : '天天';
    const paragraph = document.createElement('p'); item.append(label, paragraph); $('messages').appendChild(item); messageElements.set(id, item);
  }
  item.querySelector('p').textContent = text;
  while (messageElements.size > 40) { const key = messageElements.keys().next().value; messageElements.get(key).remove(); messageElements.delete(key); }
  $('messages').scrollTop = $('messages').scrollHeight;
  return item;
}
function clearMessages({ keepChoices = false } = {}) {
  if (!keepChoices) renderChoices([]);
  messageElements.clear(); $('messages').replaceChildren();
  addMessage('assistant', '嗨，我是天天！\n今天的风软软的，正适合一起聊天。你想告诉我什么呀？', 'welcome');
  $('suggestions').hidden = keepChoices && !$('activity-choices').hidden;
}
function renderChoices(choices) {
  const target = $('activity-choices'); target.replaceChildren();
  for (const text of (choices || []).slice(0, 3)) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = text;
    button.onclick = () => void sendText(text); target.appendChild(button);
  }
  target.hidden = !target.childElementCount;
}
function isTextOnlySession() {
  return textOnlyInput || selectedProvider === 'deepseek' && !config?.providers?.find(p => p.id === selectedProvider)?.audio;
}
function updateUI(next = state) {
  state = next;
  const textOnly = isTextOnlySession();
  const voiceSession = active && !textOnly && selectedProvider !== 'demo';
  const readyLabel = !active ? '我在这里，慢慢来' : textOnly ? '我在这里，打字告诉我吧' : voiceSession && pushTalkPhase === 'listening' ? '我在听，你慢慢说' : voiceSession && pushTalkPhase === 'sending' ? '松开了，正在发送…' : voiceSession ? '按住按钮说话' : '我在这里，慢慢来';
  const labels = { ready: readyLabel, listening: '竖起耳朵听你说', thinking: '让我想一想…', speaking: '天天正在说话', connecting: '正在连接…' };
  $('state-label').replaceChildren();
  const dot = document.createElement('span'); dot.className = 'online-dot'; $('state-label').append(dot, document.createTextNode(pushTalkPhase === 'listening' && voiceSession ? '正在收音，松开后发送' : pushTalkPhase === 'sending' && voiceSession ? '正在发送，马上就好' : labels[state] || labels.ready));
  $('voice-wave').classList.toggle('moving', ['speaking', 'listening'].includes(state));
  const buttonLabel = connecting ? '正在连接…' : textOnly ? active ? '文字互动中' : '开始文字互动' : active ? selectedProvider === 'demo' ? '演示进行中' : pushTalkPhase === 'listening' ? '松开即可发送' : pushTalkPhase === 'sending' ? '正在发送…' : '按住说话' : selectedProvider === 'demo' ? '开始互动' : '开启语音聊天';
  const talkState = voiceSession ? pushTalkPhase : 'idle';
  $('voice-zone').dataset.pttState = talkState;
  $('voice-button').dataset.pttState = talkState;
  $('voice-button').innerHTML = icon(textOnly ? 'chat' : 'mic') + `<span>${buttonLabel}</span>`;
  $('voice-button').setAttribute('aria-label', buttonLabel);
  $('voice-button').setAttribute('aria-pressed', voiceSession ? String(pushTalking) : 'false');
  $('voice-button').setAttribute('aria-busy', String(talkState === 'sending'));
  $('voice-button').disabled = !config || !modelReady || connecting || (active && (selectedProvider === 'demo' || textOnly));
  $('call-controls').hidden = !active && !connecting;
  $('voice-hint').textContent = selectedProvider === 'demo' ? '演示模式 · 预设回复，不采集语音' : textOnly ? '输入文字 · 有可用中文声音时可朗读 · 不采集语音' : active ? pushTalkPhase === 'listening' ? '正在收音 · 松开即可发送' : pushTalkPhase === 'sending' ? '正在发送 · 很快就好' : '按住按钮说话，松开后发送 · 只在按住时采集' : '首次使用需要家长确认与麦克风权限';
  const mode = selectedProvider === 'deepseek' ? textOnly ? 'DeepSeek 文字' : 'DeepSeek 语音' : textOnly ? 'OpenAI 文字' : '实时语音';
  $('mode-badge').textContent = selectedProvider === 'demo' ? '本地演示 · 预设回复' : `${mode} · ${active ? '已连接' : '待连接'}`;
  $('text-input').disabled = connecting || !modelReady;
  document.querySelectorAll('[data-prompt]').forEach(button => { button.disabled = connecting || !modelReady; });
}
function receive(type, value) {
  if (type === 'inputMode') { textOnlyInput = value === 'text'; pushTalkPhase = 'idle'; updateUI(); }
  if (type === 'choices') renderChoices(value);
  if (type === 'sessionEnd') { endSession(); $('rest-dialog').showModal(); }
  if (type === 'state') { if (['ready', 'speaking'].includes(value) && !pushTalking) pushTalkPhase = 'idle'; updateUI(value); }
  if (type === 'notice') notice(value);
  if (type === 'error') { endSession(); notice(value); }
  if (type === 'speaking' && scene) scene.speaking = value;
  if (type === 'interrupt') scene?.play('idle');
  if (type === 'expires') expiresAt = value;
  if (type === 'behavior') {
    scene?.play(value.action);
    $('hello-note').textContent = { happy: '和你一起，真开心', curious: '咦？让我想想', calm: '慢慢来，我在听', sad: '我会陪你慢慢说', warm: '一起发现小美好' }[value.emotion];
  }
  if (type === 'transcript') { addMessage(value.role, value.text, value.id); $('suggestions').hidden = true; }
  if (type === 'delta') {
    const existing = messageElements.get(value.id)?.querySelector('p').textContent || '';
    addMessage('assistant', existing + value.text, value.id); $('suggestions').hidden = true;
  }
}
async function begin(consent, initialText = '') {
  if (active || connecting || !modelReady || !config) return;
  const version = ++sessionVersion; connecting = true; textOnlyInput = false; notice(''); updateUI('connecting');
  const nextProvider = createProvider(selectedProvider, { config, emit: (type, value) => { if (version === sessionVersion) receive(type, value); } });
  provider = nextProvider;
  try {
    localSpeech.stop();
    await nextProvider.connect({ ...settings, localVoice }, consent, { inputMode: initialText ? 'text' : 'voice' });
    if (version !== sessionVersion) return;
    nextProvider.setPushToTalk?.(false);
    active = true; connecting = false; pushTalking = false; pushTalkPhase = 'idle'; activePointerId = null; activeInput = null;
    expiresAt ||= Date.now() + settings.minutes * 60000;
    scene.play('wave'); updateUI('ready');
    if (initialText) await sendText(initialText);
    else if (selectedProvider === 'demo') nextProvider.sendText(prompts[settings.activity]);
  } catch (error) { if (version === sessionVersion) { endSession(); $('text-input').value = initialText; notice(error.message); } }
}
function endSession() {
  localSpeech.stop(); previewing = false;
  pendingInitialText = ''; $('consent-dialog').close();
  ++sessionVersion; provider?.disconnect(); provider = null; active = false; connecting = false; pushTalking = false; pushTalkPhase = 'idle'; activePointerId = null; activeInput = null; textOnlyInput = false; expiresAt = 0;
  if (scene) { scene.speaking = false; scene.play('idle'); }
  clearMessages(); $('text-input').value = ''; updateUI('ready');
  $('clock-label').textContent = `每次 ${settings.minutes} 分钟，刚刚好`;
}
async function sendText(text) {
  text = text.trim().slice(0, 500); if (!text || connecting || !modelReady) return;
  if (!active) {
    if (selectedProvider !== 'demo') requestVoice(text);
    else await begin(undefined, text);
    return;
  }
  if (!active) return;
  addMessage('user', text); $('suggestions').hidden = true; $('text-input').value = '';
  renderChoices([]);
  provider.sendText(text);
}
function requestVoice(initialText = '') {
  pendingInitialText = '';
  const entry = config.providers.find(p => p.id === selectedProvider);
  if (!entry?.ready) {
    notice(`服务尚未配置。请由部署者在服务器设置 ${selectedProvider === 'deepseek' ? 'DEEPSEEK_API_KEY' : 'OPENAI_API_KEY'}，或切换到本地演示。`);
    return;
  }
  if (entry.voiceReady === false) {
    notice(entry.tts === 'local-gpu' ? '请先在电脑上启动天天音色服务，再开始互动。' : entry.tts === 'cloudflare-minimax' ? '请由部署者先设置 CLOUDFLARE_TTS_VOICE_ID，再开始互动。' : '请由部署者确认 Cloudflare Workers AI 已配置，再开始互动。');
    return;
  }
  updateDataInfo(selectedProvider, Boolean(initialText));
  const audio = !initialText && (selectedProvider === 'openai' || config.providers.find(p => p.id === selectedProvider)?.audio);
  $('confirm-voice').innerHTML = icon(audio ? 'mic' : 'chat') + (audio ? '同意并使用按住说话' : '同意并开始文字互动');
  $('consent-check').checked = false; $('confirm-voice').disabled = true;
  $('audience-select').value = 'adult-test';
  $('audience-select').querySelector('[value="child"]').disabled = !config.childUseEnabled;
  $('child-use-note').textContent = config.childUseEnabled ? '儿童模式已由部署者启用，请由家长陪伴使用。' : '当前只允许成年人测试。儿童模式需由部署者完成数据与安全配置后启用。';
  pendingInitialText = initialText;
  if (initialText) $('text-input').value = initialText;
  $('consent-dialog').showModal();
}

function talkHaptic(duration = 10) {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
  if (!coarse) return;
  try { navigator.vibrate(duration); } catch { /* Haptics are optional. */ }
}
function startPushToTalk(event) {
  if (!active || connecting || isTextOnlySession() || selectedProvider === 'demo' || !provider || pushTalking || event?.isPrimary === false) return;
  event?.preventDefault();
  if (event?.pointerId != null) {
    activePointerId = event.pointerId; activeInput = 'pointer';
    try { event.currentTarget?.setPointerCapture(event.pointerId); } catch { /* Pointer capture is optional. */ }
  } else activeInput = 'keyboard';
  pushTalking = true; pushTalkPhase = 'listening'; talkHaptic(12); provider.setPushToTalk?.(true); updateUI('listening');
}
function stopPushToTalk(event) {
  if (!pushTalking) return;
  if (event?.pointerId != null && activeInput !== 'pointer') return;
  if (event?.pointerId != null && activePointerId !== null && event.pointerId !== activePointerId) return;
  event?.preventDefault();
  pushTalking = false; pushTalkPhase = 'sending'; activePointerId = null; activeInput = null; talkHaptic(8); provider?.setPushToTalk?.(false); updateUI('thinking');
}
const voiceButton = $('voice-button');
voiceButton.addEventListener('pointerdown', event => { if (active) startPushToTalk(event); });
voiceButton.addEventListener('pointerup', stopPushToTalk);
voiceButton.addEventListener('pointercancel', stopPushToTalk);
voiceButton.addEventListener('lostpointercapture', stopPushToTalk);
voiceButton.addEventListener('keydown', event => {
  if (active && (event.key === ' ' || event.key === 'Enter')) startPushToTalk(event);
});
voiceButton.addEventListener('keyup', event => {
  if (event.key === ' ' || event.key === 'Enter') stopPushToTalk(event);
});
window.addEventListener('blur', stopPushToTalk);
voiceButton.onclick = async () => {
  if (active) return;
  if (selectedProvider !== 'demo') requestVoice(); else await begin();
};
$('consent-check').onchange = () => { $('confirm-voice').disabled = !$('consent-check').checked; };
$('confirm-voice').onclick = () => {
  if (!$('consent-check').checked) return;
  const initialText = pendingInitialText; pendingInitialText = '';
  $('consent-dialog').close();
  void begin({ consent: true, audience: $('audience-select').value }, initialText);
};
$('consent-dialog').addEventListener('close', () => { pendingInitialText = ''; });
$('text-form').onsubmit = event => { event.preventDefault(); void sendText($('text-input').value); };
document.querySelectorAll('[data-prompt]').forEach(button => { button.onclick = () => void sendText(button.dataset.prompt); });
document.querySelectorAll('[data-activity]').forEach(button => { button.onclick = () => {
  const activity = button.dataset.activity;
  if (active || connecting) endSession();
  settings.activity = activity;
  document.querySelectorAll('[data-activity]').forEach(b => { const selected = b === button; b.classList.toggle('active', selected); b.setAttribute('aria-pressed', String(selected)); });
  clearMessages(); notice(''); addMessage('assistant', `${ACTIVITIES[activity].label}时间到啦！准备好了就开始吧。`);
  $('text-input').value = prompts[activity];
  scene?.play(activity === 'play' ? 'play' : 'curious');
} });
$('wave-button').onclick = () => { if (modelReady) { scene.play('wave'); $('hello-note').textContent = '你好呀，小小探险家！'; } };
$('interrupt-button').onclick = () => { provider?.interrupt(); if (scene) { scene.speaking = false; scene.play('idle'); } };
$('end-button').onclick = () => { endSession(); notice('互动已结束，麦克风已关闭。'); };
$('clear-chat').onclick = () => { clearMessages({ keepChoices: active }); notice('已清除本页字幕；结束互动还会关闭当前语音会话。'); };
$('resume-audio').onclick = () => provider?.resumeAudio();
$('logout-button').onclick = async () => {
  endSession(); $('logout-button').disabled = true;
  try {
    const response = await fetch('/api/logout', { method: 'POST', headers: { 'X-Session-Token': config.csrf } });
    if (!response.ok && response.status !== 401) throw new Error();
    location.reload();
  } catch { notice('退出登录尚未确认，请检查网络后重试。语音互动已停止。'); $('logout-button').disabled = false; }
};
$('reset-view').onclick = () => scene?.resetView();
function setQuality(value) { lightweight = value; scene?.setLightweight(value); $('quality').setAttribute('aria-pressed', String(value)); $('lightweight-check').checked = value; }
$('quality').onclick = () => setQuality(!lightweight);
function updateDataInfo(id, textInput = false) {
  const entry = config?.providers.find(p => p.id === id), audio = entry?.audio && !textInput;
  const deepseekInput = !audio ? '此模式不采集麦克风；' : entry?.asr === 'cloudflare' ? '麦克风音频发送给本站 Cloudflare 语音识别服务转成文字；' : '麦克风音频经本站发送给 OpenAI 转成文字；';
  const deepseekOutput = entry?.tts === 'local-gpu' ? '回答文字发送到配置的电脑，由本机 GPU 合成角色声音，再经本站传回播放。' : entry?.tts === 'cloudflare-minimax' ? '回答文字交给本站 Cloudflare AI 的 MiniMax 音色服务合成“天天”声音，再传回播放。' : entry?.tts === 'minimax_direct' ? '回答文字由本站 Worker 直连 MiniMax 音色服务合成，再传回播放。' : entry?.tts === 'cloudflare-melotts' ? '回答文字交给本站 Cloudflare Workers AI 的 MeloTTS 中文音色服务合成，再传回播放。' : entry?.tts === 'openai' ? '回答由 OpenAI 合成声音。' : '回答使用本机中文离线声音朗读。';
  const deepseekReview = entry?.moderation === 'openai-text' ? '输入和回答文字另交给 OpenAI 检查内容。' : '当前仅使用基础本地内容规则。';
  const data = id === 'demo' ? '本地演示使用预设回复和本机声音，不采集麦克风音频。'
    : id === 'deepseek' ? `${deepseekInput}文字和本次对话上下文发送给 DeepSeek 生成回答。${deepseekReview}${deepseekOutput}`
    : `${config?.realtimeTransport === 'websocket' ? '麦克风音频经过本站 Cloudflare 服务转发' : '麦克风音频发送'}给 OpenAI，用于理解和生成语音。${config?.providers.find(p => p.id === id)?.moderation === 'output-text' ? '回答文字再交给 OpenAI 检查内容，通过后才显示字幕和播放对应语音。' : ''}`;
  $('voice-data-info').textContent = `天天是 AI 角色，${entry?.tts === 'local-gpu' ? '声音由本机角色模型合成，音色仍在试听校准。' : entry?.tts === 'cloudflare-melotts' ? '声音由 Cloudflare Workers AI MeloTTS 合成，当前不是声音克隆。' : entry?.tts === 'minimax_direct' ? '声音由 MiniMax 直连接口合成，当前不是声音克隆。' : '当前声音不是动画原声。'}${data}本应用不持久保存录音或聊天内容；服务方的数据处理规则由部署者确认。`;
  $('voice-consent-info').textContent = `${audio ? '只有按住“按住说话”按钮时才会采集并发送麦克风音频；松开后完成收尾并停止发送。' : ''}${data}${audio ? '如果设备没有可用麦克风，会自动改为文字互动，你仍可在下方打字。' : ''}你可以随时结束；结束后关闭麦克风、清除本页字幕和服务器会话上下文。`;
}
function providerNote() {
  const id = $('provider-select').value, entry = config?.providers.find(p => p.id === id);
  const localCharacterVoice = entry?.tts === 'local-gpu';
  const configuredCharacterVoice = localCharacterVoice || entry?.tts === 'cloudflare-minimax' || entry?.tts === 'minimax_direct' || entry?.tts === 'cloudflare-melotts';
  if (previewing) { localSpeech.stop(); previewing = false; }
  $('voice-style-select').disabled = localCharacterVoice;
  $('voice-style-select').title = localCharacterVoice ? '当前角色模型使用固定音色与语速。' : '';
  $('local-voice-select').closest('label').hidden = configuredCharacterVoice;
  $('preview-voice').parentElement.hidden = configuredCharacterVoice;
  $('voice-preview-note').textContent = localCharacterVoice
    ? '当前使用天天参考音色，音色与语速由角色模型固定。保存后点击「开始互动」，即可听到实际回答；明亮 / 温柔选项暂不适用。'
    : entry?.tts === 'cloudflare-minimax' ? '当前使用服务器配置的 Cloudflare MiniMax“天天”定制音色；明亮 / 温柔会映射为服务端的情绪和语速。保存后点击「开始互动」试听实际回答。'
    : entry?.tts === 'minimax_direct' ? '当前使用服务器直连 MiniMax 的“天天”音色；Worker 会根据每轮回答的情绪动态调整语速、音高、音量和音色质感。保存后点击「开始互动」试听实际回答。'
    : entry?.tts === 'cloudflare-melotts' ? '当前使用 Cloudflare Workers AI MeloTTS 中文音色；模型没有定制音色参数，明亮 / 温柔会映射为轻微的语速与音高变化。保存后点击「开始互动」试听实际回答。'
    : '试听按钮使用演示配音。实时语音使用服务器配置的音色，请保存后开始互动试听。';
  $('provider-note').textContent = id === 'demo' ? '默认使用打包的瑶瑶角色配音。用预设对话体验动作和流程，不接入大模型，也不采集语音。'
    : !entry?.ready ? `尚未配置 ${id === 'deepseek' ? 'DEEPSEEK_API_KEY' : 'OPENAI_API_KEY'}，请由部署者设置。密钥只保留在服务器。`
    : id === 'deepseek' && entry.tts === 'local-gpu' ? `DeepSeek 负责对话与动作，配置的电脑生成角色声音。请保持电脑上的音色服务运行。${entry.voiceReady ? '音色服务已连接。' : '上次检查时音色服务未连接，启动后可重新开始互动。'}当前音色仍需试听校准。`
    : id === 'deepseek' && entry.tts === 'cloudflare-minimax' ? `DeepSeek 负责对话与动作，Cloudflare AI 的 MiniMax 负责合成服务器配置的“天天”定制音色。${entry.voiceReady ? '定制音色已配置。' : '定制音色尚未配置，请由部署者设置 CLOUDFLARE_TTS_VOICE_ID。'}${entry.asr === 'cloudflare' ? '中文语音识别也使用 Cloudflare。' : ''}生成音频需要等待片刻。`
    : id === 'deepseek' && entry.tts === 'minimax_direct' ? `DeepSeek 负责对话与动作，Worker 直连 MiniMax 合成服务器配置的“天天”音色。${entry.voiceReady ? '直连语音已配置。' : '直连语音尚未配置，请由部署者设置 MINIMAX_API_KEY 和相关 TTS 配置。'}${entry.asr === 'cloudflare' ? '中文语音识别也使用 Cloudflare。' : ''}生成音频需要等待片刻。`
    : id === 'deepseek' && entry.tts === 'cloudflare-melotts' ? `DeepSeek 负责对话与动作，Cloudflare Workers AI 的 MeloTTS 负责合成中文语音。${entry.voiceReady ? 'MeloTTS 已配置。' : 'MeloTTS 尚未配置，请由部署者确认 AI binding。'}${entry.asr === 'cloudflare' ? '中文语音识别也使用 Cloudflare。' : ''}当前使用固定模型音色，生成音频需要等待片刻。`
    : id === 'deepseek' ? entry.asr === 'cloudflare' ? `Cloudflare 识别中文语音，DeepSeek 负责对话与动作。${entry.tts === 'openai' ? 'OpenAI 负责文字内容检查和朗读。' : '回答先使用本机中文声音朗读，尚未接入动画原声音色；当前仅有基础本地内容规则。'}说完后稍作停顿，识别和回答需要时间。`
      : entry.audio ? 'DeepSeek 负责对话与动作，OpenAI 负责语音识别、文字内容检查和朗读。说完后需停顿约一秒，检查和生成也需要时间。内容检查不能保证所有回答都适合儿童。' : 'DeepSeek 已配置，可打字并使用本机中文离线声音朗读。目前仅有基础本地规则；语音和模型内容检查还需服务器配置 OpenAI 服务。'
    : entry.moderation === 'output-text' ? '服务已配置。开始时请求麦克风权限；回答生成并检查后播放，会增加等待时间。等待时也可以插话或打断。内容检查不能保证所有回答都适合儿童。' : '服务已配置。开始互动时将请求麦克风权限。';
  updateDataInfo(id);
}
$('parent-button').onclick = () => {
  $('provider-select').value = selectedProvider; $('age-select').value = settings.ageBand; $('minutes-select').value = settings.minutes; $('lightweight-check').checked = lightweight;
  $('voice-style-select').value = settings.voiceStyle; $('motion-select').value = motion;
  $('preview-voice').textContent = active || connecting ? '结束互动并试听演示配音' : '试听演示配音';
  void waitForVoices().then(voices => {
    $('local-voice-select').replaceChildren(new Option('角色配音 · 瑶瑶（推荐）', ''));
    for (const voice of localChineseVoices(voices)) $('local-voice-select').add(new Option(voice.name, voice.voiceURI));
    $('local-voice-select').value = localVoice;
  });
  $('save-settings').textContent = active || connecting ? '保存设置并结束当前互动' : '保存设置'; providerNote(); $('settings-dialog').showModal();
};
$('preview-voice').onclick = () => {
  if (active || connecting) endSession();
  previewing = true;
  $('preview-voice').textContent = '试听演示配音'; $('voice-preview-note').textContent = '正在准备演示配音…';
  void localSpeech.speak(VOICE_SAMPLE, { voiceStyle: $('voice-style-select').value, localVoice: $('local-voice-select').value }, {
    onStart: name => { $('voice-preview-note').textContent = `正在试听：${name}。这是本机合成声音，不是动画原声。`; },
    onEnd: () => { previewing = false; if ($('voice-preview-note').textContent.startsWith('正在试听')) $('voice-preview-note').textContent = '试听结束。可以换一个声音比较；实时语音音色请在实际连接后体验。'; },
    onUnavailable: text => { $('voice-preview-note').textContent = text; },
  });
};
$('stop-preview').onclick = () => { if (previewing) localSpeech.stop(); previewing = false; $('voice-preview-note').textContent = '试听已停止。'; };
document.querySelectorAll('[data-motion]').forEach(button => { button.onclick = () => {
  motion = $('motion-select').value; scene?.setMotionLevel(motion); $('settings-dialog').close(); scene?.play(button.dataset.motion);
} });
document.querySelectorAll('[data-showcase]').forEach(button => { button.onclick = () => scene?.play(button.dataset.showcase); });
$('settings-dialog').addEventListener('close', () => { if (previewing) localSpeech.stop(); previewing = false; scene?.setMotionLevel(motion); });
$('provider-select').onchange = providerNote;
$('settings-form').onsubmit = event => {
  event.preventDefault(); if (active || connecting) endSession();
  selectedProvider = $('provider-select').value; settings = sessionSettings({ ...settings, ageBand: $('age-select').value, minutes: Number($('minutes-select').value), voiceStyle: $('voice-style-select').value });
  localVoice = $('local-voice-select').value; motion = $('motion-select').value; scene?.setMotionLevel(motion);
  setQuality($('lightweight-check').checked); $('settings-dialog').close(); notice(''); updateUI(); $('clock-label').textContent = `每次 ${settings.minutes} 分钟，刚刚好`;
};
document.querySelectorAll('.close-dialog').forEach(button => { button.onclick = () => button.closest('dialog').close(); });
window.addEventListener('pagehide', () => { endSession(); });
// Moving the app into the background closes the mic rather than leaving it transmitting invisibly.
document.addEventListener('visibilitychange', () => { if (document.hidden) { if (previewing) { localSpeech.stop(); previewing = false; } if (active || connecting) { endSession(); notice('页面进入后台，互动已暂停，麦克风已关闭。'); } } });
setInterval(() => {
  if (!active || !expiresAt) return;
  const remaining = Math.max(0, expiresAt - Date.now());
  $('clock-label').textContent = `休息倒计时 ${String(Math.floor(remaining / 60000)).padStart(2, '0')}:${String(Math.floor(remaining / 1000) % 60).padStart(2, '0')}`;
  if (!remaining) { endSession(); $('rest-dialog').showModal(); }
}, 500);

config = bootstrapConfig; selectedProvider = config.defaultProvider;
for (const entry of config.providers) $('provider-select').add(new Option(entry.label, entry.id));
updateDataInfo(selectedProvider);
$('logout-button').hidden = !config.accessRequired;
clearMessages(); updateUI();
try {
  scene = new DogScene($('scene'), {
    modelUrl: config.modelUrl,
    level: () => provider?.level() || 0,
    onProgress: percent => { $('progress').style.width = `${percent || 4}%`; $('loading-label').textContent = percent === 100 ? '正在梳理毛毛，马上就好…' : `天天正在走进花园…${percent ? ` ${percent}%` : ''}`; },
    onLoad: () => { modelReady = true; $('loading').hidden = true; setQuality(lightweight); updateUI(); },
    onError: text => { modelReady = false; $('loading').hidden = false; $('loading-label').textContent = text; notice(text); if (active || connecting) endSession(); updateUI(); },
    onAction: name => { $('action-label').textContent = ACTIONS[name].label; },
  });
} catch { $('loading-label').textContent = '这个浏览器暂不支持 3D 显示，请换用最新版 Chrome 或 Edge。'; }
