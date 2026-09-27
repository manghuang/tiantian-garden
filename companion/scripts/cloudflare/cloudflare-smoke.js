import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
process.loadEnvFile(fileURLToPath(new URL('../../.dev.vars', import.meta.url)));
const origin = 'http://127.0.0.1:8787';
const request = (path, options = {}) => fetch(origin + path, { ...options, headers: { Origin: origin, ...options.headers } });
assert.equal((await request('/api/health')).status, 200);
assert.equal((await request('/api/config')).status, 401);
assert.equal((await request('/assets/dog-balanced.glb', { method: 'HEAD' })).status, 401);
const login = await request('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: process.env.ACCESS_CODE }) });
assert.equal(login.status, 200);
const Cookie = login.headers.get('set-cookie').split(';')[0];
const configResponse = await request('/api/config', { headers: { Cookie } }); assert.equal(configResponse.status, 200);
const config = await configResponse.json(); assert.equal(config.modelUrl, '/assets/dog-balanced.glb');
assert.deepEqual(config.models.map(model => model.id), ['balanced', 'v48']);
try {
assert.ok(config.providers.some(p => p.id === 'deepseek'));
assert.equal(config.providers.find(p => p.id === 'deepseek').moderation, process.env.OPENAI_API_KEY ? 'openai-text' : 'local-rules');
assert.match(configResponse.headers.get('content-security-policy'), /(?:^|; )connect-src 'self' blob:;/);
const model = await request(config.modelUrl, { headers: { Cookie } });
assert.equal(model.status, 200); assert.equal(model.headers.get('cache-control'), 'private, no-store');
const modelBytes = Buffer.from(await model.arrayBuffer());
assert.equal(modelBytes.length, 24603508); assert.equal(modelBytes.subarray(0, 4).toString(), 'glTF');
const v48 = await request('/assets/dog-v48.glb', { headers: { Cookie } }); assert.equal(v48.status, 200);
assert.equal(v48.headers.get('cache-control'), 'private, no-store');
const v48Bytes = Buffer.from(await v48.arrayBuffer());
assert.ok(v48Bytes.length < 25 * 1024 * 1024); assert.equal(v48Bytes.subarray(0, 4).toString(), 'glTF');
const voice = await request('/voices/preview-bright.wav', { headers: { Cookie } }); assert.equal(voice.status, 200);
assert.equal(Buffer.from(await voice.arrayBuffer()).subarray(0, 4).toString(), 'RIFF');
assert.equal((await request('/api/logout', { method: 'POST', headers: { Cookie } })).status, 403);
} finally {
assert.equal((await request('/api/logout', { method: 'POST', headers: { Cookie, 'X-Session-Token': config.csrf } })).status, 204);
}
assert.equal((await request('/api/config', { headers: { Cookie } })).status, 401);
assert.equal((await request('/voices/preview-bright.wav', { headers: { Cookie } })).status, 401);
console.log('Cloudflare local runtime verified: login, durable session, CSRF, actual GLB/WAV serving, logout and asset revocation. No provider call or cloud deployment made.');
