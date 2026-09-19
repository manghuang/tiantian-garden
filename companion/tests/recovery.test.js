import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../server/app.js';
import { leaseJournal } from '../server/leases.js';

test('journal excludes login credentials and a failed closure survives process replacement', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'garden-recovery-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'calls.json');
  const journal = leaseJournal(file);
  journal.write(new Map([['saved-id', { callId: 'rtc_crashed', expiresAt: Date.now() + 60000, owner: 'private-cookie', csrf: 'private-csrf', transcript: 'private-text' }]]));
  assert.ok(!readFileSync(file, 'utf8').includes('private-'));
  let attempts = 0;
  const first = createApp({ env: { OPENAI_API_KEY: 'test', SESSION_STORE_FILE: file }, fetcher: async () => { attempts++; return new Response(null, { status: 503 }); } });
  await first.ready;
  assert.equal(attempts, 1); assert.equal(journal.read().length, 1);
  await first.shutdown(); assert.equal(journal.read().length, 1);
  const closed = [];
  const second = createApp({ env: { OPENAI_API_KEY: 'test', SESSION_STORE_FILE: file }, fetcher: async url => { closed.push(url); return new Response(null, { status: 404 }); } });
  await second.ready;
  assert.deepEqual(closed, ['https://api.openai.com/v1/realtime/calls/rtc_crashed/hangup']);
  assert.deepEqual(journal.read(), []);
  await second.shutdown();
});

test('malformed recovery journals stop startup instead of silently forgetting open calls', () => {
  const directory = mkdtempSync(join(tmpdir(), 'garden-corrupt-'));
  try {
    const file = join(directory, 'calls.json');
    writeFileSync(file, '{invalid'); assert.throws(() => leaseJournal(file).read());
    writeFileSync(file, JSON.stringify({ version: 1, calls: [{ id: 'id', callId: '../elsewhere', expiresAt: 0 }] }));
    assert.throws(() => leaseJournal(file).read());
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('global capacity counts three simultaneous upstream offers before their answers exist', async t => {
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const allEntered = new Promise(resolve => { entered = resolve; });
  let count = 0;
  const service = createApp({ env: { OPENAI_API_KEY: 'test' }, fetcher: async url => {
    if (url.endsWith('/hangup')) return new Response(null);
    const sequence = ++count; if (count === 3) entered(); await gate;
    return new Response('v=0\r\nanswer', { status: 201, headers: { Location: `/v1/realtime/calls/rtc_${sequence}` } });
  } });
  const server = service.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { release(); await service.shutdown(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const config = await (await fetch(base + '/api/config')).json();
  const send = () => fetch(base + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Session-Token': config.csrf }, body: JSON.stringify({ consent: true, audience: 'adult-test', sdp: 'v=0\r\noffer' }) });
  const waiting = [send(), send(), send()];
  await allEntered;
  try { assert.equal((await send()).status, 429); assert.equal(count, 3); }
  finally { release(); }
  for (const response of await Promise.all(waiting)) assert.equal(response.status, 200);
});
