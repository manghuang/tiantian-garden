// Run explicitly after deploying the Worker. Secret values travel over stdin,
// never command-line arguments or application logs.
import { readFileSync, existsSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const local = parseEnv(readFileSync(new URL('.dev.vars', root), 'utf8'));
const production = parseEnv(readFileSync(new URL('.env.production', root), 'utf8'));
const config = JSON.parse(readFileSync(new URL('wrangler.jsonc', root), 'utf8'));
if (production.PUBLIC_ORIGIN !== config.vars.PUBLIC_ORIGIN || !production.PUBLIC_ORIGIN.startsWith('https://')) throw new Error('Production origin does not match wrangler.jsonc.');
if (!production.ACCESS_CODE || production.ACCESS_CODE.length < 24 || production.ACCESS_CODE.length > 256 || production.ACCESS_CODE === 'replace-with-a-long-random-local-code') throw new Error('A non-example production access code is required.');
const secrets = { ACCESS_CODE: production.ACCESS_CODE };
for (const name of ['DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'OPENAI_CUSTOM_VOICE_ID', 'CLOUDFLARE_TTS_VOICE_ID']) {
  if (local[name]?.trim()) secrets[name] = local[name].trim();
}
const voicePath = new URL('.env.voice.local', root);
if (existsSync(voicePath)) {
  const voice = parseEnv(readFileSync(voicePath, 'utf8'));
  if (voice.VOICE_WORKER_TOKEN) {
    if (voice.PUBLIC_ORIGIN !== production.PUBLIC_ORIGIN || !/^[a-f0-9]{64}$/.test(voice.VOICE_WORKER_TOKEN)) throw new Error('Local GPU credential/origin is invalid.');
    secrets.VOICE_WORKER_TOKEN = voice.VOICE_WORKER_TOKEN;
  }
}
// Omitted values preserve existing server secrets; removal must be explicit.
console.log(`Publishing configured secrets: ${Object.keys(secrets).join(', ')} (values hidden).`);
const child = spawn(process.execPath, [fileURLToPath(new URL('node_modules/wrangler/bin/wrangler.js', root)), 'secret', 'bulk'], {
  cwd: fileURLToPath(root), stdio: ['pipe', 'inherit', 'inherit'], windowsHide: true,
});
child.stdin.on('error', () => {});
child.on('error', () => { console.error('Could not start Wrangler.'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
child.stdin.end(JSON.stringify(secrets));
