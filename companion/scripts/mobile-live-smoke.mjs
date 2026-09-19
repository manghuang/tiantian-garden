// Explicit production acceptance using only bundled synthetic speech and a test question.
// Credentials stay in memory; no microphone audio or user conversation is collected.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { fetch, WebSocket, EnvHttpProxyAgent } from 'undici';

const root = new URL('../', import.meta.url);
const credentials = parseEnv(readFileSync(new URL('.env.production', root), 'utf8'));
const deployment = JSON.parse(readFileSync(new URL('wrangler.jsonc', root), 'utf8'));
const origin = deployment.vars.PUBLIC_ORIGIN;
assert.equal(origin, credentials.PUBLIC_ORIGIN);
const dispatcher = new EnvHttpProxyAgent();
let cookie, config, socket, session, ping;
const request = (path, body, method = body ? 'POST' : 'GET') => fetch(origin + path, {
  method, dispatcher, signal: AbortSignal.timeout(20000),
  headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(config ? { 'X-Session-Token': config.csrf } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
});
const events = [];
async function turn(start) {
  const deadline = Date.now() + 60000;
  while (!events.slice(start).some(e => e.type === 'response.done')) {
    assert.ok(Date.now() < deadline, 'Production turn timed out');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const output = events.slice(start), done = output.find(e => e.type === 'response.done');
  const chunks = output.filter(e => e.type === 'response.output_audio.delta');
  const bytes = Buffer.concat(chunks.map(e => Buffer.from(e.delta, 'base64')));
  const result = { status: done.response.status, audioBytes: bytes.length, format: chunks[0]?.audio_format, transcript: output.some(e => e.type === 'response.output_audio_transcript.done'), asr: output.some(e => e.type === 'conversation.item.input_audio_transcription.completed'), audioDone: output.some(e => e.type === 'response.output_audio.done'), localFallback: output.some(e => e.type === 'garden.speech_fallback') };
  console.log(JSON.stringify(result));
  assert.equal(result.status, 'completed', 'Production synthesis failed');
  if (result.localFallback) {
    assert.ok(result.transcript && output.some(e => e.type === 'garden.notice'));
    return result;
  }
  assert.equal(result.format, 'audio/mpeg'); assert.ok(result.audioDone && result.transcript && bytes.length > 100);
  assert.ok(bytes.subarray(0, 3).toString() === 'ID3' || (bytes[0] === 255 && (bytes[1] & 224) === 224), 'Expected an MP3 header');
  return result;
}
try {
  const login = await request('/api/login', { code: credentials.ACCESS_CODE }); assert.equal(login.status, 200);
  cookie = login.headers.get('set-cookie').split(';')[0];
  const info = await request('/api/config'); assert.equal(info.status, 200); config = await info.json();
  const provider = config.providers.find(p => p.id === 'deepseek');
  assert.ok(['cloudflare-minimax', 'cloudflare-melotts'].includes(provider.tts)); assert.equal(provider.voiceReady, true);
  const created = await request('/api/session', { provider: 'deepseek', consent: true, audience: 'adult-test', settings: { minutes: 5 } });
  assert.equal(created.status, 200); session = await created.json();
  socket = new WebSocket(origin.replace('https:', 'wss:') + session.socketPath, { protocols: ['garden.v1', `csrf.${config.csrf}`], headers: { Origin: origin, Cookie: cookie }, dispatcher });
  socket.addEventListener('message', ({ data }) => events.push(JSON.parse(data)));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket connection timed out')), 20000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('WebSocket connection failed')); }, { once: true });
  });
  ping = setInterval(() => socket.send(JSON.stringify({ type: 'ping' })), 5000);
  await turn(0);
  let start = events.length; socket.send(JSON.stringify({ type: 'text', text: '你好，请用一句话介绍自己。' })); await turn(start);
  // Read the shipped PCM WAV and resample to the same 24 kHz packets as mobile capture.
  const wav = readFileSync(new URL('public/voices/preview-bright.wav', root));
  let offset = 12, data, rate, channels;
  while (offset + 8 <= wav.length) {
    const size = wav.readUInt32LE(offset + 4), kind = wav.toString('ascii', offset, offset + 4);
    if (kind === 'fmt ') { assert.equal(wav.readUInt16LE(offset + 8), 1); channels = wav.readUInt16LE(offset + 10); rate = wav.readUInt32LE(offset + 12); assert.equal(wav.readUInt16LE(offset + 22), 16); }
    if (kind === 'data') data = wav.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size + size % 2;
  }
  assert.ok(data && rate && channels); const frames = Math.min(Math.floor(data.length / (2 * channels) * 24000 / rate), 24000 * 15);
  const pcm = Buffer.alloc(Math.ceil(frames / 2400) * 4800);
  for (let i = 0; i < frames; i++) pcm.writeInt16LE(data.readInt16LE(Math.min(Math.floor(i * rate / 24000), data.length / (2 * channels) - 1) * channels * 2), i * 2);
  start = events.length;
  for (let i = 0; i < pcm.length; i += 4800) { socket.send(JSON.stringify({ type: 'audio', audio: pcm.subarray(i, i + 4800).toString('base64') })); await new Promise(resolve => setTimeout(resolve, 100)); }
  socket.send(JSON.stringify({ type: 'audio_end' }));
  assert.ok((await turn(start)).asr);
  console.log(`PASS: production ${provider.tts} greeting, typed reply and bundled speech ASR → DeepSeek, with MP3 or explicit local fallback as reported above. Physical mobile/browser playback not tested.`);
} finally {
  clearInterval(ping); socket?.close();
  if (session) await request(`/api/session/${session.id}`, undefined, 'DELETE');
  if (cookie && config) await request('/api/logout', undefined, 'POST');
  await dispatcher.close();
}
