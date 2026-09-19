import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { thinStrands } from '../scripts/model-lod.js';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sourceBytes = readFileSync(new URL('../../output/Skye_Animated.glb', import.meta.url));
const webBytes = readFileSync(new URL('../assets/dog-balanced.glb', import.meta.url));
const models = Promise.all([io.readBinary(sourceBytes), io.readBinary(webBytes)]);
function arrayEqual(a, b, label) {
  assert.equal(a.constructor.name, b.constructor.name, label);
  assert.equal(a.length, b.length, label);
  assert.ok(Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength)), label);
}

test('strand thinning is deterministic and keeps complete connected strands', () => {
  const indices = new Uint32Array(Array.from({ length: 1000 }, (_, s) => [s * 4, s * 4 + 1, s * 4 + 2, s * 4, s * 4 + 2, s * 4 + 3]).flat());
  const a = thinStrands(indices, 4000), b = thinStrands(indices, 4000);
  assert.equal(a.strands, 1000); assert.equal(a.retained, 80);
  assert.deepEqual(a.indices, b.indices); assert.equal(a.indices.length, 80 * 6);
  const counts = new Map();
  for (const index of a.indices) counts.set(Math.floor(index / 4), (counts.get(Math.floor(index / 4)) || 0) + 1);
  assert.ok([...counts.values()].every(n => n === 6));
  assert.throws(() => thinStrands(new Uint32Array([0, 1, 2]), 3));
});

test('delivered model meets download/geometry budgets and its report matches the actual files', async () => {
  const [source, web] = await models;
  const triangles = model => model.getRoot().listNodes().reduce((sum, n) => sum + (n.getMesh()?.listPrimitives() || []).reduce((s, p) => s + p.getIndices().getCount() / 3, 0), 0);
  assert.ok(webBytes.length < 25 * 1024 * 1024);
  assert.ok(triangles(web) < 600000); assert.ok(triangles(web) < triangles(source) * 0.25);
  const report = JSON.parse(readFileSync(new URL('../assets/model-report.json', import.meta.url)));
  assert.equal(report.optimizedTriangles, triangles(web));
  assert.equal(report.targetSha256, createHash('sha256').update(webBytes).digest('hex'));
  assert.equal(report.sourceSha256, createHash('sha256').update(sourceBytes).digest('hex'));
});

test('all animation channels, timings, bone bindings and node transforms survive LOD unchanged', async () => {
  const [source, web] = await models;
  const a = source.getRoot(), b = web.getRoot();
  assert.equal(a.listNodes().length, b.listNodes().length);
  const nodes = new Map(b.listNodes().map(n => [n.getName(), n]));
  for (const node of a.listNodes()) {
    const other = nodes.get(node.getName()); assert.ok(other, node.getName());
    assert.deepEqual(other.getMatrix(), node.getMatrix(), node.getName());
    assert.deepEqual(other.listChildren().map(n => n.getName()), node.listChildren().map(n => n.getName()));
    if (node.getSkin()) {
      assert.deepEqual(other.getSkin().listJoints().map(n => n.getName()), node.getSkin().listJoints().map(n => n.getName()));
      arrayEqual(other.getSkin().getInverseBindMatrices().getArray(), node.getSkin().getInverseBindMatrices().getArray(), 'inverse bind');
    }
  }
  assert.deepEqual(b.listAnimations().map(a => a.getName()), a.listAnimations().map(a => a.getName()));
  for (let i = 0; i < a.listAnimations().length; i++) {
    const before = a.listAnimations()[i].listChannels(), after = b.listAnimations()[i].listChannels();
    assert.equal(before.length, after.length);
    for (let j = 0; j < before.length; j++) {
      assert.equal(after[j].getTargetNode().getName(), before[j].getTargetNode().getName());
      assert.equal(after[j].getTargetPath(), before[j].getTargetPath());
      const x = before[j].getSampler(), y = after[j].getSampler();
      assert.equal(x.getInterpolation(), y.getInterpolation());
      arrayEqual(x.getInput().getArray(), y.getInput().getArray(), 'animation time');
      arrayEqual(x.getOutput().getArray(), y.getOutput().getArray(), 'animation key');
    }
  }
});

test('facial morph geometry is preserved and all optimized attributes and skin weights are valid', async () => {
  const [source, web] = await models;
  const before = new Map(source.getRoot().listNodes().map(n => [n.getName(), n]));
  const textures = new Map(source.getRoot().listTextures().map(t => [t.getName(), t]));
  assert.equal(web.getRoot().listTextures().length, textures.size);
  for (const texture of web.getRoot().listTextures()) arrayEqual(texture.getImage(), textures.get(texture.getName()).getImage(), texture.getName());
  for (const node of web.getRoot().listNodes()) {
    const primitives = node.getMesh()?.listPrimitives() || [];
    for (let i = 0; i < primitives.length; i++) {
      const p = primitives[i], count = p.getAttribute('POSITION').getCount();
      assert.ok([...p.getIndices().getArray()].every(index => index < count));
      for (const attribute of p.listAttributes()) {
        assert.equal(attribute.getCount(), count);
        assert.ok(attribute.getArray().every(Number.isFinite));
      }
      if (node.getSkin()) {
        const joints = p.getAttribute('JOINTS_0').getArray(), weights = p.getAttribute('WEIGHTS_0').getArray();
        assert.ok(joints.every(index => index < node.getSkin().listJoints().length));
        for (let v = 0; v < weights.length; v += 4) assert.ok(Math.abs(weights[v] + weights[v + 1] + weights[v + 2] + weights[v + 3] - 1) < 0.00001);
      }
      const original = before.get(node.getName()).getMesh().listPrimitives()[i];
      assert.equal(p.listTargets().length, original.listTargets().length);
      if (p.listTargets().length) {
        arrayEqual(p.getIndices().getArray(), original.getIndices().getArray(), 'facial indices');
        for (const semantic of p.listSemantics()) arrayEqual(p.getAttribute(semantic).getArray(), original.getAttribute(semantic).getArray(), semantic);
        for (let t = 0; t < p.listTargets().length; t++) for (const semantic of p.listTargets()[t].listSemantics()) arrayEqual(p.listTargets()[t].getAttribute(semantic).getArray(), original.listTargets()[t].getAttribute(semantic).getArray(), 'morph ' + semantic);
      }
    }
  }
});
