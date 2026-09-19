import { MathUtils, Quaternion } from 'three';

export const MOTION_LEVELS = { natural: 0, lively: 1, expressive: 1.45 };
export function motionLevel(value) { return Object.hasOwn(MOTION_LEVELS, value) ? value : 'lively'; }

// Amplify selected rotations around the original first-frame pose. Root/leg
// translations, grounding, eyelid shapes and jaw animation remain authored.
export function expressiveClip(source, level = 'lively') {
  const amount = MOTION_LEVELS[motionLevel(level)];
  const clip = source.clone();
  if (!amount || ['Idle_Breathe', 'Mouth_OpenClose'].includes(source.name)) return clip;
  const rest = new Quaternion(), pose = new Quaternion(), delta = new Quaternion(), identity = new Quaternion();
  for (const track of clip.tracks) {
    if (!track.name.endsWith('.quaternion')) continue;
    const bone = track.name.slice(0, -11);
    let extra = bone === 'head' ? 0.7 : bone === 'neck' ? 0.3 : bone.startsWith('tail_') ? 0.85 : bone.startsWith('ear_') ? 0.75 : 0;
    // The raised waving leg can have extra articulation; other support legs retain their baked IK.
    if (source.name === 'Hello_Wave' && /^front_(upper|lower|paw)L$/.test(bone)) extra = 0.17;
    if (!extra) continue;
    rest.fromArray(track.values, 0).normalize();
    for (let i = 0; i < track.values.length; i += 4) {
      pose.fromArray(track.values, i).normalize(); delta.copy(rest).invert().multiply(pose).normalize();
      if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w);
      const angle = identity.angleTo(delta);
      const gain = angle > 0.00001 ? Math.min(1 + extra * amount, Math.max(1, 1.25 / angle)) : 1;
      pose.copy(rest).multiply(identity.clone().slerp(delta, gain)).normalize().toArray(track.values, i);
    }
  }
  return clip;
}

export function performancePose(action, elapsed, duration, level = 'lively') {
  const amount = MOTION_LEVELS[motionLevel(level)];
  const t = MathUtils.clamp(elapsed, 0, duration);
  const ease = MathUtils.smoothstep(t, 0, 0.55) * (1 - MathUtils.smoothstep(t, duration - 0.65, duration));
  const pose = { y: 0, yaw: 0 };
  if (action === 'happy' || action === 'play') pose.y = amount * ease * 0.16 * Math.sin(t * Math.PI * 1.5) ** 2;
  if (action === 'wave') pose.y = amount * ease * 0.035 * Math.sin(t * Math.PI) ** 2;
  if (action === 'fly') pose.y = amount * ease * 0.20;
  if (['wave', 'happy', 'curious'].includes(action)) pose.yaw = amount * ease * Math.sin(t * 2) * 0.10;
  return pose;
}
