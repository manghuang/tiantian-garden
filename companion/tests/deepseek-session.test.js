import test from 'node:test';
import assert from 'node:assert/strict';
import { DeepSeekSession } from '../shared/deepseek-session.js';
import { SpeechSegmenter } from '../shared/speech-segmenter.js';
import { cloudflareMeloTTSReady, cloudflareTTSConfigError, cloudflareTTSReady, deepseekSpeech, pcmWav, speechCloudflareMeloTTS, speechCloudflarePCM, speechPCM, transcribePCM } from '../shared/speech-services.js';
import { sessionSettings } from '../shared/behavior.js';

const answer = text => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ text, action: 'wave', emotion: 'warm' }) } }] });
const audio = (value = 1000) => { const samples = new Int16Array(2400); samples.fill(value); return new Uint8Array(samples.buffer); };
function wavFixture(sampleRate = 12000, frames = 2400) {
  const bytes = new Uint8Array(44 + frames * 2); const view = new DataView(bytes.buffer); const ascii = (offset, text) => [...text].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  ascii(0, 'RIFF'); view.setUint32(4, 36 + frames * 2, true); ascii(8, 'WAVE'); ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); ascii(36, 'data'); view.setUint32(40, frames * 2, true);
  for (let i = 0; i < frames; i++) view.setInt16(44 + i * 2, i % 2 ? 1000 : -1000, true);
  return bytes;
}
async function until(predicate) {
  const deadline = Date.now() + 2000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error('Test response timed out'); await new Promise(r => setImmediate(r)); }
}
function fixture(fetcher = async () => answer('你好，一起来玩吧！'), extra = {}) {
  const events = []; let time = 100000, closed = 0;
  const session = new DeepSeekSession({ env: { DEEPSEEK_API_KEY: 'test-deepseek', DEEPSEEK_TTS: 'local', ...extra }, settings: sessionSettings(),
    emit: event => events.push(event), close: () => closed++, fetcher, now: () => time });
  return { session, events, closed: () => closed, advance(ms = 100) { time += ms; },
    send(event) { session.client(JSON.stringify(event)); }, done: () => !session.job };
}

test('speech segmentation ignores brief noise, preserves onset and ends after silence', () => {
  const started = [], ended = []; const segmenter = new SpeechSegmenter({ onStart: () => started.push(true), onEnd: pcm => ended.push(pcm), onLimit: () => assert.fail('unexpected limit') });
  segmenter.append(audio()); segmenter.append(audio(0)); assert.equal(started.length, 0);
  segmenter.append(audio()); segmenter.append(audio()); assert.equal(started.length, 1);
  for (let i = 0; i < 10; i++) segmenter.append(audio(0)); assert.equal(ended.length, 0);
  segmenter.append(audio(0)); assert.equal(ended.length, 1); assert.equal(ended[0].length, 14 * 4800);
  assert.ok(new DataView(ended[0].buffer).getInt16(4800, true) > 0);
  assert.equal(segmenter.recording, false);
});

test('speech segmentation flushes an active utterance without waiting for silence', () => {
  const ended = []; const segmenter = new SpeechSegmenter({ onStart() {}, onEnd: pcm => ended.push(pcm), onLimit: () => assert.fail('unexpected limit') });
  segmenter.append(audio()); segmenter.append(audio()); segmenter.append(audio());
  assert.equal(ended.length, 0); assert.equal(segmenter.flush(), true); assert.equal(ended.length, 1); assert.equal(ended[0].length, 3 * 4800);
  assert.equal(segmenter.recording, false);
});

test('overlong speech is discarded until a pause and reset forgets partial input', () => {
  let limits = 0, ended = 0; const segmenter = new SpeechSegmenter({ onStart() {}, onEnd() { ended++; }, onLimit() { limits++; } });
  for (let i = 0; i < 220; i++) segmenter.append(audio());
  assert.equal(limits, 1); assert.equal(segmenter.chunks.length, 0); assert.equal(ended, 0);
  for (let i = 0; i < 11; i++) segmenter.append(audio(0));
  segmenter.append(audio()); segmenter.append(audio()); segmenter.reset();
  for (let i = 0; i < 11; i++) segmenter.append(audio(0)); assert.equal(ended, 0);
  segmenter.append(audio()); segmenter.append(audio());
  for (let i = 0; i < 11; i++) segmenter.append(audio(0)); assert.equal(ended, 1);
});

