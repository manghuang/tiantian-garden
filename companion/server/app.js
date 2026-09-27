import express from 'express';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { sessionSettings } from '../shared/behavior.js';
import { realtimeSession } from '../shared/realtime-session.js';
import { CONTENT_SECURITY_POLICY } from '../shared/security-policy.js';
import { createAccess } from './access.js';
import { leaseJournal } from './leases.js';

export const appRoot = fileURLToPath(new URL('../', import.meta.url));
const assetRoot = resolve(appRoot, '../output');

export function createApp({ env = process.env, fetcher = fetch } = {}) {
  const app = express();
  const sessions = new Map();
  const pending = new Map();
  const attempts = new Map();
  let draining = false;
  const access = createAccess(env, { onRevoke: owner => Promise.all([...sessions].filter(([, e]) => e.owner === owner).map(([id]) => hangup(id))) });
  const { deployment } = access;
  const journal = leaseJournal(env.SESSION_STORE_FILE || (deployment.mode === 'private' ? resolve(appRoot, 'data/realtime-leases.json') : null));
  for (const record of journal.read()) sessions.set(record.id, { ...record, owner: 'recovered' });
  function persist() {
    try { journal.write(sessions); }
    catch { draining = true; console.error('Session journal write failed; new calls are disabled.'); throw new Error('会话存储不可用'); }
  }
  const configured = Boolean(env.OPENAI_API_KEY);
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const hostAllowed = deployment.origin ? req.get('host') === new URL(deployment.origin).host : ['127.0.0.1', 'localhost', '[::1]'].includes(req.hostname);
    if (!hostAllowed) return res.status(403).json({ error: '访问域名不匹配。' });
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Permissions-Policy': 'microphone=(self), camera=()', 'X-Frame-Options': 'DENY' });
    if (deployment.origin) res.set({
      'Strict-Transport-Security': 'max-age=31536000',
      'Content-Security-Policy': CONTENT_SECURITY_POLICY,
    });
    next();
  });
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use('/api', express.json({ limit: '96kb' }));
  app.use(access.attach);
  app.get('/api/health', (_req, res) => res.status(draining ? 503 : 200).json({ ok: !draining, realtimeConfigured: configured }));
  app.get('/api/auth', access.status);
  app.post('/api/login', access.login);
  app.use('/api', access.require);
  app.get('/api/config', (req, res) => {
    const models = [];
    if (existsSync(resolve(appRoot, 'assets/dog-balanced.glb'))) models.push({ id: 'balanced', label: '经典轻量版', url: '/assets/dog-balanced.glb', description: '23.5 MiB，加载更快，适合低性能设备。' });
    if (existsSync(resolve(appRoot, 'assets/dog-v48.glb'))) models.push({ id: 'v48', label: '精细表情版 v48', url: '/assets/dog-v48.glb', description: '耳尾、跑跳和面部表情动作更多，画面负担也更高。' });
    if (existsSync(resolve(assetRoot, 'Skye_Animated.glb'))) models.push({ id: 'classic_full', label: '经典高精度版（加载较慢）', url: '/assets/dog.glb', description: '旧版原始高精度模型，体积较大。' });
    const requestedModel = env.MODEL_DEFAULT || (env.MODEL_QUALITY === 'full' ? 'classic_full' : 'balanced');
    const defaultModel = models.some(model => model.id === requestedModel) ? requestedModel : models[0]?.id || 'balanced';
    return res.json({
      csrf: req.access.csrf, defaultProvider: configured ? 'openai' : 'demo',
      accessRequired: deployment.protected,
      providers: [{ id: 'demo', label: '本地演示', ready: true }, { id: 'openai', label: 'OpenAI 实时语音', ready: configured }],
      childUseEnabled: env.CHILD_USE_ENABLED === 'true', models, defaultModel,
      modelUrl: models.find(model => model.id === defaultModel)?.url || '/assets/dog-balanced.glb',
    });
  });
  app.use('/api', (req, res, next) => {
    if (req.get('X-Session-Token') !== req.access.csrf) return res.status(403).json({ error: '页面已过期，请刷新后重试。' });
    if (!access.sameOrigin(req)) return res.status(403).json({ error: '不允许跨站请求。' });
    next();
  });
  app.post('/api/logout', access.logout);

  async function hangup(id) {
    const entry = sessions.get(id);
    if (!entry) return;
    if (entry.closing) return entry.closing;
    clearTimeout(entry.timer);
    entry.closing = (async () => { try {
      const response = await fetcher(`https://api.openai.com/v1/realtime/calls/${encodeURIComponent(entry.callId)}/hangup`, {
        method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` }, signal: AbortSignal.timeout(8000),
      });
      if (!response.ok && response.status !== 404) throw new Error();
      sessions.delete(id);
      persist();
    } catch {
      console.warn('Realtime closure or journal update unconfirmed; retained calls will be retried.');
      if (sessions.has(id) && !draining) { entry.timer = setTimeout(() => void hangup(id), 30000); entry.timer.unref?.(); }
    } finally { entry.closing = null; } })();
    return entry.closing;
  }

  app.post('/api/session', async (req, res) => {
    if (draining) return res.status(503).json({ error: '服务正在维护，请稍后再试。' });
    if (!configured) return res.status(503).json({ error: '尚未配置 OPENAI_API_KEY。可以先使用本地演示。' });
    const body = req.body ?? {};
    if (body.consent !== true) return res.status(400).json({ error: '请由家长阅读并确认语音使用说明。' });
    if (body.audience !== 'adult-test' && !(body.audience === 'child' && env.CHILD_USE_ENABLED === 'true')) return res.status(403).json({ error: '当前仅开放成年人测试；儿童使用需要先完成服务方的数据与安全配置。' });
    if (typeof body.sdp !== 'string' || !body.sdp.startsWith('v=0') || body.sdp.length > 80000) return res.status(400).json({ error: '语音连接参数无效。' });
    const now = Date.now();
    const owner = req.access.id;
    for (const [key, times] of attempts) if (now - times.at(-1) >= 60000) attempts.delete(key);
    const recent = (attempts.get(owner) || []).filter(t => now - t < 60000);
    const ownerPending = pending.get(owner) || 0;
    const totalPending = [...pending.values()].reduce((sum, n) => sum + n, 0);
    if (recent.length >= 5 || sessions.size + totalPending >= 3 || (deployment.protected && (ownerPending || [...sessions.values()].some(e => e.owner === owner)))) return res.status(429).set('Retry-After', '60').json({ error: '连接次数过多，请结束已有互动或稍等一分钟。' });
    attempts.set(owner, [...recent, now]);
    pending.set(owner, ownerPending + 1);
    const settings = sessionSettings(body.settings);
    const fd = new FormData();
    fd.set('sdp', body.sdp);
    fd.set('session', JSON.stringify(realtimeSession(env, settings)));
    let createdId;
    try {
      const response = await fetcher('https://api.openai.com/v1/realtime/calls', {
        method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` }, body: fd, signal: AbortSignal.timeout(25000),
      });
      if (!response.ok) {
        // Do not forward upstream bodies, SDP, user audio or credentials into logs.
        return res.status(response.status === 429 ? 429 : 502).json({ error: response.status === 401 ? '服务密钥未通过验证，请检查服务器配置。' : `语音服务暂不可用（${response.status}），请稍后再试。` });
      }
      const location = response.headers.get('location');
      const callId = location?.split('/').pop();
      if (!callId || !/^[a-zA-Z0-9_-]{1,256}$/.test(callId)) return res.status(502).json({ error: '语音服务未返回会话标识，请稍后重试。' });
      const id = randomUUID();
      createdId = id;
      const expiresAt = Date.now() + settings.minutes * 60000;
      const timer = setTimeout(() => void hangup(id), settings.minutes * 60000);
      timer.unref?.();
      sessions.set(id, { callId, timer, owner, expiresAt });
      persist();
      const sdp = await response.text();
      if (!sdp.startsWith('v=0') || sdp.length > 80000) { await hangup(id); return res.status(502).json({ error: '语音服务返回了无效的连接信息。' }); }
      if (res.destroyed || draining || !access.isActive(owner)) { await hangup(id); if (!res.destroyed) res.status(503).json({ error: '连接已取消，请重新登录后再试。' }); return; }
      res.json({ sdp, id, expiresAt });
    } catch (error) {
      if (createdId) await hangup(createdId);
      res.status(504).json({ error: error.name === 'TimeoutError' ? '连接超时了，请检查网络后再试。' : '暂时无法连接语音服务，请检查网络和服务配置。' });
    } finally { const remaining = (pending.get(owner) || 1) - 1; if (remaining) pending.set(owner, remaining); else pending.delete(owner); }
  });
  app.delete('/api/session/:id', async (req, res) => {
    if (sessions.has(req.params.id) && sessions.get(req.params.id).owner !== req.access.id) return res.status(404).json({ error: '会话不存在。' });
    await hangup(req.params.id); res.status(204).end();
  });
  app.get('/assets/dog.glb', access.require, (_req, res) => res.sendFile(resolve(assetRoot, 'Skye_Animated.glb')));
  app.get('/assets/dog-balanced.glb', access.require, (_req, res) => res.sendFile(resolve(appRoot, 'assets/dog-balanced.glb')));
  app.get('/assets/dog-v48.glb', access.require, (_req, res) => res.sendFile(resolve(appRoot, 'assets/dog-v48.glb')));
  app.get('/assets/dog-preview.png', access.require, (_req, res) => res.sendFile(resolve(assetRoot, 'Skye_Preview.png')));
  app.use('/api', (_req, res) => res.status(404).json({ error: '接口不存在。' }));
  app.use((err, _req, res, next) => {
    if (err) return res.status(err.status === 413 ? 413 : 400).json({ error: '请求格式无效或内容过长。' });
    next();
  });
  // A restarted process cannot resume browser peers; close recovered calls before
  // accepting traffic. Failed closures remain in the journal and consume slots.
  const ready = Promise.all([...sessions.keys()].map(hangup));
  return { app, deployment, ready, shutdown: async () => { draining = true; access.close(); for (const entry of sessions.values()) clearTimeout(entry.timer); await Promise.all([...sessions.keys()].map(hangup)); } };
}
