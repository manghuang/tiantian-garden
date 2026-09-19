import { cpSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const target = resolve(root, '.cf-assets');
// Delete only this explicit generated staging directory within the project.
if (dirname(target) !== resolve(root) || !target.endsWith('.cf-assets')) throw new Error('Unsafe staging directory');
mkdirSync(target, { recursive: true });
// Keep the watched directory itself: Windows locks it while Wrangler is running.
for (const entry of readdirSync(target)) {
  const child = resolve(target, entry);
  if (dirname(child) !== target) throw new Error('Unsafe staging entry');
  rmSync(child, { recursive: true, force: true });
}
cpSync(join(root, 'dist'), target, { recursive: true });
cpSync(join(root, 'assets/dog-balanced.glb'), join(target, 'assets/dog-balanced.glb'));
let count = 0; let bytes = 0;
function inspect(folder) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) inspect(path);
    else { const size = statSync(path).size; if (size > 25 * 1024 * 1024) throw new Error(`Cloudflare asset exceeds 25 MiB: ${entry.name}`); count++; bytes += size; }
  }
}
inspect(target);
if (count > 20000) throw new Error('Cloudflare asset count exceeds free tier limit');
console.log(`Cloudflare assets ready: ${count} files, ${(bytes / 1024 / 1024).toFixed(1)} MiB total; each file <=25 MiB.`);
