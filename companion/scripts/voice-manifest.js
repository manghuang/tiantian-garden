import { createHash } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { demoReply } from '../shared/behavior.js';
import { VOICE_SAMPLE } from '../shared/voice.js';
import { activityReplies } from '../shared/activities.js';

const prompts = ['流血','学校','炸弹','难过','再见','飞','你好','跑','闻','走','开心','眨眼','故事','为什么','玩','兔','未知'];
const replies = [...new Map([...prompts.map(p => demoReply(p)), ...activityReplies(), { text: VOICE_SAMPLE, emotion: 'happy' }].map(r => [r.text, r])).values()];
const entries = [], lookup = {};
for (const style of ['bright', 'gentle']) for (const reply of replies) {
  const key = `${style}|${reply.text}`;
  const file = `${createHash('sha256').update(key).digest('hex').slice(0, 20)}.wav`;
  entries.push({ file, text: reply.text, style, calm: reply.emotion === 'calm', sample: reply.text === VOICE_SAMPLE }); lookup[key] = `/voices/${file}`;
}
mkdirSync(new URL('../public/voices/', import.meta.url), { recursive: true });
writeFileSync(new URL('./voice-input.json', import.meta.url), JSON.stringify(entries, null, 2));
writeFileSync(new URL('../src/voice-assets.json', import.meta.url), JSON.stringify(lookup, null, 2));
console.log(`Prepared ${entries.length} voice entries.`);