test('ASR sends a valid bounded WAV; TTS reconstructs split samples without byte loss', async () => {
  const pcm = audio(), wav = pcmWav(pcm), view = new DataView(wav.buffer);
  assert.equal(new TextDecoder().decode(wav.slice(0, 4)), 'RIFF'); assert.equal(view.getUint32(24, true), 24000);
  assert.equal(view.getUint16(22, true), 1); assert.equal(view.getUint32(40, true), pcm.length); assert.deepEqual(wav.slice(44), pcm);
  assert.throws(() => pcmWav(new Uint8Array(3))); assert.throws(() => pcmWav(new Uint8Array(960002)));
  const text = await transcribePCM({ env: { OPENAI_API_KEY: 'test-speech' }, pcm, fetcher: async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/audio/transcriptions'); assert.equal(options.headers.Authorization, 'Bearer test-speech');
    assert.equal(options.body.get('language'), 'zh'); assert.equal(options.body.get('file').size, 4844); return Response.json({ text: ' 你好 ' });
  } }); assert.equal(text, '你好');
  const chunks = [];
  for await (const bytes of speechPCM({ env: { OPENAI_API_KEY: 'test-speech', OPENAI_CUSTOM_VOICE_ID: 'voice_test' }, text, fetcher: async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/audio/speech'); const body = JSON.parse(options.body);
    assert.deepEqual(body.voice, { id: 'voice_test' }); assert.equal(body.response_format, 'pcm');
    return new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1, 2, 3])); c.enqueue(new Uint8Array([4])); c.enqueue(new Uint8Array([5, 6])); c.close(); } }));
  } })) { assert.equal(bytes.length % 2, 0); chunks.push(...bytes); }
  assert.deepEqual(chunks, [1, 2, 3, 4, 5, 6]);
});

test('Cloudflare MiniMax TTS selects the configured custom voice and normalizes WAV to 24 kHz PCM', async () => {
  const calls = []; const env = { DEEPSEEK_TTS: 'cloudflare-minimax', CLOUDFLARE_TTS_MODEL: 'minimax/speech-2.8-turbo', CLOUDFLARE_TTS_VOICE_ID: 'tiantian-custom-voice', AI: { run: async (model, input) => { calls.push({ model, input }); return { state: 'Completed', result: { audio: 'https://audio.example/tiantian.wav' } }; } } };
  assert.equal(deepseekSpeech(env).tts, 'cloudflare-minimax'); assert.equal(deepseekSpeech(env).ttsReady, true); assert.equal(cloudflareTTSReady(env), true);
  const chunks = [];
  for await (const bytes of speechCloudflarePCM({ env, text: '你好，我是天天。', style: 'gentle', fetcher: async (url, options) => { assert.equal(url, 'https://audio.example/tiantian.wav'); assert.ok(options.signal); return new Response(wavFixture(), { headers: { 'content-type': 'audio/wav' } }); } })) chunks.push(bytes);
  assert.equal(calls.length, 1); assert.equal(calls[0].model, 'minimax/speech-2.8-turbo'); assert.equal(calls[0].input.voice_id, 'tiantian-custom-voice'); assert.equal(calls[0].input.format, 'wav'); assert.equal(calls[0].input.emotion, 'calm'); assert.equal(calls[0].input.speed, 0.93);
  assert.equal(chunks.reduce((sum, bytes) => sum + bytes.length, 0), 9600); assert.ok(chunks.every(bytes => bytes.length % 2 === 0)); assert.ok(new Int16Array(chunks[0].buffer, chunks[0].byteOffset, chunks[0].byteLength / 2).some(value => value !== 0));
});

test('Cloudflare MiniMax TTS fails closed until a voice id is configured', () => {
  const env = { DEEPSEEK_TTS: 'cloudflare-minimax', AI: { run() {} } };
  assert.equal(deepseekSpeech(env).tts, 'cloudflare-minimax'); assert.equal(deepseekSpeech(env).ttsReady, false); assert.equal(cloudflareTTSReady(env), false); assert.match(cloudflareTTSConfigError(env), /CLOUDFLARE_TTS_VOICE_ID/);
});

