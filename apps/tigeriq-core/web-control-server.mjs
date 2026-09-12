import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const HOST = process.env.TIGERIQ_WEB_CONTROL_HOST?.trim() || '127.0.0.1';
const PORT = Number(process.env.TIGERIQ_WEB_CONTROL_PORT || 8796);
const CORE_URL = (process.env.TIGERIQ_CORE_URL?.trim() || 'http://127.0.0.1:8795').replace(/\/$/, '');
const CODING_URL = (process.env.TIGERIQ_CODING_LANE_URL?.trim() || CORE_URL.replace(/:8795$/, ':8797')).replace(/\/$/, '');
const baseHtml = readFileSync(new URL('./web-control.html', import.meta.url), 'utf8');
const truthJs = readFileSync(new URL('./web-control-truth.js', import.meta.url), 'utf8');
const html = baseHtml.replace('</body>', '<script src="/web-control-truth.js"></script></body>');

const securityHeaders = {
  'cache-control': 'no-store, max-age=0',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
};

async function upstream(baseUrl, pathname, timeoutMs = 3000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(baseUrl + pathname, { signal: controller.signal, cache: 'no-store' });
    const text = await response.text();
    return { status: response.status, contentType: response.headers.get('content-type') || 'application/json', text };
  } finally {
    clearTimeout(timer);
  }
}

function safeJson(text, fallback = {}) {
  try { return JSON.parse(text); } catch { return fallback; }
}

async function codingStatus() {
  try {
    const response = await upstream(CODING_URL, '/api/status', 3000);
    if (response.status !== 200) return { ok: false, status: response.status };
    const data = safeJson(response.text, null);
    return data && typeof data === 'object' ? data : { ok: false, error: 'CODING_INVALID_JSON' };
  } catch (error) {
    return { ok: false, error: String(error?.name === 'AbortError' ? 'CODING_TIMEOUT' : error?.message || error) };
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
    if (req.method === 'GET' && url.pathname === '/web-control-truth.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      return res.end(truthJs);
    }
    if (req.method === 'GET' && url.pathname === '/api/status') {
      const coreResponse = await upstream(CORE_URL, '/api/status', 4000);
      if (coreResponse.status !== 200) {
        res.writeHead(coreResponse.status, { 'content-type': coreResponse.contentType });
        return res.end(coreResponse.text);
      }
      const core = safeJson(coreResponse.text, null);
      if (!core || typeof core !== 'object') {
        res.writeHead(502, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'CORE_INVALID_JSON' }));
      }
      const codingLane = await codingStatus();
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ...core, codingLane }));
    }
    if (req.method === 'GET' && url.pathname === '/health') {
      let core = { ok: false };
      try {
        const response = await upstream(CORE_URL, '/health', 1500);
        core = response.status === 200 ? safeJson(response.text, { ok: false }) : { ok: false, status: response.status };
      } catch (error) {
        core = { ok: false, error: String(error?.name === 'AbortError' ? 'CORE_TIMEOUT' : error?.message || error) };
      }
      let coding = { ok: false };
      try {
        const response = await upstream(CODING_URL, '/health', 1500);
        coding = response.status === 200 ? safeJson(response.text, { ok: false }) : { ok: false, status: response.status };
      } catch (error) {
        coding = { ok: false, error: String(error?.name === 'AbortError' ? 'CODING_TIMEOUT' : error?.message || error) };
      }
      const ok = core?.ok === true;
      res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok, service: 'tigeriq-web-control', host: HOST, port: PORT, core, coding }));
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
console.log(JSON.stringify({ event: 'TIGERIQ_WEB_CONTROL_STARTED', host: HOST, port: PORT, coreUrl: CORE_URL, codingUrl: CODING_URL, pid: process.pid }));

process.on('SIGINT', () => server.close());
process.on('SIGTERM', () => server.close());
