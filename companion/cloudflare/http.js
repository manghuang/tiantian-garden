import { CONTENT_SECURITY_POLICY } from '../shared/security-policy.js';

export const json = (body, status = 200, headers = {}) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
export const problem = (message, status) => json({ error: message }, status);
export const token = () => [...crypto.getRandomValues(new Uint8Array(32))].map(n => n.toString(16).padStart(2, '0')).join('');
export const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(n => n.toString(16).padStart(2, '0')).join('');
export function sameDigest(a, b) { let diff = a.length ^ b.length; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ (b.charCodeAt(i) || 0); return diff === 0; }
export function config(env) {
  const values = String(env.PUBLIC_ORIGINS || env.PUBLIC_ORIGIN || '').split(',').map(value => value.trim()).filter(Boolean);
  const urls = values.map(value => new URL(value));
  const local = urls.length === 1 && env.LOCAL_DEVELOPMENT === 'true' && urls[0].protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(urls[0].hostname);
  if (!urls.length || (!local && urls.some(url => url.protocol !== 'https:')) || urls.some(url => url.pathname !== '/' || url.search || url.hash || url.username || url.password) || !env.ACCESS_CODE || env.ACCESS_CODE.length < 24 || env.ACCESS_CODE.length > 256) throw new Error('deployment configuration');
  return { origins: urls.map(url => url.origin), origin: urls[0].origin, cookie: local ? 'garden-local' : '__Host-garden', local };
}
export async function limitedText(request, max = 96000) {
  if (Number(request.headers.get('content-length')) > max) throw new Error('body too large');
  if (!request.body) return '';
  const reader = request.body.getReader(); const chunks = []; let length = 0;
  try {
    while (true) { const { value, done } = await reader.read(); if (done) break; length += value.length; if (length > max) { await reader.cancel(); throw new Error('body too large'); } chunks.push(value); }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}
export function secured(response, local = false) {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff'); headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Permissions-Policy', 'microphone=(self), camera=()'); headers.set('X-Frame-Options', 'DENY');
  headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  if (!local) headers.set('Strict-Transport-Security', 'max-age=31536000');
  return new Response(response.body, { status: response.status, headers, ...(response.webSocket ? { webSocket: response.webSocket } : {}) });
}