test('Cloudflare MeloTTS uses the Chinese model and streams bounded MP3 chunks without a voice id', async () => {
  const calls = []; const source = new Uint8Array(48001); source.fill(7);
  const env = { DEEPSEEK_TTS: 'cloudflare-melotts', CLOUDFLARE_MELOTTS_LANG: 'zh', AI: { run: async (model, input, options) => {
    calls.push({ model, input, options }); return new Response(source, { headers: { 'content-type': 'audio/mpeg' } });
  } } };
  assert.equal(deepseekSpeech(env).tts, 'cloudflare-melotts'); assert.equal(deepseekSpeech(env).ttsReady, true); assert.equal(cloudflareMeloTTSReady(env), true);
  const chunks = [];
  for await (const bytes of speechCloudflareMeloTTS({ env, text: '你好，我是天天。', style: 'bright' })) chunks.push(bytes);
  assert.equal(calls.length, 1); assert.equal(calls[0].model, '@cf/myshell-ai/melotts');
  assert.deepEqual(calls[0].input, { prompt: '你好，我是天天。', lang: 'zh' }); assert.equal(calls[0].options.returnRawResponse, true);
  assert.deepEqual(chunks.map(bytes => bytes.length), [24000, 24000, 1]); assert.equal(chunks.reduce((sum, bytes) => sum + bytes.length, 0), source.length);
});

test('Cloudflare MeloTTS fails closed when the AI binding is missing', () => {
  const env = { DEEPSEEK_TTS: 'cloudflare-melotts' };
  assert.equal(deepseekSpeech(env).tts, 'cloudflare-melotts'); assert.equal(deepseekSpeech(env).ttsReady, false); assert.equal(cloudflareMeloTTSReady(env), false);
  assert.match(cloudflareTTSConfigError(env), /AI.*绑定/);
});

test('DeepSeek session emits MeloTTS MP3 events and style playback metadata', async () => {
  const mp3 = new Uint8Array([1, 2, 3, 4]); let ttsCalls = 0;
  const f = fixture(async url => { assert.equal(url, 'https://api.deepseek.com/chat/completions'); return answer('彩虹是阳光和水滴一起变出来的。'); }, {
    DEEPSEEK_TTS: 'cloudflare-melotts', AI: { run: async (model, input, options) => {
      ttsCalls++; assert.equal(model, '@cf/myshell-ai/melotts'); assert.equal(input.lang, 'zh'); assert.equal(options.returnRawResponse, true);
      return new Response(mp3, { headers: { 'content-type': 'audio/mpeg' } });
    } },
  });
  f.send({ type: 'text', text: '请讲讲彩虹为什么有颜色？' }); await until(f.done);
  const delta = f.events.find(e => e.type === 'response.output_audio.delta'); const finished = f.events.find(e => e.type === 'response.output_audio.done');
  assert.equal(ttsCalls, 1); assert.equal(delta.audio_format, 'audio/mpeg'); assert.deepEqual([...Buffer.from(delta.delta, 'base64')], [...mp3]);
  assert.equal(finished.audio_format, 'audio/mpeg'); assert.equal(finished.playback_rate, 1.04); assert.equal(f.events.at(-1).response.status, 'completed');
  f.session.dispose();
});

test('MeloTTS outage preserves text history and explicitly requests local speech on every turn', async () => {
  const requests = [];
  const f = fixture(async (_url, options) => { requests.push(JSON.parse(options.body)); return answer('你好，一起来玩吧！'); }, { DEEPSEEK_TTS: 'cloudflare-melotts', AI: { run: async () => new Response('private error', { status: 500 }) } });
  await f.session.run({ text: '你好' });
  assert.equal(f.events.at(-1).response.status, 'completed');
  assert.ok(f.events.some(e => e.type === 'garden.speech_fallback' && e.transcript === '你好，一起来玩吧！'));
  assert.ok(f.events.some(e => e.type === 'garden.notice'));
  await f.session.run({ text: '刚才说什么？' });
  assert.ok(requests[1].messages.some(m => m.role === 'assistant' && m.content.includes('一起来玩')));
  assert.equal(f.events.at(-1).response.status, 'completed');
  assert.ok(!JSON.stringify(f.events).includes('private error')); f.session.dispose();
});

