// Read-only API Health viewing gateway for remote display. Never proxy write methods or Core control routes.
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createPcOperatorMcpHandler } from './pc-operator-mcp.mjs';
import { createOAuthResourceServer, oauthRuntimeConfig } from './pc-operator-oauth-runtime.mjs';

export const DISPLAY_PATHS = new Set([
  '/', '/work-ui.css', '/work-center-visual.css', '/work-center.js',
  '/api/status', '/api/live-status', '/api/health-live-work', '/api/work-history',
]);
function authorized(provided, secret) {
  const a = Buffer.from(String(provided || '').replace(/^Bearer\s+/i, ''));
  const b = Buffer.from(secret || '');
  return b.length >= 32 && a.length === b.length && timingSafeEqual(a, b);
}
export function createHealthViewGateway({ secret = process.env.TIGERIQ_HEALTH_VIEW_KEY,
  core = 'http://127.0.0.1:8795', fetchImpl = fetch,
  mcpHandler = null, oauthRuntime = null } = {}) {
  const oauth = oauthRuntime || createOAuthResourceServer({ config: oauthRuntimeConfig(), fetchImpl });
  const effectiveMcpHandler = mcpHandler || createPcOperatorMcpHandler({ oauthVerifier: oauth });
  if (!secret || String(secret).length < 32) throw Error('HEALTH_VIEW_KEY_REQUIRED');
  return createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname === '/.well-known/oauth-protected-resource/mcp') {
      if (!oauth.configured()) { res.writeHead(503, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: false, reason: 'OAUTH_RUNTIME_NOT_CONFIGURED' })); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(oauth.protectedMetadata()));
      return;
    }
    if (url.pathname === '/.well-known/oauth-authorization-server') {
      if (!oauth.configured()) { res.writeHead(503, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: false, reason: 'OAUTH_RUNTIME_NOT_CONFIGURED' })); return; }
      try {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(oauth.authorizationMetadata()));
      } catch {
        res.writeHead(503, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: false, reason: 'OAUTH_AUTHORIZATION_METADATA_INCOMPLETE' }));
      }
      return;
    }
    if (url.pathname.startsWith('/mcp')) {
      const handled = await effectiveMcpHandler(req, res, url);
      if (handled) return;
    }
    if (req.method !== 'GET') { res.writeHead(405, { Allow:'GET' }); res.end(); return; }
    if (!authorized(req.headers.authorization, secret)) { res.writeHead(401); res.end('unauthorized'); return; }
    if (!DISPLAY_PATHS.has(url.pathname)) { res.writeHead(404); res.end('not_found'); return; }
    if (url.pathname === '/api/work-history' && !/^[1-9]\d{0,7}$/.test(url.searchParams.get('number') || '')) {
      res.writeHead(400); res.end('invalid_number'); return;
    }
    const upstream = new URL(url.pathname, core);
    if (url.pathname === '/api/work-history') upstream.searchParams.set('number', url.searchParams.get('number'));
    try {
      const response = await fetchImpl(upstream.href, {
        method:'GET', headers: { accept:'*/*' }, redirect:'error',
        signal:AbortSignal.timeout(10000), cache:'no-store',
      });
      const body = Buffer.from(await response.arrayBuffer());
      if (body.length > 5 * 1024 * 1024) { res.writeHead(502); res.end('upstream_too_large'); return; }
      res.writeHead(response.status, {
        'Content-Type': response.headers.get('content-type') || 'application/octet-stream',
        'Content-Length': String(body.length),
      });
      res.end(body);
    } catch {
      res.writeHead(502, {'Content-Type':'text/plain; charset=utf-8'});
      res.end('PC01_UNAVAILABLE');
    }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.TIGERIQ_HEALTH_VIEW_PORT || 8802);
  createHealthViewGateway().listen(port, '127.0.0.1', () => {
    console.log('TigerIQ API Health read-only view gateway listening on 127.0.0.1:' + port);
  });
}
