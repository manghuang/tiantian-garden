import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
const root = new URL('../', import.meta.url);
const bundled = await build({ entryPoints: [fileURLToPath(new URL('tests/fixtures/relay-worker.js', root))], bundle: true, write: false, format: 'esm', platform: 'neutral' });
const origin = 'http://127.0.0.1:8792', code = 'local-workerd-test-code-1234567890', token = 'test-only-gpu-worker-token-1234567890';
const mf = new Miniflare(convertV4MiniflareOptions({ host: '127.0.0.1', workers: [
  { name: 'garden', modules: true, script: bundled.outputFiles[0].text, compatibilityDate: '2026-09-12',
    bindings: { PUBLIC_ORIGIN: origin, LOCAL_DEVELOPMENT: 'true', ACCESS_CODE: code, DEEPSEEK_API_KEY: 'local-test-key', DEEPSEEK_TTS: 'local-gpu', VOICE_WORKER_TOKEN: token },
    durableObjects: { GARDEN: { className: 'TestControl', useSQLite: true } }, serviceBindings: { TEST_UPSTREAM: 'upstream' } },
  { name: 'upstream', modules: true, script: readFileSync(new URL('tests/fixtures/relay-upstream.js', root), 'utf8'), compatibilityDate: '2026-09-12' },
] }));
let gpu, browser;
const until = async fn => { const end = Date.now() + 10000; while (!fn()) { if (Date.now() > end) throw new Error('Local GPU relay check timed out'); await new Promise(resolve => setTimeout(resolve, 20)); } };
try {
  const req = (path, headers = {}, body) => mf.dispatchFetch(origin + path, { method: body ? 'POST' : 'GET', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const login = await req('/api/login', {}, { code }); assert.equal(login.status, 200);
  const Cookie = login.headers.get('set-cookie').split(';')[0]; const config = await (await req('/api/config', { Cookie })).json();
  const auth = { Cookie, 'X-Session-Token': config.csrf };
  assert.equal((await req('/api/voice-worker/socket', { ...auth, Upgrade: 'websocket' })).status, 401);
  const upgrade = await mf.dispatchFetch(origin + '/api/voice-worker/socket', { headers: { Authorization: `Bearer ${token}`, Upgrade: 'websocket' } });
  assert.equal(upgrade.status, 101); gpu = upgrade.webSocket; const jobs = [];
  gpu.addEventListener('message', ({ data }) => {
    const event = JSON.parse(data);
    if (event.type === 'synthesize') {
      jobs.push(event); assert.deepEqual(Object.keys(event).sort(), ['id', 'style', 'text', 'type']);
      gpu.send(JSON.stringify({ type: 'audio', id: event.id, audio: Buffer.alloc(4800).toString('base64') }));
      gpu.send(JSON.stringify({ type: 'done', id: event.id }));
    }
  }); gpu.accept();
  const ready = await (await req('/api/config', auth)).json(); assert.equal(ready.providers.find(p => p.id === 'deepseek').voiceReady, true);
  assert.equal((await mf.dispatchFetch(origin + '/api/voice-worker/socket', { headers: { Authorization: `Bearer ${token}`, Upgrade: 'websocket' } })).status, 409);
  const created = await req('/api/session', auth, { provider: 'deepseek', consent: true, audience: 'adult-test', settings: { minutes: 5 } }); assert.equal(created.status, 200);
  const session = await created.json(); const br = await req(session.socketPath, { ...auth, Upgrade: 'websocket', 'Sec-WebSocket-Protocol': `garden.v1, csrf.${config.csrf}` }); assert.equal(br.status, 101);
  const events = []; browser = br.webSocket; browser.addEventListener('message', ({ data }) => events.push(JSON.parse(data))); browser.accept();
  await until(() => events.some(e => e.type === 'response.done'));
  assert.equal(jobs.length, 1); assert.ok(events.some(e => e.type === 'response.output_audio.delta'));
  browser.send(JSON.stringify({ type: 'text', text: '招手' }));
  await until(() => events.filter(e => e.type === 'response.done').length === 2);
  assert.equal(jobs.length, 2); assert.match(jobs[1].text, /招招手/);
  assert.ok(events.some(e => e.type === 'garden.behavior' && e.behavior.action === 'wave'));
  gpu.close();
  // Give the close event its turn before checking current availability.
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal((await (await req('/api/config', auth)).json()).providers.find(p => p.id === 'deepseek').voiceReady, false);
  console.log('PASS: real workerd GPU authentication, duplicate rejection, controlled text jobs, PCM relay, DeepSeek reply/action, and worker disconnection. Audio/model outputs are protocol fixtures.');
} finally { try { browser?.close(); gpu?.close(); } catch {} await mf.dispose(); }
