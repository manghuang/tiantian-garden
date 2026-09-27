import validator from 'gltf-validator';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const bytes = readFileSync(new URL('../../assets/dog-v48.glb', import.meta.url));
const validation = await validator.validateBytes(new Uint8Array(bytes), { uri: 'dog-v48.glb', maxIssues: 250 });
const report = { sha256: createHash('sha256').update(bytes).digest('hex'), ...validation };
writeFileSync(new URL('../../assets/model-v48-validation.json', import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ bytes: bytes.length, errors: validation.issues.numErrors, warnings: validation.issues.numWarnings, infos: validation.issues.numInfos, messages: validation.issues.messages.slice(0, 12) }));
process.exitCode = validation.issues.numErrors ? 1 : 0;