test('MiniMax TTS outage preserves text history and explicitly requests local speech', async () => {
  const f = fixture(async () => answer('你好，天天在这里！'), {
    DEEPSEEK_TTS: 'cloudflare-minimax', CLOUDFLARE_TTS_VOICE_ID: 'Chinese (Mandarin)_Cute_Spirit',
    AI: { run: async () => new Response('provider unavailable', { status: 503 }) },
  });
  f.send({ type: 'text', text: '你好' }); await until(f.done);
  assert.equal(f.events.at(-1).response.status, 'completed');
  assert.ok(f.events.some(e => e.type === 'garden.speech_fallback' && e.transcript === '你好，天天在这里！'));
  assert.ok(f.events.some(e => e.type === 'garden.notice' && e.message.includes('MiniMax')));
  f.session.dispose();
});

test('speech adapters reject incomplete, oversized and private upstream error bodies', async () => {
  await assert.rejects(transcribePCM({ env: {}, pcm: audio(), fetcher: async () => Response.json({ text: 'x'.repeat(501) }) }));
  for (const response of [new Response(new Uint8Array(3)), new Response(new Uint8Array(1440002)), Response.json({ error: 'private' }), new Response('secret body', { status: 401 })]) {
    await assert.rejects(async () => { for await (const _ of speechPCM({ env: {}, text: '你好', fetcher: async () => response })) {} }, error => !error.message.includes('secret body'));
  }
});

test('Cloudflare ASR uses a bounded Chinese WAV and cancellation discards a late result', async () => {
  const abort = new AbortController(); let finish;
  const env = { DEEPSEEK_ASR: 'cloudflare', AI: { run: async (model, input) => {
    assert.equal(model, '@cf/openai/whisper-large-v3-turbo'); assert.equal(input.language, 'zh');
    assert.equal(input.condition_on_previous_text, false);
    const bytes = Buffer.from(input.audio, 'base64'); assert.equal(bytes.toString('ascii', 0, 4), 'RIFF'); assert.equal(bytes.readUInt32LE(24), 24000);
    return new Promise(resolve => { finish = resolve; });
  } } };
  const pending = transcribePCM({ env, pcm: audio(), signal: abort.signal, fetcher: () => assert.fail('OpenAI must not receive this audio') });
  abort.abort(); await assert.rejects(pending, e => e.name === 'AbortError'); finish({ text: '晚到的结果' });
  for (const result of [{ text: '' }, { text: 'x'.repeat(501) }, { error: 'private detail' }]) {
    await assert.rejects(transcribePCM({ env: { ...env, AI: { run: async () => result } }, pcm: audio() }), e => !e.message.includes('private detail'));
  }
});

test('Cloudflare speech input drives DeepSeek without requesting OpenAI speech output', async () => {
  const calls = [];
  const f = fixture(async (url, options) => { calls.push(url); assert.equal(JSON.parse(options.body).messages.at(-1).content, '为什么会有彩虹？'); return answer('小水滴会把阳光分成不同颜色。'); },
    { DEEPSEEK_ASR: 'cloudflare', AI: { run: async () => ({ text: ' 为什么会有彩虹？ ' }) } });
  assert.equal(f.session.audioInput, true); assert.equal(f.session.audio, false);
  for (let i = 0; i < 14; i++) f.send({ type: 'audio', audio: Buffer.from(audio(i < 3 ? 1000 : 0)).toString('base64') });
  await until(f.done);
  assert.deepEqual(calls, ['https://api.deepseek.com/chat/completions']);
  assert.ok(f.events.some(e => e.type === 'conversation.item.input_audio_transcription.completed' && e.transcript === '为什么会有彩虹？'));
  assert.ok(f.events.some(e => e.type === 'response.output_audio_transcript.done' && e.transcript.includes('阳光')));
  assert.ok(!f.events.some(e => e.type === 'response.output_audio.delta'));
  assert.equal(f.events.at(-1).response.status, 'completed'); f.session.dispose();
});

