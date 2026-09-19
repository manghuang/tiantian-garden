import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { compactPrimitive, prune } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { thinStrands } from './model-lod.js';

const source = new URL('../../output/Skye_Animated.glb', import.meta.url);
const target = new URL('../assets/dog-balanced.glb', import.meta.url);
const original = readFileSync(source);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const document = await io.readBinary(original);
const root = document.getRoot();
await MeshoptSimplifier.ready;
let before = 0, after = 0;
const meshes = [];
for (const node of root.listNodes()) {
  const mesh = node.getMesh(); if (!mesh) continue;
  const row = { name: node.getName(), before: 0, after: 0 };
  for (const primitive of mesh.listPrimitives()) {
    const position = primitive.getAttribute('POSITION');
    const originalIndices = primitive.getIndices();
    if (!originalIndices || primitive.getMode() !== 4) throw new Error('Expected indexed triangles');
    const indices = new Uint32Array(originalIndices.getArray());
    row.before += indices.length / 3;
    let result = indices;
    if (/Groom/.test(node.getName())) {
      const thinned = thinStrands(indices, position.getCount()); result = thinned.indices;
      row.strands = (row.strands || 0) + thinned.strands; row.retained = (row.retained || 0) + thinned.retained;
    } else if (!primitive.listTargets().length && indices.length > 3000 && !/Eye|Iris|Pupil|lid|lash|Mouth|Lip|Teeth|Tongue/i.test(node.getName())) {
      // Preserve blended skin vertices and normals. Keep original positions and
      // every surviving vertex's weights/UVs; only indices are simplified.
      const normal = primitive.getAttribute('NORMAL')?.getArray();
      const weights = primitive.getAttribute('WEIGHTS_0')?.getArray();
      const locked = new Uint8Array(position.getCount());
      if (weights) for (let v = 0; v < locked.length; v++) if (Array.from(weights.subarray(v * 4, v * 4 + 4)).filter(w => w > 0.001).length > 1) locked[v] = 1;
      if (normal) [result, row.error] = MeshoptSimplifier.simplifyWithAttributes(indices, position.getArray(), 3, normal, 3, [0.03, 0.03, 0.03], locked, Math.floor(indices.length * 0.3 / 3) * 3, 0.001, ['LockBorder']);
    }
    if (result.length !== indices.length) {
      primitive.setIndices(document.createAccessor().setType('SCALAR').setArray(result).setBuffer(root.listBuffers()[0]));
      compactPrimitive(primitive);
    }
    row.after += primitive.getIndices().getCount() / 3;
  }
  before += row.before; after += row.after; meshes.push(row);
}
// Only remove orphaned accessors/buffers, retaining original nodes and animation
// targets including joints that may not contribute to a particular pose.
await document.transform(prune({ propertyTypes: ['Accessor', 'Buffer'] }));
mkdirSync(new URL('../assets/', import.meta.url), { recursive: true });
const encoded = Buffer.from(await io.writeBinary(document));
// The exporter rounds near-identity transforms. Restore source TRS/matrices
// verbatim so skinned rest poses cannot drift relative to inverse bind matrices.
const sourceJSON = JSON.parse(original.subarray(20, 20 + original.readUInt32LE(12)));
const encodedJSON = JSON.parse(encoded.subarray(20, 20 + encoded.readUInt32LE(12)));
const originalNodes = new Map(sourceJSON.nodes.map(n => [n.name, n]));
if (originalNodes.size !== sourceJSON.nodes.length) throw new Error('Node names must be unique for transform preservation');
for (const node of encodedJSON.nodes) {
  const originalNode = originalNodes.get(node.name); if (!originalNode) throw new Error('Unexpected node added during optimization');
  for (const field of ['matrix', 'translation', 'rotation', 'scale']) {
    if (originalNode[field]) node[field] = originalNode[field]; else delete node[field];
  }
}
const jsonBytes = Buffer.from(JSON.stringify(encodedJSON));
const paddedJSON = Buffer.alloc(Math.ceil(jsonBytes.length / 4) * 4, 0x20); jsonBytes.copy(paddedJSON);
const binaryChunk = encoded.subarray(20 + encoded.readUInt32LE(12));
const output = Buffer.alloc(20 + paddedJSON.length + binaryChunk.length);
encoded.copy(output, 0, 0, 20); output.writeUInt32LE(output.length, 8); output.writeUInt32LE(paddedJSON.length, 12);
paddedJSON.copy(output, 20); binaryChunk.copy(output, 20 + paddedJSON.length);
writeFileSync(target, output);
const report = {
  source: 'output/Skye_Animated.glb', target: 'companion/assets/dog-balanced.glb',
  sourceSha256: createHash('sha256').update(original).digest('hex'),
  targetSha256: createHash('sha256').update(output).digest('hex'),
  originalBytes: original.length, optimizedBytes: output.length,
  originalTriangles: before, optimizedTriangles: after,
  animations: root.listAnimations().map(a => a.getName()),
  policy: 'Keep 8% complete groom strands; simplify non-facial rigid vertices with 0.1% error ceiling; preserve morph targets, blended skin vertices, animation channels and textures.',
  meshes,
};
writeFileSync(new URL('../assets/model-report.json', import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ file: fileURLToPath(target), bytes: output.length, triangles: after, reduction: `${(100 * (1 - output.length / original.length)).toFixed(1)}%` }));
