import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { WebSocket, EnvHttpProxyAgent, Agent } from 'undici';
import { pcmWav } from '../shared/speech-services.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const config = parseEnv(await readFile(resolve(root, '.env.voice.local'), 'utf8'));
const temperature = Number(config.TTS_TEMPERATURE || 1), speed = Number(config.TTS_SPEED || 1);
if (!Number.isFinite(temperature) || temperature < 0.5 || temperature > 1.2 || !Number.isFinite(speed) || speed < 0.85 || speed > 1.1) throw new Error('Invalid local voice tuning parameters.');
const reference = resolve(root, config.REFERENCE_WAV || '');
if (!config.REFERENCE_WAV || !config.REFERENCE_TEXT?.trim() || config.REFERENCE_TEXT.length > 500) throw new Error('Configure REFERENCE_WAV and REFERENCE_TEXT in .env.voice.local.');
await readFile(reference); // Fail before advertising a ready worker.
const ffmpeg = resolve(root, '../.tools/GPT-SoVITS/ffmpeg.exe');
const local = new Agent(), cloud = new EnvHttpProxyAgent();
const cache = new Map();
const greeting = '你好呀，我是屏幕里的 AI 小狗天天！今天想聊些什么呢？';
let stopped = false, socket, heartbeat, active;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const stateDirectory = resolve(root, '../.tools/voice-runtime');
const processStartedAt = new Date(Date.now() - process.uptime() * 1000).toISOString();
async function saveState(connected) {
  await mkdir(stateDirectory, { recursive: true });
  await writeFile(resolve(stateDirectory, 'bridge-state.json'), JSON.stringify({ pid: process.pid, processStartedAt, updatedAt: new Date().toISOString(), connected, workspace: resolve(root, '..') }));
}

async function synthesize(text, warmup = false) {
  // Text is the only per-job model input. References, weights and network
  // destinations are fixed by this operator-owned configuration.
  if (cache.has(text)) return cache.get(text);
  const started = Date.now();
  const response = await fetch('http://127.0.0.1:9880/tts', {
    method: 'POST', dispatcher: local, signal: AbortSignal.timeout(warmup ? 120000 : 26000),
    headers: { 'Content-Type': 'application/json' },
    // Short child-facing replies are synthesized as one sentence so prosody is
    // continuous. Longer safety/model fallbacks still use punctuation cuts to
    // stay within the model's context and output bounds.
    body: JSON.stringify({ text, text_lang: 'all_zh', ref_audio_path: reference,
      prompt_text: config.REFERENCE_TEXT, prompt_lang: 'all_zh', text_split_method: text.length <= 140 ? 'cut0' : 'cut5',
      media_type: 'wav', streaming_mode: false, batch_size: 1, seed: 42,
      speed_factor: speed, top_k: 15, top_p: 1, temperature, parallel_infer: true }),
  });
  if (!response.ok || !response.headers.get('content-type')?.includes('audio/')) { await response.body?.cancel(); throw new Error(`Local synthesis HTTP ${response.status}`); }
  const chunks = []; let size = 0;
  for await (const bytes of response.body) {
    size += bytes.length; if (size > 8000000) throw new Error('Synthesis audio too long'); chunks.push(bytes);
  }
  const wav = Buffer.concat(chunks);
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Expected WAV audio');
  const pcm = await new Promise((resolvePCM, reject) => {
    const child = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-vn', '-af', 'loudnorm=I=-20:TP=-2:LRA=7', '-ac', '1', '-ar', '24000', '-f', 's16le', 'pipe:1'], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    const out = []; let bytes = 0; const timer = setTimeout(() => child.kill(), 5000);
    child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > 1440000) child.kill(); else out.push(chunk); });
    child.stdin.on('error', () => {}); child.on('error', reject);
    child.on('close', code => { clearTimeout(timer); if (code || !bytes || bytes > 1440000 || bytes % 2) reject(new Error('Audio conversion failed')); else resolvePCM(Buffer.concat(out)); });
    child.stdin.end(wav);
  });
  if (text === greeting) cache.set(text, pcm); // Only a fixed, non-private greeting.
  console.log(`GPU synthesis ${Date.now() - started} ms; audio ${(pcm.length / 48000).toFixed(2)} s.`);
  return pcm;
}

