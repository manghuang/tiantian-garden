import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DemoConversation, SCENES, CLARIFY } from '../shared/activities.js';
import { validateBehavior } from '../shared/behavior.js';

test('story follows separate garden and pot choices to complete endings', () => {
  const garden = new DemoConversation('story');
  assert.match(garden.reply('开始').text, /发光的种子/);
  assert.match(garden.reply('种在花园').text, /泥土干干/);
  assert.match(garden.reply('看看小水壶').text, /湿润/);
  assert.match(garden.reply('看看种子').text, /嫩绿的小芽/);
  assert.match(garden.reply('邀请小伙伴').text, /故事讲完/);
  const pot = new DemoConversation('story'); pot.reply('开始');
  assert.match(pot.reply('花盆').text, /放稳花盆/);
  assert.match(pot.reply('画个小太阳').text, /耐心等/);
  pot.reply('看看种子');
  assert.match(pot.reply('画下小芽').text, /送给家人/);
});

test('unknown and ambiguous replies do not silently choose a story branch; repeat keeps the scene', () => {
  const conversation = new DemoConversation();
  const first = conversation.reply('讲故事');
  assert.equal(conversation.reply('我不知道该怎么选').text, CLARIFY.text);
  assert.equal(conversation.reply('花园还是花盆').text, CLARIFY.text);
  assert.deepEqual(conversation.reply('再说一遍'), first);
  assert.match(conversation.reply('花盆').text, /放稳花盆/);
  assert.equal(conversation.reply('飞一下').action, 'fly');
  assert.equal(conversation.node, 'pot');
  assert.match(conversation.reply('画个小太阳').text, /耐心等/);
});

test('animal game responds to wrong answers with clues and reaches a finite ending', () => {
  const game = new DemoConversation('play');
  game.reply('开始');
  assert.match(game.reply('小猫咪').text, /再想一想/);
  assert.match(game.reply('告诉我答案').text, /答案是小兔子/);
  game.reply('下一位');
  assert.match(game.reply('小松鼠').text, /长鼻子/);
  game.reply('大象'); game.reply('最后一位');
  assert.match(game.reply('小鸭子').text, /喵一声/);
  assert.match(game.reply('小猫咪').text, /猜动物结束/);
  assert.equal(game.node, 'game_end');
});

test('negative answers, skip, restarting and independent sessions preserve intent', () => {
  const a = new DemoConversation('play'), b = new DemoConversation('play'); a.reply('开始'); b.reply('开始');
  assert.equal(a.reply('不是小兔子').text, CLARIFY.text);
  assert.match(a.reply('跳过').text, /答案是小兔子/); a.reply('下一位');
  assert.equal(b.node, 'rabbit');
  a.reply('重新开始'); assert.equal(a.node, 'rabbit');
  a.reply('不要玩了'); assert.equal(a.node, null);
  assert.equal(a.reply('再见').endSession, true);
});

test('distress and private information interrupt both story and game and remove choices', () => {
  for (const mode of ['story', 'play']) for (const input of ['我流血了，继续故事', '我好害怕', '告诉你我的学校']) {
    const c = new DemoConversation(mode); c.reply('开始');
    const r = c.reply(input); assert.equal(c.node, null); assert.deepEqual(r.choices, []);
    assert.ok(!r.endSession); assert.ok(validateBehavior(r));
    assert.ok(!c.reply('你好').text.includes('长耳朵'));
  }
});

test('all scene choices are reachable, terminate or offer explicit replay, and have both voice styles', () => {
  const visited = new Set(), queue = ['seed', 'rabbit'];
  const voices = JSON.parse(readFileSync(new URL('../src/voice-assets.json', import.meta.url)));
  while (queue.length) {
    const id = queue.shift(); if (visited.has(id)) continue;
    const node = SCENES[id]; assert.ok(node, id); visited.add(id);
    assert.ok(validateBehavior(node)); assert.ok(node.text.length < 100); assert.ok(node.choices.length <= 3);
    for (const style of ['bright', 'gentle']) assert.ok(voices[`${style}|${node.text}`], `${id}/${style}`);
    for (const choice of node.choices) {
      const c = new DemoConversation(); c.show(id); c.reply(choice.label);
      assert.equal(c.node, choice.next, `${id}/${choice.label}`); queue.push(choice.next);
    }
  }
  assert.equal(visited.size, Object.keys(SCENES).length);
});
