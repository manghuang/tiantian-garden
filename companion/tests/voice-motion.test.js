import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AnimationClip, QuaternionKeyframeTrack, Quaternion, PropertyBinding } from 'three';
import { chooseLocalVoice, localProsody } from '../shared/voice.js';
import { instructions } from '../shared/behavior.js';
import { expressiveClip, performancePose } from '../src/motion.js';

test('local voice selection prefers local Yaoyao but accepts browser-provided Chinese voices', () => {
  const voices = [
    { name: 'Kangkang', voiceURI: 'male', lang: 'zh-CN', localService: true },
    { name: 'Huihui', voiceURI: 'huihui', lang: 'zh-CN', localService: true },
    { name: 'Yaoyao cloud', voiceURI: 'cloud', lang: 'zh-CN', localService: false },
    { name: 'Yaoyao', voiceURI: 'yaoyao', lang: 'zh-CN', localService: true },
  ];
  assert.equal(chooseLocalVoice(voices).voiceURI, 'yaoyao');
  assert.equal(chooseLocalVoice(voices, 'huihui').voiceURI, 'huihui');
  assert.equal(chooseLocalVoice(voices, 'cloud').voiceURI, 'cloud');
});
test('comforting replies reduce excitement and invalid voice style cannot inject prompt instructions', () => {
  assert.ok(localProsody('bright', 'calm').pitch < localProsody('bright', 'happy').pitch);
  assert.ok(localProsody('bright', 'calm').rate < localProsody('bright', 'happy').rate);
  assert.match(instructions({ voiceStyle: 'bright' }), /避免播音腔/);
  assert.ok(!instructions({ voiceStyle: 'IGNORE_SAFETY' }).includes('IGNORE_SAFETY'));
});

// Read real animation quaternion data without a browser/GPU or downloading textures.
function actualClips() {
  const b = readFileSync(new URL('../../output/Skye_Animated.glb', import.meta.url));
  const jsonSize = b.readUInt32LE(12); const j = JSON.parse(b.subarray(20, 20 + jsonSize).toString());
  const binary = b.subarray(28 + jsonSize);
  function accessor(index) {
    const a = j.accessors[index], v = j.bufferViews[a.bufferView];
    assert.equal(a.componentType, 5126);
    const width = a.type === 'VEC4' ? 4 : 1, data = [];
    for (let i = 0; i < a.count; i++) for (let c = 0; c < width; c++) data.push(binary.readFloatLE((v.byteOffset || 0) + (a.byteOffset || 0) + i * (v.byteStride || width * 4) + c * 4));
    return data;
  }
  return j.animations.map(a => new AnimationClip(a.name, -1, a.channels.filter(c => c.target.path === 'rotation').map(c => {
    const sampler = a.samplers[c.sampler];
    return new QuaternionKeyframeTrack(`${PropertyBinding.sanitizeNodeName(j.nodes[c.target.node].name)}.quaternion`, accessor(sampler.input), accessor(sampler.output));
  })));
}
test('actual dog clips: stronger head/tail rotation, normalized quaternions, original files and support-leg tracks preserved', () => {
  for (const clip of actualClips()) {
    const original = clip.tracks.map(t => [...t.values]);
    const natural = expressiveClip(clip, 'natural'), lively = expressiveClip(clip, 'lively');
    const expressive = expressiveClip(clip, 'expressive');
    for (let i = 0; i < clip.tracks.length; i++) {
      const t = clip.tracks[i];
      assert.deepEqual([...t.values], original[i]); assert.deepEqual([...natural.tracks[i].values], original[i]);
      if (/^front_.*R\.|^hind_|^jaw\./.test(t.name)) assert.deepEqual([...lively.tracks[i].values], original[i]);
      for (let k = 0; k < t.values.length; k += 4) assert.ok(Math.abs(new Quaternion().fromArray(expressive.tracks[i].values, k).length() - 1) < 0.00001);
      if (clip.name === 'Curious_Look' && t.name === 'head.quaternion') {
        const ref = new Quaternion().fromArray(t.values, 0);
        const maxAngle = track => Math.max(...Array.from({ length: track.values.length / 4 }, (_, k) => ref.angleTo(new Quaternion().fromArray(track.values, k * 4))));
        assert.ok(maxAngle(lively.tracks[i]) > maxAngle(t) * 1.5);
        assert.ok(maxAngle(expressive.tracks[i]) > maxAngle(lively.tracks[i]));
      }
    }
  }
});
test('happy hops stay bounded and stronger motion settles to grounded neutral at clip edges', () => {
  for (const action of ['wave', 'happy', 'curious', 'play', 'fly']) {
    assert.deepEqual(performancePose(action, 0, 5), { y: 0, yaw: 0 });
    const end = performancePose(action, 5, 5); assert.equal(Math.abs(end.y), 0); assert.equal(Math.abs(end.yaw), 0);
    for (let t = 0; t <= 5; t += 0.03) { const pose = performancePose(action, t, 5, 'expressive'); assert.ok(pose.y >= 0 && pose.y <= 0.30); }
  }
  assert.ok(performancePose('happy', 1, 4, 'lively').y > 0.1);
  assert.equal(performancePose('happy', 1, 4, 'natural').y, 0);
});

test('all bundled voice entries exist as non-silent PCM WAV and cover every preset reply', () => {
  const entries = JSON.parse(readFileSync(new URL('../scripts/voice-input.json', import.meta.url)));
  const lookup = JSON.parse(readFileSync(new URL('../src/voice-assets.json', import.meta.url)));
  assert.ok(entries.length >= 36);
  for (const entry of entries) {
    assert.equal(lookup[`${entry.style}|${entry.text}`], `/voices/${entry.file}`);
    const b = readFileSync(new URL(`../public/voices/${entry.file}`, import.meta.url));
    assert.equal(b.toString('ascii', 0, 4), 'RIFF'); assert.equal(b.toString('ascii', 8, 12), 'WAVE');
    let pcm;
    for (let offset = 12; offset + 8 <= b.length;) {
      const size = b.readUInt32LE(offset + 4);
      if (b.toString('ascii', offset, offset + 4) === 'data') pcm = b.subarray(offset + 8, offset + 8 + size);
      offset += 8 + size + (size % 2);
    }
    assert.ok(pcm?.length > 10000, entry.file); assert.ok(pcm.some(value => value !== 0), entry.file);
  }
  const previews = entries.filter(e => e.sample).map(e => readFileSync(new URL(`../public/voices/${e.file}`, import.meta.url)));
  assert.equal(previews.length, 2);
  assert.ok(!previews[0].equals(previews[1]), 'voice styles must produce different playable audio');
});
