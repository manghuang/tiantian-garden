import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import express from 'express';
import { spawn } from 'node:child_process';
import { createApp, appRoot } from './app.js';

if (existsSync(resolve(appRoot, '.env'))) process.loadEnvFile(resolve(appRoot, '.env'));
const production = process.argv.includes('--production');
if (process.env.DEPLOYMENT_MODE === 'private' && !production) throw new Error('private 部署必须先构建并通过 npm start 启动');
const { app, shutdown, deployment, ready } = createApp();
await ready;
let vite;
if (production) {
  if (!existsSync(resolve(appRoot, 'dist/index.html'))) throw new Error('请先运行 npm run build');
  app.use(express.static(resolve(appRoot, 'dist')));
  app.get('/', (_req, res) => res.sendFile(resolve(appRoot, 'dist/index.html')));
} else {
  const { createServer } = await import('vite');
  vite = await createServer({ root: appRoot, configLoader: 'native', server: { middlewareMode: true, hmr: false }, appType: 'spa' });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT) || 3210;
const server = app.listen(port, deployment.host, error => {
  if (error) return;
  const url = deployment.origin || `http://127.0.0.1:${port}`;
  console.log(`天天的小花园已启动：${url}`);
  if (process.argv.includes('--open') && process.platform === 'win32') spawn('cmd.exe', ['/c', 'start', '', url], { windowsHide: true, stdio: 'ignore' });
});
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已被占用。请打开现有页面，或修改 .env 中 PORT。` : error.message); process.exit(1); });
server.requestTimeout = 35000;
server.headersTimeout = 10000;
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  if (closing) return;
  closing = true;
  const deadline = setTimeout(() => { server.closeAllConnections(); process.exit(1); }, 40000); deadline.unref();
  const closed = new Promise(resolve => server.close(resolve));
  await shutdown(); await vite?.close(); await closed; clearTimeout(deadline); process.exit(0);
});
