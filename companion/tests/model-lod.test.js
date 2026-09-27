import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { thinStrands } from '../scripts/model/model-lod.js';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const webBytes = readFileSync(new URL('../assets/dog-balanced.glb', import.meta.url));
const model = io.readBinary(webBytes);
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
  const web = await model;
  const triangles = value => value.getRoot().listNodes().reduce((sum, n) => sum + (n.getMesh()?.listPrimitives() || []).reduce((s, p) => s + p.getIndices().getCount() / 3, 0), 0);
  assert.ok(webBytes.length < 25 * 1024 * 1024);
  assert.ok(triangles(web) < 600000);
  const report = JSON.parse(readFileSync(new URL('../assets/model-report.json', import.meta.url)));
  assert.equal(report.optimizedTriangles, triangles(web));
  assert.equal(report.targetSha256, createHash('sha256').update(webBytes).digest('hex'));
  assert.equal(report.optimizedBytes, webBytes.length);
});

test('delivered animation channels target valid nodes with finite timing and key data', async () => {
  const root = (await model).getRoot();
  const nodes = new Set(root.listNodes().map(node => node.getName()));
  assert.ok(root.listAnimations().length >= 10);
  for (const animation of root.listAnimations()) {
    assert.ok(animation.listChannels().length > 0, animation.getName());
    for (const channel of animation.listChannels()) {
      assert.ok(nodes.has(channel.getTargetNode().getName()), `${animation.getName()}: ${channel.getTargetNode().getName()}`);
      const sampler = channel.getSampler();
      assert.ok(['LINEAR', 'STEP', 'CUBICSPLINE'].includes(sampler.getInterpolation()));
      assert.ok(sampler.getInput().getCount() > 0);
      assert.equal(sampler.getOutput().getCount() % sampler.getInput().getCount(), 0);
      assert.ok(sampler.getOutput().getCount() / sampler.getInput().getCount() <= 12);
      assert.ok([...sampler.getInput().getArray()].every(Number.isFinite));
      assert.ok([...sampler.getOutput().getArray()].every(Number.isFinite));
    }
  }
});

test('facial morph geometry, textures and skin weights in the delivered model are valid', async () => {
  const root = (await model).getRoot();
  assert.ok(root.listTextures().length >= 1);
  for (const node of root.listNodes()) {
    const primitives = node.getMesh()?.listPrimitives() || [];
    for (const p of primitives) {
      const count = p.getAttribute('POSITION').getCount();
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
      for (const target of p.listTargets()) for (const semantic of target.listSemantics()) {
        const attribute = target.getAttribute(semantic);
        assert.equal(attribute.getCount(), count);
        assert.ok([...attribute.getArray()].every(Number.isFinite));
      }
    }
  }
});
