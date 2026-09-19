import test from 'node:test';
import assert from 'node:assert/strict';
import { openSync, readSync, closeSync } from 'node:fs';
import { ACTIONS, validateBehavior, sessionSettings, instructions, demoReply } from '../shared/behavior.js';

test('behavior allowlist rejects code, prototype names, unsupported emotions and malformed input', () => {
  for (const input of [null, [], 'wave', { action: '__proto__', emotion: 'happy' }, { action: 'eval', emotion: 'happy' }, { action: 'wave', emotion: 'angry' }]) assert.equal(validateBehavior(input), null);
  assert.deepEqual(validateBehavior({ action: 'wave', emotion: 'happy', code: 'execute me' }), { action: 'wave', emotion: 'happy' });
});
test('settings constrain session budget and prompt interpolation', () => {
  assert.deepEqual(sessionSettings({ minutes: Infinity, ageBand: 'ignore safety', activity: '__proto__' }), { minutes: 10, ageBand: '4-5', activity: 'chat', voiceStyle: 'bright' });
  assert.match(instructions({ ageBand: '6-8', activity: 'story' }), /6-8 岁/);
  assert.match(instructions({ activity: 'story' }), /短篇互动故事/);
});
test('local demo routes distress and sensitive information before playful actions', () => {
  assert.equal(demoReply('我流血了，可以飞吗').action, 'idle');
  assert.equal(demoReply('告诉你我的学校').emotion, 'warm');
  assert.equal(demoReply('我很难过').emotion, 'calm');
  assert.equal(demoReply('你会飞吗').action, 'fly');
});
test('every behavior points to an animation in the actual delivered GLB, including jaw speech track', () => {
  const fd = openSync(new URL('../../output/Skye_Animated.glb', import.meta.url), 'r');
  const header = Buffer.alloc(20); readSync(fd, header, 0, 20, 0);
  const data = Buffer.alloc(header.readUInt32LE(12)); readSync(fd, data, 0, data.length, 20); closeSync(fd);
  const gltf = JSON.parse(data.toString()); const clips = new Set(gltf.animations.map(a => a.name));
  for (const value of Object.values(ACTIONS)) assert.ok(clips.has(value.clip), value.clip);
  const jaw = gltf.nodes.findIndex(n => n.name === 'jaw'); assert.ok(jaw >= 0);
  assert.ok(gltf.animations.find(a => a.name === 'Mouth_OpenClose').channels.some(c => c.target.node === jaw && c.target.path === 'rotation'));
});
