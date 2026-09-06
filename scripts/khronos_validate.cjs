const fs = require('node:fs');
const path = require('node:path');
const validator = require('../.tools/validation/node_modules/gltf-validator');
const output = path.resolve(__dirname, '../output');
const filename = path.join(output, 'Skye_Animated.glb');
validator.validateBytes(new Uint8Array(fs.readFileSync(filename)), {
  uri: 'Skye_Animated.glb',
  maxIssues: 300,
}).then(report => {
  fs.writeFileSync(path.join(output, 'khronos_validation.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({errors:report.issues.numErrors, warnings:report.issues.numWarnings, infos:report.issues.numInfos, messages:report.issues.messages.slice(0,12)},null,2));
  process.exitCode = report.issues.numErrors ? 1 : 0;
}).catch(e => { console.error(e); process.exitCode = 1; });
