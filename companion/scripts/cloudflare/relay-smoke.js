import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const root = new URL('../../', import.meta.url);
const bundled = await build({ entryPoints: [fileURLToPath(new URL('tests/fixtures/relay-worker.js', root))], bundle: true, write: false, format: 'esm', platform: 'neutral' });
const browserMode = process.argv.includes('--browser');
const workletFile = readdirSync(new URL('dist/assets/', root)).find(name => /^pcm-capture\.worklet-.*\.js$/.test(name));
function assets(request) {
  const path = new URL(request.url).pathname;
  if (path === '/') return new Response(readFileSync(new URL('tests/fixtures/pcm-browser.html', root)), { headers: { 'Content-Type': 'text/html' } });
  const files = { '/assets/pcm-player.js': 'src/providers/pcm-player.js', '/assets/pcm-browser.js': 'tests/fixtures/pcm-browser.js', [`/assets/${workletFile}`]: `dist/assets/${workletFile}` };
  if (!files[path]) return new Response('Not found', { status: 404 });
  return new Response(readFileSync(new URL(files[path], root), 'utf8').replace('__WORKLET_URL__', `/assets/${workletFile}`), { headers: { 'Content-Type': 'text/javascript' } });
}
const origin = 'http://127.0.0.1:8791', code = 'local-workerd-test-code-1234567890';
const mf = new Miniflare(convertV4MiniflareOptions({ host: '127.0.0.1', ...(browserMode ? { port: 8791 } : {}), workers: [
  { name: 'garden', modules: true, script: bundled.outputFiles[0].text, compatibilityDate: '2026-09-12',
    bindings: { PUBLIC_ORIGIN: origin, LOCAL_DEVELOPMENT: 'true', ACCESS_CODE: code, OPENAI_API_KEY: 'local-test-key', DEEPSEEK_API_KEY: 'local-test-key' },
    durableObjects: { GARDEN: { className: 'TestControl', useSQLite: true } },
    serviceBindings: { TEST_UPSTREAM: 'upstream', ASSETS: assets },
  },
  { name: 'upstream', modules: true, script: readFileSync(new URL('tests/fixtures/relay-upstream.js', root), 'utf8'), compatibilityDate: '2026-09-12' },
] }));
const sockets = [];
try {
  const request = (path, auth = {}, body, method = body ? 'POST' : 'GET') => mf.dispatchFetch(origin + path, { method, headers: { Origin: origin, 'Content-Type': 'application/json', ...auth }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const login = await request('/api/login', {}, { code }); assert.equal(login.status, 200);
  const Cookie = login.headers.get('set-cookie').split(';')[0];
  const config = await (await request('/api/config', { Cookie })).json();
  const auth = { Cookie, 'X-Session-Token': config.csrf };
  assert.equal(config.realtimeTransport, 'websocket');
  async function connect(provider = 'openai') {
    const response = await request('/api/session', auth, { provider, consent: true, audience: 'adult-test', settings: { minutes: 5 } }); assert.equal(response.status, 200);
    const session = await response.json();
    const upgrade = await request(session.socketPath, { ...auth, Upgrade: 'websocket', 'Sec-WebSocket-Protocol': `garden.v1, csrf.${config.csrf}` });
    assert.equal(upgrade.status, 101); assert.equal(upgrade.headers.get('Sec-WebSocket-Protocol'), 'garden.v1');
    const socket = upgrade.webSocket, events = []; sockets.push(socket);
    socket.addEventListener('message', ({ data }) => events.push(JSON.parse(data))); socket.accept();
    const until = async predicate => {
      const deadline = Date.now() + 10000;
      while (!predicate(events)) { if (Date.now() > deadline) throw new Error(`Timed out; event types: ${events.map(e => e.type).join(',')}`); await new Promise(r => setTimeout(r, 20)); }
    };
    await until(events => events.some(e => e.type === 'response.done'));
    return { socket, events, until, session };
  }
  const first = await connect();
  assert.ok(first.events.some(e => e.type === 'garden.ready'));
  assert.ok(first.events.some(e => e.type === 'response.output_audio.delta' && Buffer.from(e.delta, 'base64').length === 4800));
  assert.ok(!JSON.stringify(first.events).includes('instructions'));
  const length = first.events.length; first.socket.send(JSON.stringify({ type: 'text', text: '招手' }));
  await first.until(events => events.slice(length).filter(e => e.type === 'response.done').length === 2);
  assert.equal(first.events.filter(e => e.type === 'garden.behavior').length, 1);
  assert.ok(first.events.filter(e => e.type === 'response.done').every(e => e.response.output.length === 0));
  first.socket.send(JSON.stringify({ type: 'audio', audio: Buffer.alloc(4800).toString('base64') }));
  await first.until(events => events.some(e => e.type === 'conversation.item.input_audio_transcription.completed'));
  let closed = false; first.socket.addEventListener('close', () => { closed = true; });
  first.socket.send(JSON.stringify({ type: 'session.update', session: { instructions: 'forged' } }));
  await first.until(events => events.some(e => e.type === 'garden.error') && closed);
  const deepseek = await connect('deepseek');
  const dsLength = deepseek.events.length;
  deepseek.socket.send(JSON.stringify({ type: 'text', text: '招手' }));
  await deepseek.until(events => events.slice(dsLength).some(e => e.type === 'response.done'));
  assert.ok(deepseek.events.slice(dsLength).some(e => e.type === 'garden.behavior' && e.behavior.action === 'wave'));
  assert.ok(deepseek.events.slice(dsLength).some(e => e.type === 'response.output_audio.delta'));
  const voiced = Buffer.alloc(4800); for (let i = 0; i < voiced.length; i += 2) voiced.writeInt16LE(1000, i);
  for (let i = 0; i < 14; i++) deepseek.socket.send(JSON.stringify({ type: 'audio', audio: (i < 3 ? voiced : Buffer.alloc(4800)).toString('base64') }));
  await deepseek.until(events => events.some(e => e.type === 'conversation.item.input_audio_transcription.completed'));
  await deepseek.until(events => events.filter(e => e.type === 'response.done').length >= 3);
  assert.ok(!deepseek.events.some(e => e.type === 'garden.error'));
  const reviewStart = deepseek.events.length;
  deepseek.socket.send(JSON.stringify({ type: 'text', text: '审核拦截测试' }));
  await deepseek.until(events => events.slice(reviewStart).some(e => e.type === 'response.done'));
  const reviewed = deepseek.events.slice(reviewStart);
  assert.ok(!JSON.stringify(reviewed).includes('待拦截的测试回答'));
  assert.ok(reviewed.some(e => e.type === 'garden.behavior' && e.behavior.action === 'idle'));
  assert.ok(reviewed.some(e => e.type === 'response.output_audio.delta'));
  assert.equal((await request(`/api/session/${deepseek.session.id}`, auth, undefined, 'DELETE')).status, 204);
  const rejectedRealtime = await connect(); const rejectedStart = rejectedRealtime.events.length;
  let rejectedClosed = false; rejectedRealtime.socket.addEventListener('close', () => { rejectedClosed = true; });
  rejectedRealtime.socket.send(JSON.stringify({ type: 'text', text: '审核拦截测试' }));
  await rejectedRealtime.until(events => events.slice(rejectedStart).some(e => e.type === 'garden.error') && rejectedClosed);
  const rejectedEvents = rejectedRealtime.events.slice(rejectedStart);
  assert.ok(!rejectedEvents.some(e => ['garden.behavior', 'response.output_audio.delta', 'response.output_audio_transcript.done'].includes(e.type)));
  assert.ok(!JSON.stringify(rejectedEvents).includes('待拦截的测试回答'));
  const second = await connect();
  let logoutClosed = false; second.socket.addEventListener('close', () => { logoutClosed = true; });
  assert.equal((await request('/api/logout', auth, undefined, 'POST')).status, 204);
  await second.until(() => logoutClosed);
  assert.equal((await request('/api/config', auth)).status, 401);
  console.log('PASS: real workerd upgrade, checked OpenAI output, DeepSeek text/audio and moderation gating, captions, server actions, injection rejection, slot reuse and logout closure. Upstreams are local fixtures; no actual API call or microphone capture.');
  if (browserMode) {
    if (!workletFile) throw new Error('Build must emit the worklet as a file; data URLs are blocked by CSP.');
    await mf.ready; console.log('Browser acceptance page: http://127.0.0.1:8791/ (local fixtures only).');
    await new Promise(resolve => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve); });
  }
} finally { for (const socket of sockets) try { socket.close(); } catch {} await mf.dispose(); }
