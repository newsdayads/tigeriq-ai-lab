import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const HOST = process.env.TIGERIQ_WEB_CONTROL_HOST?.trim() || '127.0.0.1';
const PORT = Number(process.env.TIGERIQ_WEB_CONTROL_PORT || 8796);
const CORE_URL = (process.env.TIGERIQ_CORE_URL?.trim() || 'http://127.0.0.1:8795').replace(/\/$/, '');
const html = readFileSync(new URL('./web-control.html', import.meta.url), 'utf8');

const securityHeaders = {
  'cache-control': 'no-store, max-age=0',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
};

async function upstream(path, timeoutMs = 3000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(CORE_URL + path, { signal: controller.signal, cache: 'no-store' });
    const text = await response.text();
    return { status: response.status, contentType: response.headers.get('content-type') || 'application/json', text };
  } finally {
    clearTimeout(timer);
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  for (const [key, value] of Object.entries(securityHeaders)) res.setHeader(key, value);
  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/web-control')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(html);
    }
    if (req.method === 'GET' && url.pathname === '/api/status') {
      const response = await upstream('/api/status', 4000);
      res.writeHead(response.status, { 'content-type': response.contentType });
      return res.end(response.text);
    }
    if (req.method === 'GET' && url.pathname === '/health') {
      let core = { ok: false };
      try {
        const response = await upstream('/health', 1500);
        core = response.status === 200 ? JSON.parse(response.text) : { ok: false, status: response.status };
      } catch (error) {
        core = { ok: false, error: String(error?.name === 'AbortError' ? 'CORE_TIMEOUT' : error?.message || error) };
      }
      const ok = core?.ok === true;
      res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok, service: 'tigeriq-web-control', host: HOST, port: PORT, core }));
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('not_found');
  } catch (error) {
    res.writeHead(502, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: false, error: String(error?.name === 'AbortError' ? 'CORE_TIMEOUT' : error?.message || error) }));
  }
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(PORT, HOST, resolve);
});
console.log(JSON.stringify({ event: 'TIGERIQ_WEB_CONTROL_STARTED', host: HOST, port: PORT, coreUrl: CORE_URL, pid: process.pid }));

process.on('SIGINT', () => server.close());
process.on('SIGTERM', () => server.close());
