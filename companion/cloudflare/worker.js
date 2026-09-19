import { GardenControl } from './control.js';
import { config, problem, secured } from './http.js';
export { GardenControl };

export default {
  async fetch(request, env) {
    let setup;
    try { setup = config(env); } catch { return secured(problem('服务尚未完成部署配置。', 503)); }
    const url = new URL(request.url);
    if (!setup.origins.includes(url.origin)) return secured(problem('访问域名不匹配。', 403), setup.local);
    try {
      const control = env.GARDEN.get(env.GARDEN.idFromName('garden-control-v1'));
      if (url.pathname.startsWith('/api/')) return secured(await control.fetch(request), setup.local);
      if (!['GET', 'HEAD'].includes(request.method)) return secured(problem('不支持的请求方法。', 405), setup.local);
      // Only the application shell is public. Model and voice assets require admission.
      const shell = url.pathname === '/' || url.pathname === '/index.html' || /^\/assets\/[^/]+\.(js|css)$/.test(url.pathname);
      if (!shell) {
        const authUrl = new URL('/api/asset-access', url);
        const auth = await control.fetch(new Request(authUrl, { headers: request.headers }));
        if (!auth.ok) return secured(auth, setup.local);
      }
      const response = await env.ASSETS.fetch(request);
      const result = secured(response, setup.local);
      // Avoid a browser or shared cache serving protected content after logout.
      if (!shell) result.headers.set('Cache-Control', 'private, no-store');
      return result;
    } catch { return secured(problem('服务暂不可用，请稍后再试。', 503), setup.local); }
  },
};
