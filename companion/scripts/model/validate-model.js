import validator from 'gltf-validator';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const bytes = readFileSync(new URL('../../assets/dog-balanced.glb', import.meta.url));
const validation = await validator.validateBytes(new Uint8Array(bytes), { uri: 'dog-balanced.glb', maxIssues: 100 });
const report = { sha256: createHash('sha256').update(bytes).digest('hex'), ...validation };
writeFileSync(new URL('../../assets/model-validation.json', import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ errors: validation.issues.numErrors, warnings: validation.issues.numWarnings, infos: validation.issues.numInfos }));
process.exitCode = validation.issues.numErrors || validation.issues.numWarnings ? 1 : 0;
