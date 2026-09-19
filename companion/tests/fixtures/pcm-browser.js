import { PCMPlayer, encodePCM } from '/assets/pcm-player.js';
const button = document.querySelector('#run'), result = document.querySelector('#result');
button.onclick = async () => {
  button.disabled = true; result.textContent = '正在验证…';
  let context, socket, oscillator, capture, player, poll;
  try {
    context = new AudioContext({ sampleRate: 24000 }); await context.resume();
    await context.audioWorklet.addModule('__WORKLET_URL__');
    const login = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'local-workerd-test-code-1234567890' }) });
    if (!login.ok) throw new Error('Login failed');
    const config = await (await fetch('/api/config')).json();
    const session = await (await fetch('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Session-Token': config.csrf }, body: JSON.stringify({ consent: true, audience: 'adult-test', settings: { minutes: 5 } }) })).json();
    let packets = 0, captions = 0, audio = 0, peak = 0, inputPeak = 0;
    player = new PCMPlayer(context, () => {});
    const url = new URL(session.socketPath, location.href); url.protocol = 'ws:';
    socket = new WebSocket(url, ['garden.v1', `csrf.${config.csrf}`]);
    const finished = new Promise((resolve, reject) => {
      const deadline = Date.now() + 8000;
      poll = setInterval(() => {
        peak = Math.max(peak, player.level());
        if (packets && captions && audio >= 2 && inputPeak > 0 && peak > 0) resolve();
        else if (Date.now() > deadline) reject(new Error(`Timeout: ${JSON.stringify({ packets, captions, audio, inputPeak, peak })}`));
      }, 20);
      socket.onerror = () => reject(new Error('WebSocket failed'));
      socket.onmessage = async ({ data }) => {
        try {
          const e = JSON.parse(data);
          if (e.type === 'garden.error') throw new Error(e.message);
          if (e.type === 'response.output_audio.delta') { audio++; player.append(e.item_id, e.delta); }
          if (e.type === 'conversation.item.input_audio_transcription.completed') captions++;
          if (e.type === 'garden.ready') {
            oscillator = context.createOscillator(); oscillator.frequency.value = 440;
            const gain = context.createGain(); gain.gain.value = 0.02;
            capture = new AudioWorkletNode(context, 'garden-capture');
            oscillator.connect(gain); gain.connect(capture); capture.connect(context.destination);
            capture.port.onmessage = ({ data: pcm }) => {
              if (packets) return;
              if (pcm.byteLength !== 4800) { reject(new Error('Incorrect PCM packet size')); return; }
              const view = new DataView(pcm); for (let i = 0; i < pcm.byteLength; i += 2) inputPeak = Math.max(inputPeak, Math.abs(view.getInt16(i, true)));
              packets++; socket.send(JSON.stringify({ type: 'audio', audio: encodePCM(pcm) })); capture.port.postMessage(false); oscillator.stop();
            };
            capture.port.postMessage(true); oscillator.start();
          }
        } catch (error) { reject(error); }
      };
    });
    await finished;
    result.dataset.status = 'passed';
    result.textContent = `通过：安全策略下加载构建后的 AudioWorklet；24000 Hz 单声道采集；4800 字节 PCM 帧；同源 WebSocket；服务端转发；字幕回传；浏览器音频播放与音量分析。\n${JSON.stringify({ packets, captions, audio, inputPeak, peak }, null, 2)}`;
  } catch (error) { result.dataset.status = 'failed'; result.textContent = error.stack; }
  finally { clearInterval(poll); socket?.close(); try { oscillator?.stop(); } catch {} capture?.disconnect(); player?.dispose(); await context?.close(); button.disabled = false; }
};
