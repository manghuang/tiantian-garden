import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MeshoptEncoder } from 'meshoptimizer';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, prune } from '@gltf-transform/functions';

const source = new URL('../../../output/Skye_Refined_v48/export/Skye_Refined_v48_r2.glb', import.meta.url);
const target = new URL('../../assets/dog-v48.glb', import.meta.url);
const original = readFileSync(source);
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
await MeshoptEncoder.ready;
const document = await io.readBinary(original);
const root = document.getRoot();
const animations = root.listAnimations().map(animation => animation.getName());
if (animations.length !== 22 || animations.includes('Look_Around')) {
  throw new Error(`Expected 22 exportable v48 clips; found ${animations.length}`);
}
const triangles = root.listMeshes().flatMap(mesh => mesh.listPrimitives()).reduce((sum, primitive) => sum + (primitive.getIndices()?.getCount() || 0) / 3, 0);

// Quantize and encode geometry and animation buffers without simplifying the mesh.
// Every morph target and each GLB-exportable action clip remain in the output.
await document.transform(meshopt({ encoder: MeshoptEncoder, level: 'high' }));
await document.transform(prune({ propertyTypes: ['Accessor', 'Buffer'] }));
const output = Buffer.from(await io.writeBinary(document));
writeFileSync(target, output);

const report = {
  source: 'output/Skye_Refined_v48/export/Skye_Refined_v48_r2.glb',
  target: 'companion/assets/dog-v48.glb',
  sourceSha256: createHash('sha256').update(original).digest('hex'),
  targetSha256: createHash('sha256').update(output).digest('hex'),
  sourceBytes: original.length,
  targetBytes: output.length,
  triangleCount: triangles,
  animations,
  omittedSourceAction: { name: 'Look_Around', reason: 'The Blender action animates custom rig properties, which the glTF exporter does not emit as morph or bone tracks.' },
  compression: 'EXT_meshopt_compression with 14-bit positions, 12-bit UVs, quantized normals and weights; no mesh simplification',
  exportPolicy: 'Blender glTF export retains the four highest joint influences per vertex and normalizes their weights.',
};
writeFileSync(new URL('../../assets/model-v48-report.json', import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ file: fileURLToPath(target), sourceBytes: original.length, bytes: output.length, triangles, animations: animations.length }));
