import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const digest = value => createHash('sha256').update(value).digest();
const token = () => randomBytes(32).toString('hex');
const TTL = 8 * 60 * 60 * 1000;

export function deploymentSettings(env) {
  const mode = env.DEPLOYMENT_MODE || 'local';
  if (!['local', 'private'].includes(mode)) throw new Error('DEPLOYMENT_MODE 必须是 local 或 private');
  let origin;
  if (mode === 'private') {
    try {
      const url = new URL(env.PUBLIC_ORIGIN);
      if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error();
      origin = url.origin;
    } catch { throw new Error('private 部署必须配置仅含 HTTPS 域名的 PUBLIC_ORIGIN'); }
    if (typeof env.ACCESS_CODE !== 'string' || env.ACCESS_CODE.length < 24 || env.ACCESS_CODE.length > 256) throw new Error('private 部署必须配置 24–256 字符的随机 ACCESS_CODE');
  }
  const host = env.BIND_HOST || (mode === 'private' ? '0.0.0.0' : '127.0.0.1');
  if (mode === 'local' && !['127.0.0.1', '::1', 'localhost'].includes(host)) throw new Error('对外监听必须启用 private 部署及访问控制');
  return { mode, origin, host, protected: mode === 'private' || Boolean(env.ACCESS_CODE) };
}

// An admission gate for a single-instance private pilot, not a parent identity system.
// Restart revokes login cookies; only random credentials are kept in memory.
export function createAccess(env, { onRevoke = async () => {}, now = Date.now } = {}) {
  const deployment = deploymentSettings(env);
  const secured = deployment.mode === 'private';
  const name = secured ? '__Host-garden' : 'garden-local';
  const secret = digest(env.ACCESS_CODE || token());
  const logins = new Map();
  const local = { id: 'local', csrf: token(), expiresAt: Infinity };
  let attempts = [];
  const cookieOptions = { httpOnly: true, secure: secured, sameSite: 'strict', path: '/' };
  async function revoke(id) { if (logins.delete(id)) await onRevoke(id); }
  function lookup(req) {
    if (!deployment.protected) return local;
    const id = req.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(`${name}=`))?.slice(name.length + 1);
    const entry = logins.get(id);
    if (entry && entry.expiresAt > now()) return entry;
    if (entry) void revoke(id);
    return null;
  }
  function sameOrigin(req) {
    const expected = deployment.origin || `${req.protocol}://${req.get('host')}`;
    return req.get('origin') === expected || (!secured && !req.get('origin'));
  }
  const sweep = setInterval(() => { for (const [id, entry] of logins) if (entry.expiresAt <= now()) void revoke(id); }, 30000);
  sweep.unref();
  return {
    deployment, sameOrigin,
    isActive: id => id === 'local' ? !deployment.protected : (logins.get(id)?.expiresAt || 0) > now(),
    attach(req, _res, next) { req.access = lookup(req); next(); },
    require(req, res, next) { if (!req.access) return res.status(401).json({ error: '请先由家长输入访问口令。', code: 'LOGIN_REQUIRED' }); next(); },
    status(req, res) { res.json({ required: deployment.protected, authenticated: Boolean(req.access) }); },
    async login(req, res) {
      if (!sameOrigin(req)) return res.status(403).json({ error: '不允许跨站登录。' });
      if (!deployment.protected) return res.json({ ok: true });
      // Fixed global ceiling is intentionally conservative behind a reverse proxy.
      // Never trust client-provided X-Forwarded-For for admission limits.
      attempts = attempts.filter(t => now() - t < 60000);
      if (attempts.length >= 10 || logins.size >= 200) return res.status(429).set('Retry-After', '60').json({ error: '登录尝试过多，请一分钟后再试。' });
      attempts.push(now());
      const code = req.body?.code;
      if (typeof code !== 'string' || code.length > 256 || !timingSafeEqual(digest(code), secret)) return res.status(401).json({ error: '访问口令不正确。' });
      if (req.access) await revoke(req.access.id);
      const id = token();
      logins.set(id, { id, csrf: token(), expiresAt: now() + TTL });
      res.cookie(name, id, { ...cookieOptions, maxAge: TTL });
      res.json({ ok: true });
    },
    async logout(req, res) { await revoke(req.access.id); res.clearCookie(name, cookieOptions); res.status(204).end(); },
    close() { clearInterval(sweep); logins.clear(); },
  };
}