if (process.argv.includes('--audition')) {
  const destination = resolve(root, '../output/voice-auditions'); await mkdir(destination, { recursive: true });
  const phrases = ['你好呀，我是天天！我们一起去发现有趣的事情吧。', '别着急，我们慢慢来。我陪你再试一次，好吗？', '准备好了吗？让我们飞上天空，开始新的冒险吧！'];
  for (let i = 0; i < phrases.length; i++) {
    const pcm = await synthesize(phrases[i], true);
    // Auditions are short; pcmWav deliberately enforces the 20-second bound.
    await writeFile(resolve(destination, `tiantian-${i + 1}.wav`), pcmWav(pcm));
  }
  await writeFile(resolve(destination, 'audition.json'), JSON.stringify({ generatedAt: new Date().toISOString(), engine: 'GPT-SoVITS v2ProPlus', reference, temperature, speed, phrases, similarityVerified: false }, null, 2));
  console.log(`Saved three audition samples to ${destination}`);
  await local.close(); await cloud.close();
} else {
  const origin = new URL(config.PUBLIC_ORIGIN || '');
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || !/^[a-f0-9]{64}$/.test(config.VOICE_WORKER_TOKEN || '')) throw new Error('Configure the HTTPS origin and private 64-character VOICE_WORKER_TOKEN.');
  console.log('Warming the fixed character reference on the local GPU…');
  await saveState(false);
  await synthesize(greeting, true);
  const send = (ws, event) => { if (ws.readyState === 1) ws.send(JSON.stringify(event)); };
  async function handle(ws, event) {
    if (event.type === 'ready') { await saveState(true); console.log('Local character voice connected. Keep this computer on during demonstrations.'); return; }
    if (event.type === 'pong') { await saveState(true); return; }
    if (event.type === 'cancel' && active?.id === event.id) { active.cancelled = true; return; }
    if (event.type !== 'synthesize' || active || !/^[a-f0-9-]{36}$/.test(event.id || '') || typeof event.text !== 'string' || !event.text.trim() || event.text.length > 500) { ws.close(); return; }
    const job = { id: event.id, cancelled: false }; active = job;
    try {
      const pcm = await synthesize(event.text);
      for (let offset = 0; offset < pcm.length && !job.cancelled && ws.readyState === 1; offset += 24000) {
        send(ws, { type: 'audio', id: job.id, audio: pcm.subarray(offset, offset + 24000).toString('base64') });
        await delay(0); // Allow cancellation/control events between chunks.
      }
      send(ws, { type: 'done', id: job.id });
    } catch { send(ws, { type: 'failed', id: job.id }); console.error('Local voice synthesis failed. Check the model console; no dialogue text was logged by this bridge.'); }
    finally { if (active === job) active = null; }
  }
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopped = true; if (active) active.cancelled = true; socket?.close(); });
  while (!stopped) {
    await new Promise(resolveClosed => {
      socket = new WebSocket(new URL('/api/voice-worker/socket', origin).href.replace('https:', 'wss:'), {
        dispatcher: cloud, headers: { Authorization: `Bearer ${config.VOICE_WORKER_TOKEN}` },
      });
      const ws = socket; let lastSeen = Date.now();
      const connectTimer = setTimeout(() => ws.close(), 20000);
      ws.onopen = () => { clearTimeout(connectTimer); heartbeat = setInterval(() => { if (Date.now() - lastSeen > 45000) ws.close(); else send(ws, { type: 'ping' }); }, 10000); };
      ws.onmessage = event => {
        lastSeen = Date.now();
        try { if (typeof event.data !== 'string' || event.data.length > 4000) throw new Error(); void handle(ws, JSON.parse(event.data)).catch(() => ws.close()); }
        catch { ws.close(); }
      };
      ws.onerror = () => console.error('Voice connection unavailable; retrying shortly.');
      ws.onclose = () => { clearTimeout(connectTimer); clearInterval(heartbeat); if (active) active.cancelled = true; void saveState(false).catch(() => {}); resolveClosed(); };
    });
    // Let the old HTTP synthesis finish before admitting a new cloud connection.
    while (active && !stopped) await delay(100);
    if (!stopped) await delay(5000);
  }
  await local.close(); await cloud.close();
  await saveState(false);
}
