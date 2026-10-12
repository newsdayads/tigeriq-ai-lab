// PC01 API Health view-only boundary. This server is the ONLY service exposed by Funnel.
// Never forward arbitrary paths, methods, request headers, or mutations to Core.
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const VIEW_PATHS = new Set([
  '/', '/work-center.js', '/work-ui.css', '/work-center-visual.css',
  '/api/status', '/api/health-live-work', '/api/live-status', '/api/work-history'
]);

function equalSecrets(received, expected) {
  const a = Buffer.from(String(received || ''));
  const b = Buffer.from(String(expected || ''));
  return a.length === b.length && b.length >= 32 && timingSafeEqual(a, b);
}
function send(res, code, message) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify({ ok: false, error: message }));
}
export function createViewRelay({ token, upstream = 'http://127.0.0.1:8795', fetchImpl = fetch } = {}) {
  if (!token || Buffer.byteLength(token) < 32) throw Error('PC01_VIEW_RELAY_TOKEN_REQUIRED');
  const origin = new URL(upstream);
  if (origin.hostname !== '127.0.0.1' || origin.protocol !== 'http:') {
    throw Error('PC01_VIEW_RELAY_LOOPBACK_ONLY');
  }
  return createServer(async (req, res) => {
    if (!equalSecrets(req.headers['x-tigeriq-origin-token'], token)) {
      return send(res, 401, 'UNAUTHORIZED');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('allow', 'GET, HEAD');
      return send(res, 405, 'READ_ONLY');
    }
    let path;
    try {
      const requested = new URL(req.url || '/', 'http://localhost');
      if (!VIEW_PATHS.has(requested.pathname)) return send(res, 404, 'NOT_FOUND');
      if (requested.pathname === '/api/work-history') {
        if (![...requested.searchParams.keys()].every(k => k === 'number') ||
            !/^[1-9][0-9]{0,7}$/.test(requested.searchParams.get('number') || '') ||
            [...requested.searchParams.keys()].length !== 1) return send(res, 400, 'BAD_NUMBER');
        path = requested.pathname + '?number=' + requested.searchParams.get('number');
      } else {
        if (requested.search) return send(res, 400, 'QUERY_NOT_ALLOWED');
        path = requested.pathname;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 14000);
      let response;
      try {
        response = await fetchImpl(new URL(path, origin), {
          method: req.method, headers: { accept: '*/*' },
          signal: controller.signal, cache: 'no-store', redirect: 'error'
        });
      } finally { clearTimeout(timer); }
      const max = 16 * 1024 * 1024;
      if (Number(response.headers.get('content-length') || 0) > max) return send(res, 502, 'RESPONSE_TOO_LARGE');
      const body = req.method === 'HEAD' ? Buffer.alloc(0) : Buffer.from(await response.arrayBuffer());
      if (body.length > max) return send(res, 502, 'RESPONSE_TOO_LARGE');
      res.writeHead(response.status, {
        'content-type': response.headers.get('content-type') || 'application/octet-stream',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer'
      });
      res.end(body);
    } catch {
      if (!res.headersSent) send(res, 502, 'PC01_UPSTREAM_UNAVAILABLE');
      else res.end();
    }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.TIGERIQ_VIEW_RELAY_PORT || 8891);
  createViewRelay({ token: process.env.TIGERIQ_VIEW_RELAY_TOKEN }).listen(port, '127.0.0.1', () => {
    console.log('PC01 view-only relay ready at 127.0.0.1:' + port);
  });
}
