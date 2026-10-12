// Vercel is a view-only HTTP pass-through for PC01. No Core/GitHub state processing.
import { timingSafeEqual } from 'node:crypto';

const TARGETS = Object.freeze({
  dashboard: '/', status: '/api/status', work: '/api/health-live-work',
  live: '/api/live-status', history: '/api/work-history',
  workjs: '/work-center.js', workcss: '/work-ui.css',
  visualcss: '/work-center-visual.css'
});
function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && right.length >= 16 && timingSafeEqual(left, right);
}
export function resolveViewPath(target, number) {
  if (typeof target !== 'string' || !Object.hasOwn(TARGETS, target)) return null;
  if (target === 'history') {
    if (typeof number !== 'string' || !/^[1-9][0-9]{0,7}$/.test(number)) return null;
    return '/api/work-history?number=' + number;
  }
  return TARGETS[target];
}
export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store, max-age=0');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('vary', 'Authorization');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('allow', 'GET, HEAD');
    return res.status(405).json({ error: 'VIEW_ONLY' });
  }

  // Protect the public Vercel URL independently from the PC01 relay.
  const password = process.env.TIGERIQ_LIVE_VIEW_PASSWORD || '';
  const username = process.env.TIGERIQ_LIVE_VIEW_USER || 'son';
  if (!password || password.length < 16) return res.status(503).json({error:'VIEW_AUTH_NOT_CONFIGURED'});
  const header = String(req.headers.authorization || '');
  let submitted = '';
  try {
    if (header.startsWith('Basic ')) submitted = Buffer.from(header.slice(6), 'base64').toString('utf8');
  } catch {}
  if (!safeEqual(submitted, username + ':' + password)) {
    res.setHeader('www-authenticate', 'Basic realm="TigerIQ API Health", charset="UTF-8"');
    return res.status(401).json({ error: 'LOGIN_REQUIRED' });
  }
  const target = req.query?.target;
  const path = resolveViewPath(target, req.query?.number);
  if (!path) return res.status(404).json({ error: 'NOT_FOUND' });
  const origin = String(process.env.TIGERIQ_PC01_VIEW_ORIGIN || '').replace(/\/$/, '');
  const token = String(process.env.TIGERIQ_PC01_VIEW_TOKEN || '');
  if (!/^https:\/\/[a-z0-9.-]+\.ts\.net$/i.test(origin) || token.length < 32) {
    return res.status(503).json({ error: 'PC01_VIEW_NOT_CONFIGURED' });
  }
  try {
    const response = await fetch(origin + path, {
      method: req.method,
      headers: { 'x-tigeriq-origin-token': token, accept: '*/*' },
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(14500)
    });
    const max = 16 * 1024 * 1024;
    if (Number(response.headers.get('content-length') || 0) > max) return res.status(502).json({error:'OVERSIZED_UPSTREAM'});
    const body = req.method === 'HEAD' ? Buffer.alloc(0) : Buffer.from(await response.arrayBuffer());
    if (body.length > max) return res.status(502).json({error:'OVERSIZED_UPSTREAM'});
    res.statusCode = response.status;
    res.setHeader('content-type', response.headers.get('content-type') || 'application/octet-stream');
    return res.end(body);
  } catch {
    return res.status(502).json({ error: 'PC01_NOT_REACHABLE' });
  }
}
