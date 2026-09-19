import { sessionSettings } from '../shared/behavior.js';
import { realtimeSession } from '../shared/realtime-session.js';
import { ReviewedRelay } from '../shared/reviewed-relay.js';
import { DeepSeekSession } from '../shared/deepseek-session.js';
import { cloudflareTTSConfigError, deepseekSpeech } from '../shared/speech-services.js';
import { LocalVoiceBroker } from '../shared/local-voice-broker.js';
import { config, digest, json, limitedText, problem, sameDigest, token } from './http.js';

const empty = () => ({ version: 1, logins: {}, calls: {}, loginAttempts: [] });
const TTL = 8 * 60 * 60 * 1000;

// One SQLite-backed Durable Object coordinates this small private pilot globally.
// Only short storage updates are serialized; provider I/O never holds this lock.
export class GardenControl {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; this.fetcher = fetch; this.now = Date.now; this.sockets = new Map(); this.localVoice = new LocalVoiceBroker({ now: () => this.now() }); }
  async mutate(fn) {
    const fingerprint = await digest(this.env.ACCESS_CODE || '');
    return this.ctx.blockConcurrencyWhile(async () => {
      const s = await this.ctx.storage.get('control') || empty();
      if (s.version !== 1 || !s.logins || !s.calls || !Array.isArray(s.loginAttempts)) throw new Error('Invalid durable state');
      const now = this.now();
      if (s.fingerprint !== fingerprint) { s.logins = {}; s.fingerprint = fingerprint; }
      for (const [id, login] of Object.entries(s.logins)) {
        if (login.expiresAt <= now) delete s.logins[id];
        else login.attempts = login.attempts.filter(t => t > now - 60000);
      }
      s.loginAttempts = s.loginAttempts.filter(t => t > now - 60000);
      for (const [id, call] of Object.entries(s.calls)) {
        if (call.transport === 'websocket') {
          if (!s.logins[call.owner] || call.next <= now) { this.sockets.get(id)?.stop(); delete s.calls[id]; }
          continue;
        }
        if (call.phase === 'pending') { if (call.next <= now) delete s.calls[id]; }
        else if (call.phase === 'active' && (call.expiresAt <= now || !s.logins[call.owner])) { call.phase = 'closing'; call.next = now; }
      }
      const result = fn(s, now);
      await this.ctx.storage.put('control', s);
      const times = [...Object.values(s.calls).map(c => c.next), ...Object.values(s.logins).map(l => l.expiresAt)];
      if (s.loginAttempts.length) times.push(s.loginAttempts.at(-1) + 60000);
      if (times.length) await this.ctx.storage.setAlarm(Math.max(now + 100, Math.min(...times)));
      else await this.ctx.storage.deleteAlarm();
      return result;
    });
  }
  async owner(request, setup) {
    const value = request.headers.get('cookie')?.split(';').map(x => x.trim()).find(x => x.startsWith(`${setup.cookie}=`))?.slice(setup.cookie.length + 1);
    return /^[a-f0-9]{64}$/.test(value || '') ? digest(value) : '';
  }
  async fetch(request) {
    try { return await this.route(request); }
    catch { return problem('服务暂不可用，请稍后再试。', 503); }
  }
  async route(request) {
    const setup = config(this.env); const url = new URL(request.url); const path = url.pathname;
    if (!setup.origins.includes(url.origin)) return problem('访问域名不匹配。', 403);
    if (path === '/api/voice-worker/socket') {
      const secret = this.env.VOICE_WORKER_TOKEN;
      const supplied = request.headers.get('authorization') || '';
      if (request.method !== 'GET' || request.headers.has('origin') || typeof secret !== 'string' || secret.length < 32 || supplied.length > 300 || !sameDigest(await digest(supplied), await digest(`Bearer ${secret}`))) return problem('音色服务验证失败。', 401);
      if (this.env.DEEPSEEK_TTS !== 'local-gpu') return problem('本机音色服务尚未启用。', 503);
      if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return problem('需要音色连接升级。', 426);
      if (this.localVoice.ready) return problem('已有本机音色服务连接。', 409);
      const pair = new WebSocketPair(); pair[1].accept(); this.localVoice.attach(pair[1]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    const write = !['GET', 'HEAD'].includes(request.method);
    if (write && !setup.origins.includes(request.headers.get('origin'))) return problem('不允许跨站请求。', 403);
    const owner = await this.owner(request, setup);
    const login = await this.mutate(s => s.logins[owner] || null);
    if (path === '/api/health' && request.method === 'GET') return json({ ok: true, realtimeConfigured: Boolean(this.env.OPENAI_API_KEY) });
    if (path === '/api/auth' && request.method === 'GET') return json({ required: true, authenticated: Boolean(login) });
    let body;
    if (request.method === 'POST' && ['/api/login', '/api/session'].includes(path)) {
      if (!request.headers.get('content-type')?.startsWith('application/json')) return problem('请使用 JSON 请求。', 400);
      try { body = JSON.parse(await limitedText(request)); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(); }
      catch { return problem('请求格式无效或内容过长。', 400); }
    }
    if (path === '/api/login' && request.method === 'POST') {
      const limited = await this.mutate((s, now) => {
        if (s.loginAttempts.length >= 10 || Object.keys(s.logins).length >= 200) return true;
        s.loginAttempts.push(now); return false;
      });
      if (limited) return json({ error: '登录尝试过多，请一分钟后再试。' }, 429, { 'Retry-After': '60' });
      if (typeof body.code !== 'string' || body.code.length > 256 || !sameDigest(await digest(body.code), await digest(this.env.ACCESS_CODE))) return problem('访问口令不正确。', 401);
      const raw = token(); const id = await digest(raw); const csrf = token();
      const closing = await this.mutate((s, now) => {
        delete s.logins[owner]; s.logins[id] = { csrf, expiresAt: now + TTL, attempts: [] };
        return this.revokeCalls(s, owner, now);
      });
      await Promise.all(closing.map(id => this.hangup(id)));
      return json({ ok: true }, 200, { 'Set-Cookie': `${setup.cookie}=${raw}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${setup.local ? '' : '; Secure'}` });
    }
    if (!login) return json({ error: '请先由家长输入访问口令。', code: 'LOGIN_REQUIRED' }, 401);
    if (path === '/api/config' && request.method === 'GET') {
      const speech = deepseekSpeech(this.env);
      const voiceReady = speech.tts === 'local-gpu' ? this.localVoice.ready : speech.ttsReady;
      const label = speech.tts === 'local-gpu' ? 'DeepSeek + 本机角色音色' : speech.tts === 'cloudflare-minimax' ? 'DeepSeek + Cloudflare 天天音色' : speech.tts === 'minimax_direct' ? 'DeepSeek + MiniMax 直连音色' : speech.tts === 'cloudflare-melotts' ? 'DeepSeek + Cloudflare MeloTTS' : speech.asr === 'cloudflare' ? 'DeepSeek + Cloudflare 语音输入' : this.env.OPENAI_API_KEY ? 'DeepSeek 对话 + OpenAI 语音' : 'DeepSeek 文字 + 本机朗读';
      return json({
        csrf: login.csrf, defaultProvider: this.env.OPENAI_API_KEY ? 'openai' : this.env.DEEPSEEK_API_KEY ? 'deepseek' : 'demo', accessRequired: true,
        providers: [
          { id: 'demo', label: '本地演示（预设回复）', ready: true, audio: false },
          { id: 'openai', label: 'OpenAI 实时语音', ready: Boolean(this.env.OPENAI_API_KEY), audio: true, moderation: this.env.REALTIME_TRANSPORT === 'webrtc' ? 'none' : 'output-text' },
          { id: 'deepseek', label, ready: Boolean(this.env.DEEPSEEK_API_KEY), ...speech, voiceReady, moderation: this.env.OPENAI_API_KEY ? 'openai-text' : 'local-rules' },
        ],
        childUseEnabled: this.env.CHILD_USE_ENABLED === 'true', modelUrl: '/assets/dog-balanced.glb',
        realtimeTransport: this.env.REALTIME_TRANSPORT === 'webrtc' ? 'webrtc' : 'websocket',
      });
    }
    if (path === '/api/asset-access' && request.method === 'GET') return new Response(null, { status: 204 });
    const socketMatch = /^\/api\/session\/([\w-]{1,128})\/socket$/.exec(path);
    if (socketMatch && request.method === 'GET') {
      const protocols = request.headers.get('Sec-WebSocket-Protocol')?.split(',').map(x => x.trim()) || [];
      if (!setup.origins.includes(request.headers.get('origin')) || !protocols.includes('garden.v1') || !protocols.includes(`csrf.${login.csrf}`)) return problem('语音页面已过期，请刷新。', 403);
      if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return problem('需要语音连接升级。', 426);
      return this.openSocket(socketMatch[1], owner);
    }
    if (write && request.headers.get('X-Session-Token') !== login.csrf) return problem('页面已过期，请刷新后重试。', 403);
    if (path === '/api/logout' && request.method === 'POST') {
      const closing = await this.mutate((s, now) => { delete s.logins[owner]; return this.revokeCalls(s, owner, now); });
      await Promise.all(closing.map(id => this.hangup(id)));
      return new Response(null, { status: 204, headers: { 'Set-Cookie': `${setup.cookie}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${setup.local ? '' : '; Secure'}`, 'Cache-Control': 'no-store' } });
    }
    if (path === '/api/session' && request.method === 'POST') return this.createSession(body, owner);
    const match = /^\/api\/session\/([a-zA-Z0-9_-]{1,128})$/.exec(path);
    if (match && request.method === 'DELETE') {
      const entry = await this.mutate(s => s.calls[match[1]]);
      if (entry && entry.owner !== owner) return problem('会话不存在。', 404);
      await this.hangup(match[1]); return new Response(null, { status: 204 });
    }
    return problem('接口不存在。', 404);
  }
  revokeCalls(s, owner, now) {
    const ids = [];
    for (const [id, call] of Object.entries(s.calls)) if (call.owner === owner && (call.callId || call.transport === 'websocket')) { call.phase = 'closing'; call.next = now; ids.push(id); }
    return ids;
  }
  async createSession(body, owner) {
    const provider = body.provider ?? 'openai';
    if (!['openai', 'deepseek'].includes(provider)) return problem('不支持的互动服务。', 400);
    if (!(provider === 'deepseek' ? this.env.DEEPSEEK_API_KEY : this.env.OPENAI_API_KEY)) return problem(`尚未配置 ${provider === 'deepseek' ? 'DEEPSEEK_API_KEY' : 'OPENAI_API_KEY'}。可以先使用本地演示。`, 503);
    const speech = provider === 'deepseek' ? deepseekSpeech(this.env) : null;
    if (provider === 'deepseek' && speech.tts === 'local-gpu' && !this.localVoice.ready) return problem('请先在电脑上启动天天音色服务，再开始互动。', 503);
    if (provider === 'deepseek' && ['cloudflare-minimax', 'cloudflare-melotts', 'minimax_direct', 'invalid'].includes(speech.tts) && !speech.ttsReady) return problem(cloudflareTTSConfigError(this.env) || 'TTS 语音服务尚未配置。', 503);
    if (body.consent !== true) return problem('请由家长阅读并确认语音使用说明。', 400);
    if (body.audience !== 'adult-test' && !(body.audience === 'child' && this.env.CHILD_USE_ENABLED === 'true')) return problem('当前仅开放成年人测试。', 403);
    const socket = provider === 'deepseek' || this.env.REALTIME_TRANSPORT !== 'webrtc';
    if (!socket && (typeof body.sdp !== 'string' || !body.sdp.startsWith('v=0') || body.sdp.length > 80000)) return problem('语音连接参数无效。', 400);
    const settings = sessionSettings(body.settings); const id = crypto.randomUUID();
    const reserved = await this.mutate((s, now) => {
      const login = s.logins[owner];
      if (!login) return 401;
      if (login.attempts.length >= 5 || Object.keys(s.calls).length >= 3 || Object.values(s.calls).some(c => c.owner === owner)) return 429;
      login.attempts.push(now); s.calls[id] = { owner, phase: 'pending', next: now + 35000, ...(socket ? { transport: 'websocket', provider, settings, expiresAt: now + settings.minutes * 60000 } : {}) }; return 200;
    });
    if (reserved !== 200) return json({ error: '请重新登录，或结束已有互动后稍等一分钟。' }, reserved, { 'Retry-After': '60' });
    if (socket) return json({ id, expiresAt: this.now() + settings.minutes * 60000, transport: 'websocket', socketPath: `/api/session/${id}/socket` });
    let callId;
    try {
      const fd = new FormData(); fd.set('sdp', body.sdp); fd.set('session', JSON.stringify(realtimeSession(this.env, settings)));
      const upstream = await this.fetcher('https://api.openai.com/v1/realtime/calls', {
        method: 'POST', headers: { Authorization: `Bearer ${this.env.OPENAI_API_KEY}` }, body: fd, signal: AbortSignal.timeout(25000),
      });
      if (!upstream.ok) { await upstream.body?.cancel(); return problem('语音服务暂不可用，请稍后再试。', upstream.status === 429 ? 429 : 502); }
      callId = upstream.headers.get('location')?.split('/').pop();
      if (!/^[a-zA-Z0-9_-]{1,256}$/.test(callId || '')) { callId = null; await upstream.body?.cancel(); return problem('语音服务未返回会话标识。', 502); }
      const expiresAt = this.now() + settings.minutes * 60000;
      const accepted = await this.mutate((s, now) => {
        const valid = Boolean(s.logins[owner] && s.calls[id]?.phase === 'pending');
        s.calls[id] = { owner, callId, phase: valid ? 'active' : 'closing', expiresAt, next: valid ? expiresAt : now };
        return valid;
      });
      const sdp = await limitedText(upstream, 80000);
      const active = await this.mutate(s => s.logins[owner] && s.calls[id]?.phase === 'active');
      if (!accepted || !active || !sdp.startsWith('v=0')) { await this.hangup(id); return problem('连接已取消或无效，请重新开始。', 502); }
      return json({ sdp, id, expiresAt });
    } catch {
      if (callId) {
        // Persist closure intent even if the first attempt to store the call failed.
        await this.mutate((s, now) => { s.calls[id] = { owner, callId, phase: 'closing', next: now, expiresAt: now }; });
        await this.hangup(id);
      }
      return problem('连接超时或服务暂不可用，请稍后再试。', 504);
    } finally {
      await this.mutate(s => { if (s.calls[id]?.phase === 'pending') delete s.calls[id]; });
    }
  }
  async hangup(id) {
    this.sockets.get(id)?.stop();
    const entry = await this.mutate((s, now) => {
      if (s.calls[id]?.transport === 'websocket') { delete s.calls[id]; return null; }
      const call = s.calls[id]; if (!call?.callId) return null;
      call.phase = 'closing'; call.next = now + 30000; return { ...call };
    });
    if (!entry) return;
    try {
      const result = await this.fetcher(`https://api.openai.com/v1/realtime/calls/${encodeURIComponent(entry.callId)}/hangup`, {
        method: 'POST', headers: { Authorization: `Bearer ${this.env.OPENAI_API_KEY}` }, signal: AbortSignal.timeout(8000),
      });
      await result.body?.cancel();
      if (result.ok || result.status === 404) await this.mutate(s => { if (s.calls[id]?.callId === entry.callId) delete s.calls[id]; });
    } catch { /* Durable next deadline retains capacity and retries after eviction. */ }
  }
  async alarm() {
    const due = await this.mutate((s, now) => Object.entries(s.calls).filter(([, c]) => c.callId && c.next <= now).map(([id]) => id));
    await Promise.all(due.map(id => this.hangup(id)));
  }
  async openSocket(id, owner) {
    const entry = await this.mutate(s => {
      const call = s.calls[id];
      if (!call || call.owner !== owner || call.transport !== 'websocket' || call.phase !== 'pending') return null;
      call.phase = 'connecting'; return { ...call };
    });
    if (!entry) return problem('会话不存在或已使用，请重新开始。', 404);
    let upstream, server, relay, timer, openingTimer; const abort = new AbortController(); let stopped = false;
    const stop = () => {
      if (stopped) return; stopped = true; abort.abort(); clearTimeout(openingTimer); clearInterval(timer);
      relay?.dispose?.();
      for (const socket of [server, upstream]) try { socket?.close(1000, 'Session ended'); } catch { /* Already closed. */ }
      this.sockets.delete(id);
    };
    this.sockets.set(id, { stop });
    const finish = () => { stop(); void this.hangup(id).catch(() => {}); };
    openingTimer = setTimeout(finish, 25000);
    try {
      if (entry.provider !== 'deepseek') {
      const response = await this.fetcher(`https://api.openai.com/v1/realtime?model=${encodeURIComponent(this.env.OPENAI_REALTIME_MODEL || 'gpt-realtime-2.1')}`, {
        headers: { Upgrade: 'websocket', Authorization: `Bearer ${this.env.OPENAI_API_KEY}`, 'OpenAI-Safety-Identifier': owner }, signal: abort.signal,
      });
      upstream = response.webSocket;
      if (!upstream) { await response.body?.cancel(); throw new Error(); }
      upstream.accept();
      if (stopped) { upstream.close(1000, 'Cancelled'); throw new Error(); }
      }
      const accepted = await this.mutate(s => {
        const call = s.calls[id]; if (!s.logins[owner] || call?.phase !== 'connecting') return false;
        call.phase = 'active'; call.next = call.expiresAt; delete call.settings; return true;
      });
      if (!accepted || stopped) throw new Error();
      const pair = new WebSocketPair(); server = pair[1]; server.accept();
      let lastSeen = this.now();
      const options = { env: this.env, settings: entry.settings, now: this.now,
        emit: event => { if (stopped) return; if (event.type === 'garden.ready') clearTimeout(openingTimer); server.send(JSON.stringify(event)); }, close: finish,
      };
      relay = entry.provider === 'deepseek' ? new DeepSeekSession({ ...options, fetcher: this.fetcher, localVoice: this.localVoice })
        : new ReviewedRelay({ ...options, fetcher: this.fetcher, send: event => { if (!stopped) upstream.send(JSON.stringify(event)); } });
      server.addEventListener('message', event => { lastSeen = this.now(); relay.client(event.data); });
      upstream?.addEventListener('message', event => relay.upstream(event.data));
      for (const socket of [server, upstream].filter(Boolean)) { socket.addEventListener('close', finish); socket.addEventListener('error', finish); }
      timer = setInterval(() => { if (this.now() >= entry.expiresAt || this.now() - lastSeen > 20000) finish(); else relay.checkDeadline(); }, 1000);
      relay.start();
      return new Response(null, { status: 101, headers: { 'Sec-WebSocket-Protocol': 'garden.v1' }, webSocket: pair[0] });
    } catch { stop(); await this.hangup(id); return problem('语音连接失败，请稍后重试。', 502); }
  }
}
