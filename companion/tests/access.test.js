import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { createApp } from '../server/app.js';
import { deploymentSettings } from '../server/access.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const code = 'test-only-random-access-code-123456';
const origin = 'https://garden.example';
const valid = { consent: true, audience: 'adult-test', sdp: 'v=0\r\noffer', settings: { minutes: 5 } };
function wireFetch(url, options) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, options, res => {
      const chunks = []; res.on('data', b => chunks.push(b)); res.on('error', reject);
      res.on('end', () => resolve(new Response(res.statusCode === 204 ? null : Buffer.concat(chunks), { status: res.statusCode, headers: Object.fromEntries(Object.entries(res.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : value])) })));
    });
    req.on('error', reject); req.end(options.body);
  });
}
async function fixture(t, { env = {}, fetcher } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'garden-access-'));
  const service = createApp({ env: { OPENAI_API_KEY: 'fake', ACCESS_CODE: code, SESSION_STORE_FILE: join(directory, 'leases.json'), ...env }, fetcher });
  const server = service.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await service.shutdown(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); rmSync(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, { cookie, csrf, body, method = body === undefined ? 'GET' : 'POST', headers = {} } = {}) => wireFetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', ...(env.DEPLOYMENT_MODE === 'private' ? { Host: 'garden.example', Origin: origin } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { 'X-Session-Token': csrf } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const login = async () => {
    const response = await request('/api/login', { body: { code } }); assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie').split(';')[0];
    const config = await (await request('/api/config', { cookie })).json();
    return { cookie, csrf: config.csrf, response };
  };
  return { request, login, shutdown: service.shutdown };
}

test('public exposure fails closed without HTTPS origin and a strong admission code', () => {
  for (const env of [{ DEPLOYMENT_MODE: 'public' }, { BIND_HOST: '0.0.0.0' }, { DEPLOYMENT_MODE: 'private', PUBLIC_ORIGIN: 'http://garden.example', ACCESS_CODE: code }, { DEPLOYMENT_MODE: 'private', PUBLIC_ORIGIN: origin, ACCESS_CODE: 'weak' }]) assert.throws(() => deploymentSettings(env));
  assert.equal(deploymentSettings({ DEPLOYMENT_MODE: 'private', PUBLIC_ORIGIN: origin, ACCESS_CODE: code }).host, '0.0.0.0');
});

test('private deployment requires login, binds origin and issues secure independent cookies/CSRF', async t => {
  const { request, login } = await fixture(t, { env: { DEPLOYMENT_MODE: 'private', PUBLIC_ORIGIN: origin } });
  assert.equal((await request('/api/config')).status, 401);
  assert.equal((await request('/assets/dog-balanced.glb')).status, 401);
  assert.equal((await request('/assets/dog-v48.glb')).status, 401);
  assert.equal((await request('/api/auth', { headers: { Host: 'evil.example', 'X-Forwarded-Host': 'garden.example' } })).status, 403);
  assert.equal((await request('/api/login', { body: { code }, headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await request('/api/login', { body: { code }, headers: { Origin: '' } })).status, 403);
  assert.equal((await request('/api/login', { body: { code: 'bad' } })).status, 401);
  const a = await login(), b = await login();
  assert.notEqual(a.cookie, b.cookie); assert.notEqual(a.csrf, b.csrf);
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) assert.ok(a.response.headers.get('set-cookie').includes(flag));
  assert.ok(a.cookie.startsWith('__Host-garden='));
  assert.match(a.response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  // Embedded GLB images use fetch(blob:), so img-src permission is insufficient.
  assert.match(a.response.headers.get('content-security-policy'), /(?:^|; )connect-src 'self' blob:;/);
  assert.equal((await request('/api/logout', { ...a, csrf: b.csrf, method: 'POST' })).status, 403);
  assert.equal((await request('/api/logout', { ...a, method: 'POST' })).status, 204);
  assert.equal((await request('/api/config', a)).status, 401);
  assert.equal((await request('/api/config', b)).status, 200);
});

test('logout closes only owned calls and other logins cannot hang up a call', async t => {
  const hung = [];
  const { request, login } = await fixture(t, { fetcher: async url => {
    if (url.endsWith('/hangup')) { hung.push(url); return new Response(null); }
    return new Response('v=0\r\nanswer', { status: 201, headers: { Location: '/v1/realtime/calls/rtc_owned' } });
  } });
  const a = await login(), b = await login();
  const result = await (await request('/api/session', { ...a, body: valid })).json();
  assert.ok(result.id);
  assert.equal((await request(`/api/session/${result.id}`, { ...b, method: 'DELETE' })).status, 404);
  assert.equal(hung.length, 0);
  assert.equal((await request('/api/session', { ...a, body: valid })).status, 429);
  assert.equal((await request('/api/logout', { ...a, method: 'POST' })).status, 204);
  assert.equal(hung.length, 1);
});

test('pending connection reserves a slot and logout during setup cancels the late call', async t => {
  let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { started = resolve; });
  let creates = 0, hangs = 0;
  const { request, login } = await fixture(t, { fetcher: async url => {
    if (url.endsWith('/hangup')) { hangs++; return new Response(null); }
    creates++; started(); await gate;
    return new Response('v=0\r\nanswer', { status: 201, headers: { Location: '/v1/realtime/calls/rtc_late' } });
  } });
  const a = await login();
  const first = request('/api/session', { ...a, body: valid });
  await entered;
  try {
    assert.equal((await request('/api/session', { ...a, body: valid })).status, 429);
    await request('/api/logout', { ...a, method: 'POST' });
  } finally { release(); }
  assert.equal((await first).status, 503); assert.equal(creates, 1); assert.equal(hangs, 1);
});

test('invalid successful SDP closes the upstream call instead of leaking capacity', async t => {
  let hangs = 0;
  const { request, login } = await fixture(t, { fetcher: async url => {
    if (url.endsWith('/hangup')) { hangs++; return new Response(null); }
    return new Response('malformed', { status: 201, headers: { Location: '/v1/realtime/calls/rtc_invalid' } });
  } });
  const a = await login();
  assert.equal((await request('/api/session', { ...a, body: valid })).status, 502);
  assert.equal(hangs, 1);
});

test('global login limit cannot be bypassed with forged forwarding headers', async t => {
  const { request } = await fixture(t);
  for (let i = 0; i < 10; i++) assert.equal((await request('/api/login', { body: { code: 'bad' }, headers: { 'X-Forwarded-For': `10.0.0.${i}` } })).status, 401);
  const denied = await request('/api/login', { body: { code } });
  assert.equal(denied.status, 429); assert.equal(denied.headers.get('retry-after'), '60');
});
