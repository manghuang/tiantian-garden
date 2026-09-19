import { demoReply, safetyReply } from './behavior.js';

const option = (label, next, ...words) => ({ label, next, words: [label, ...words] });
const scene = (text, choices = [], action = 'curious', emotion = 'warm') => ({ text, choices, action, emotion });
export const SCENES = {
  seed: scene('小兔子找到一颗发光的种子。它想给种子安个家。你想选花园，还是窗边的花盆？', [option('种在花园', 'garden', '花园'), option('种在花盆', 'pot', '花盆', '窗边')]),
  garden: scene('种子住进了花园。小兔子发现泥土干干的。我们给它浇一点水，还是先看看小水壶？', [option('浇一点水', 'sprout', '浇水', '浇一点'), option('看看小水壶', 'watering', '水壶')]),
  pot: scene('种子住进了窗边的花盆。小兔子请大人帮忙放稳花盆。我们先浇一点水，还是给花盆画个标记？', [option('浇一点水', 'sprout', '浇水', '浇一点'), option('画个小太阳', 'drawing', '画', '太阳', '标记')]),
  watering: scene('小水壶里有清清的水。小兔子慢慢浇了一点，让泥土湿润。过了几天，会发生什么呢？', [option('看看种子', 'sprout', '种子', '继续')]),
  drawing: scene('花盆上多了一个笑眯眯的小太阳。小兔子照顾种子，耐心等了几天。要看看它的变化吗？', [option('看看种子', 'sprout', '种子', '继续', '好')]),
  sprout: scene('一片嫩绿的小芽探出了头！小兔子真开心。它想邀请小伙伴来看，还是画下小芽的样子？', [option('邀请小伙伴', 'friends', '朋友', '小伙伴', '邀请'), option('画下小芽', 'picture', '画', '小芽')], 'happy', 'happy'),
  friends: scene('小伙伴们围着小芽，轻声说你好。小兔子发现，分享一件小小的开心事，也能让大家笑起来。故事讲完啦。', [option('再听一次', 'seed'), option('猜动物', 'rabbit')], 'wave'),
  picture: scene('小兔子画下小芽，把画送给家人。它记住了等待和照顾的时光。发光种子的故事讲完啦。', [option('再听一次', 'seed'), option('猜动物', 'rabbit')], 'wave'),
  rabbit: { ...scene('来猜第一位动物朋友：长耳朵，短尾巴，喜欢蹦蹦跳。它是谁？', [option('小兔子', 'rabbit_ok', '兔'), option('小猫咪', 'rabbit_hint', '猫'), option('给我提示', 'rabbit_hint', '提示')], 'play', 'happy'), skip: 'rabbit_ok' },
  rabbit_hint: { ...scene('再想一想，它有两只长长的耳朵。可以选小兔子，也可以让我告诉你答案。', [option('小兔子', 'rabbit_ok', '兔'), option('告诉我答案', 'rabbit_ok', '答案')]), skip: 'rabbit_ok' },
  rabbit_ok: scene('答案是小兔子！长耳朵和蹦蹦跳是这道题的线索。要认识下一位动物朋友吗？', [option('下一位', 'elephant', '继续', '好')], 'happy', 'happy'),
  elephant: { ...scene('第二位朋友有大耳朵，还有一条长长的鼻子。它是谁？', [option('大象', 'elephant_ok', '象'), option('小松鼠', 'elephant_hint', '松鼠'), option('给我提示', 'elephant_hint', '提示')], 'curious', 'curious'), skip: 'elephant_ok' },
  elephant_hint: { ...scene('它能用长鼻子卷起食物。你想选大象，还是听我说答案？', [option('大象', 'elephant_ok', '象'), option('告诉我答案', 'elephant_ok', '答案')]), skip: 'elephant_ok' },
  elephant_ok: scene('答案是大象！它的鼻子能帮助它取水和拿食物。还有最后一位朋友。', [option('最后一位', 'cat', '下一', '继续', '好')], 'happy', 'happy'),
  cat: { ...scene('最后一位朋友会喵喵叫，脚下有软软的肉垫。它是谁？', [option('小猫咪', 'game_end', '猫'), option('小鸭子', 'cat_hint', '鸭'), option('给我提示', 'cat_hint', '提示')], 'play', 'happy'), skip: 'game_end' },
  cat_hint: { ...scene('它会轻轻地喵一声。你想选小猫咪，还是让我告诉你答案？', [option('小猫咪', 'game_end', '猫'), option('告诉我答案', 'game_end', '答案')]), skip: 'game_end' },
  game_end: scene('答案是小猫咪！我们认识了兔子、大象和小猫。今天的猜动物结束啦，给眼睛和耳朵休息一下吧。', [option('听种子的故事', 'seed', '故事')], 'wave'),
};
export const CLARIFY = scene('我还没明白你选的是哪一个。可以点下面的选项，或者让我再说一遍。');
export const DECLINE = scene('好呀，我们停下来。你可以聊点别的，也可以休息一下。', [], 'idle');

export function activityReplies() { return [...Object.values(SCENES), CLARIFY, DECLINE]; }

// A finite, local demo: no model claims, scores, personal profiles or persistence.
export class DemoConversation {
  constructor(activity = 'chat') { this.activity = activity; this.node = null; this.last = null; }
  show(id) {
    this.node = id; this.last = this.result(SCENES[id]); return this.last;
  }
  result(reply) { return { text: reply.text, action: reply.action, emotion: reply.emotion, choices: (reply.choices || []).map(c => c.label) }; }
  reply(input) {
    const text = String(input).trim().slice(0, 500);
    const safe = safetyReply(text);
    if (safe) { this.node = null; this.activity = 'chat'; return this.last = this.result(safe); }
    if (/再见|拜拜|休息|结束互动/.test(text)) { this.node = null; return { ...this.result(demoReply('再见')), endSession: true }; }
    if (/不想|不要|不玩|不听|停止/.test(text)) { this.node = null; this.activity = 'chat'; return this.last = this.result(DECLINE); }
    if (/再说|重复|没听清/.test(text) && this.last) return this.last;
    if (/从头|重新开始/.test(text) && this.node) return this.show(['seed', 'garden', 'pot', 'watering', 'drawing', 'sprout', 'friends', 'picture'].includes(this.node) ? 'seed' : 'rabbit');
    if (this.node) {
      const current = SCENES[this.node];
      if (/跳过|不会|不知道|答案/.test(text) && current.skip) return this.show(current.skip);
      const matched = current.choices.filter(c => c.words.some(word => text.includes(word)));
      if (matched.length === 1 && !/不是|不选/.test(text)) return this.show(matched[0].next);
      if (/故事/.test(text)) return this.show('seed');
      if (/猜动物|玩游戏/.test(text)) return this.show('rabbit');
      if (/飞|翅膀|招手|摇尾|跑|走|闻|嗅|眨眼/.test(text)) return { ...this.result(demoReply(text)), choices: this.result(current).choices };
      return { ...this.result(CLARIFY), choices: this.result(current).choices };
    }
    if (/故事|种子/.test(text) || this.activity === 'story') return this.show('seed');
    if (/猜|玩/.test(text) || this.activity === 'play') return this.show('rabbit');
    return this.last = this.result(demoReply(text, this.activity));
  }
}