test('DeepSeek text mode holds history on server and supports interrupted local playback', async () => {
  const requests = [], f = fixture(async (_url, options) => { requests.push(JSON.parse(options.body)); return answer('你好，一起来玩吧！'); });
  f.session.start(); await until(f.done); assert.ok(f.events.some(e => e.type === 'garden.ready'));
  f.send({ type: 'text', text: '你好' }); await until(f.done);
  assert.equal(requests.length, 1); assert.ok(requests[0].messages.some(m => m.role === 'system'));
  assert.ok(!f.events.some(e => e.type === 'response.output_audio.delta'));
  const reply = f.events.filter(e => e.type === 'response.output_audio_transcript.done').at(-1);
  f.send({ type: 'interrupt', itemId: reply.item_id, playedMs: 0 });
  assert.ok(!f.session.history.some(m => m.id === reply.item_id));
  f.advance(1000); f.send({ type: 'text', text: '我们玩什么' }); await until(f.done);
  assert.ok(requests[1].messages.some(m => m.role === 'user' && m.content === '你好'));
  assert.ok(requests[1].messages.every(m => !('id' in m)));
  f.session.dispose(); assert.equal(f.session.history.length, 0); assert.equal(f.session.outputs.size, 0);
});

test('DeepSeek audio mode segments PCM, transcribes, replies and synthesizes over separate endpoints', async () => {
  const routes = [], f = fixture(async (url, options) => {
    routes.push(url);
    if (url.endsWith('/moderations')) return Response.json({ results: [{ flagged: false, categories: Object.fromEntries(['sexual', 'sexual/minors', 'harassment', 'harassment/threatening', 'hate', 'hate/threatening', 'illicit', 'illicit/violent', 'self-harm', 'self-harm/intent', 'self-harm/instructions', 'violence', 'violence/graphic'].map(key => [key, false])) }] });
    if (url.endsWith('/transcriptions')) return Response.json({ text: '来招个手吧' });
    if (url.endsWith('/speech')) return new Response(audio());
    assert.equal(options.headers.Authorization, 'Bearer test-deepseek');
    assert.equal(JSON.parse(options.body).messages.at(-1).content, '来招个手吧'); return answer('好呀，看我招招手！');
  }, { OPENAI_API_KEY: 'test-speech', DEEPSEEK_TTS: 'openai' });
  for (let i = 0; i < 14; i++) { f.advance(); f.send({ type: 'audio', audio: Buffer.from(audio(i < 3 ? 1000 : 0)).toString('base64') }); }
  await until(f.done);
  assert.equal(f.closed(), 0); assert.deepEqual(routes.map(url => new URL(url).pathname), ['/v1/audio/transcriptions', '/v1/moderations', '/chat/completions', '/v1/moderations', '/v1/audio/speech']);
  assert.ok(f.events.some(e => e.type === 'conversation.item.input_audio_transcription.completed'));
  assert.ok(f.events.some(e => e.type === 'garden.behavior' && e.behavior.action === 'wave'));
  assert.equal(Buffer.from(f.events.find(e => e.type === 'response.output_audio.delta').delta, 'base64').length, 4800);
});

test('DeepSeek audio_end flushes a held utterance immediately', async () => {
  const routes = [], f = fixture(async (url, options) => {
    routes.push(url);
    if (url.endsWith('/transcriptions')) return Response.json({ text: '来招个手吧' });
    assert.equal(JSON.parse(options.body).messages.at(-1).content, '来招个手吧'); return answer('好呀，看我招招手！');
  }, { DEEPSEEK_ASR: 'cloudflare', DEEPSEEK_TTS: 'local', AI: { run: async () => ({ text: '来招个手吧' }) } });
  for (let i = 0; i < 3; i++) { f.advance(); f.send({ type: 'audio', audio: Buffer.from(audio(1000)).toString('base64') }); }
  assert.equal(f.session.job, undefined); f.send({ type: 'audio_end' }); await until(f.done);
  assert.deepEqual(routes, ['https://api.deepseek.com/chat/completions']);
  assert.ok(f.events.some(e => e.type === 'conversation.item.input_audio_transcription.completed'));
  assert.equal(f.events.at(-1).response.status, 'completed');
});

test('interrupt, timeout and disposal abort pending calls and suppress late output', async () => {
  for (const mode of ['interrupt', 'deadline', 'dispose']) {
    let resolve, signal; const f = fixture((_url, options) => { signal = options.signal; return new Promise(r => { resolve = r; }); });
    f.send({ type: 'text', text: '继续聊聊' }); assert.ok(f.session.job);
    if (mode === 'interrupt') f.send({ type: 'interrupt' });
    else if (mode === 'deadline') { f.advance(55001); f.session.checkDeadline(); }
    else f.session.dispose();
    assert.ok(signal.aborted); resolve(answer('迟到的回答'));
    await new Promise(r => setImmediate(r));
    assert.ok(!f.events.some(e => e.type === 'garden.behavior' || e.type === 'response.output_audio_transcript.done'));
    assert.equal(f.session.job, null);
  }
});

