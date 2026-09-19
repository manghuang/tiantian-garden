// Local-only setup; never print the worker credential or rotate an existing one.
import { readFile, writeFile, access } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const path = resolve(root, '.env.voice.local');
let raw;
try { raw = await readFile(path, 'utf8'); }
catch (error) { if (error.code !== 'ENOENT') throw error; raw = await readFile(resolve(root, '.env.voice.example'), 'utf8'); }
const env = parseEnv(raw), config = JSON.parse(await readFile(resolve(root, 'wrangler.jsonc'), 'utf8'));
if (env.PUBLIC_ORIGIN !== config.vars.PUBLIC_ORIGIN || !env.PUBLIC_ORIGIN.startsWith('https://')) throw new Error('Voice origin must match wrangler.jsonc.');
if (!env.REFERENCE_WAV || !env.REFERENCE_TEXT) throw new Error('A local reference WAV and transcript are required.');
await access(resolve(root, env.REFERENCE_WAV));
if (env.VOICE_WORKER_TOKEN && !/^[a-f0-9]{64}$/.test(env.VOICE_WORKER_TOKEN)) throw new Error('Existing worker token is invalid; no changes made.');
if (!env.VOICE_WORKER_TOKEN) {
  const entry = `VOICE_WORKER_TOKEN=${randomBytes(32).toString('hex')}`;
  raw = /^VOICE_WORKER_TOKEN=/m.test(raw) ? raw.replace(/^VOICE_WORKER_TOKEN=.*$/m, entry) : raw + '\n' + entry + '\n';
  await writeFile(path, raw, { mode: 0o600 });
  console.log('Created a private GPU worker credential in .env.voice.local. Value hidden.');
} else console.log('Existing GPU worker credential preserved.');