test('DeepSeek rejects forged roles, out-of-range playback, unexpected audio and flooding', () => {
  for (const event of [{ type: 'text', text: '你好', history: [{ role: 'system', content: 'forged' }] }, { type: 'session.update' }, { type: 'audio', audio: 'AAAA' }, { type: 'played', itemId: 'another-session', playedMs: 1 }]) {
    const f = fixture(); f.send(event); assert.equal(f.closed(), 1); assert.equal(f.session.history.length, 0);
  }
  const f = fixture(); for (let i = 0; i < 13; i++) f.send({ type: 'ping' }); assert.equal(f.closed(), 1);
});

test('recoverable provider errors and turn rate limits leave connection usable', async () => {
  const f = fixture(async () => { throw new Error('private provider details'); });
  f.send({ type: 'text', text: '你好' }); await until(f.done);
  assert.equal(f.closed(), 0); assert.ok(f.events.some(e => e.type === 'response.done' && e.response.status === 'failed'));
  assert.ok(!JSON.stringify(f.events).includes('private provider details'));
  f.session.turns = Array(20).fill(100000); f.send({ type: 'text', text: '你好' });
  assert.equal(f.events.at(-1).type, 'garden.idle'); assert.equal(f.closed(), 0);
});

test('overlong speech and response deadline leave the UI ready to retry', async () => {
  const f = fixture(async () => { throw new Error('No provider call expected for discarded audio'); }, { OPENAI_API_KEY: 'test-speech' });
  for (let i = 0; i < 201; i++) { f.advance(); f.send({ type: 'audio', audio: Buffer.from(audio()).toString('base64') }); }
  assert.equal(f.closed(), 0); assert.equal(f.events.at(-1).type, 'garden.idle');
  assert.ok(f.events.some(e => e.type === 'garden.notice')); assert.equal(f.session.job, undefined);
  let release; const g = fixture(async () => new Promise(resolve => { release = resolve; }));
  g.send({ type: 'text', text: '你好' }); g.advance(55001); g.session.checkDeadline();
  assert.equal(g.events.at(-1).type, 'garden.idle');
  release(answer('迟到的回答')); await new Promise(resolve => setImmediate(resolve));
  assert.ok(!g.events.some(e => e.type === 'response.output_audio_transcript.done'));
});

test('a full conversation remains usable after synthesis failure or interruption', async () => {
  for (const mode of ['failed', 'interrupted']) {
    let speechCalls = 0, modelCalls = 0, release;
    const f = fixture(async (url, options) => {
      if (url.endsWith('/moderations')) return Response.json({ results: [{ flagged: false, categories: Object.fromEntries(['sexual', 'sexual/minors', 'harassment', 'harassment/threatening', 'hate', 'hate/threatening', 'illicit', 'illicit/violent', 'self-harm', 'self-harm/intent', 'self-harm/instructions', 'violence', 'violence/graphic'].map(key => [key, false])) }] });
      if (url.endsWith('/completions')) { modelCalls++; assert.ok(JSON.parse(options.body).messages.length <= 22); return answer('我们继续聊天吧！'); }
      if (url.endsWith('/speech')) {
        if (++speechCalls === 1) return mode === 'failed' ? new Response(null, { status: 503 }) : new Promise(resolve => { release = resolve; });
        return new Response(audio());
      }
      assert.fail('Unexpected upstream endpoint');
    }, { OPENAI_API_KEY: 'test-speech', DEEPSEEK_TTS: 'openai' });
    f.session.history = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `先前的对话${i}` }));
    const first = f.session.run({ text: '继续聊聊' }); await until(() => speechCalls === 1);
    if (mode === 'interrupted') { f.session.interrupt(); release(new Response(audio())); }
    await first; assert.ok(f.session.history.length <= 20);
    await f.session.run({ text: '我们接着聊吧' });
    assert.equal(modelCalls, 2); assert.equal(speechCalls, 2); assert.equal(f.events.at(-1).response.status, 'completed');
    assert.ok(f.session.history.length <= 20);
  }
});
