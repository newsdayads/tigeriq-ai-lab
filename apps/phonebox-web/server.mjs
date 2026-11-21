// TigerIQ PhoneBox web bridge: two authenticated loopback-only frontends.
// Source panel assets are taken unchanged from ersinkoc/phonebox v0.9.26 (MIT).
// Never publish the original agent's unprotected :8765 service.
import { createServer, request as httpRequest } from 'node:http';
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { resolve, sep, extname, join } from 'node:path';
import { pbkdf2Sync, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const panelRoot = resolve(process.env.PHONEBOX_PANEL_ROOT || join(fileURLToPath(new URL('.', import.meta.url)), 'upstream', 'android', 'app', 'src', 'main', 'assets', 'www'));
const authFile = process.env.PHONEBOX_WEB_AUTH_FILE;
const dashboardPort = Number(process.env.PHONEBOX_VIEW_PORT || 8931);
const adminPort = Number(process.env.PHONEBOX_ADMIN_PORT || 8932);
const adminHost = 'phonebox.tigeriq.io.vn';
const viewHost = 'pc01.tigeriq.io.vn';
const maxBody = 2 * 1024 * 1024;
const sessions = new Map();
const failures = new Map();
const auth = authFile ? JSON.parse(readFileSync(authFile, 'utf8')) : null;
if (!auth || auth.method !== 'pbkdf2-sha256' || !/^[a-f0-9]{32}$/.test(auth.salt) || !/^[a-f0-9]{64}$/.test(auth.hash) || auth.iterations < 200000) throw new Error('AUTH_FILE_REQUIRED');
const secretSalt = Buffer.from(auth.salt, 'hex');
const expectedHash = Buffer.from(auth.hash, 'hex');
const sessionsMaxMs = 7 * 86400 * 1000;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.mp3': 'audio/mpeg' };

function headers(res, type = 'text/plain; charset=utf-8') {
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}
function respond(res, code, data, type) {
  headers(res, type);
  res.statusCode = code;
  res.end(data);
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function loginHtml(mode, error) {
  const title = mode === 'admin' ? 'PhoneBox · Điều khiển' : 'PC01 · Theo dõi';
  return '<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><title>' + esc(title) + '</title><style>*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;font-family:system-ui,sans-serif;background:#0b1320;color:#edf7fa;padding:20px}.card{max-width:360px;width:100%;background:#142433;border:1px solid #294052;border-radius:20px;padding:30px}h1{margin:5px 0 7px;font-size:24px}p{font-size:13px;color:#9db1c0;margin-bottom:24px}.logo{color:#5ce8cb;font-size:12px;font-weight:800;letter-spacing:.15em}input{background:#091521;border:1px solid #425461;color:#fff;font:inherit;padding:14px;width:100%;border-radius:10px}button{background:#2dd4bf;color:#082020;border:0;font-size:15px;font-weight:750;width:100%;padding:14px;border-radius:10px;margin-top:12px}.err{color:#ffaca6;margin:12px 0;font-size:13px}.hint{margin-top:20px;color:#9db1c0;font-size:11px}</style><div class="card"><div class="logo">TIGERIQ / PHONEBOX</div><h1>' + esc(title) + '</h1><p>Đăng nhập để sử dụng trên iPhone.</p><form method="POST" action="/login" autocomplete="on"><input type="password" name="password" placeholder="Mật khẩu truy cập" autocomplete="current-password" required autofocus maxlength="128"><button type="submit">Đăng nhập</button></form>' + (error ? '<div class="err">Mật khẩu không đúng hoặc tạm giới hạn thử lại.</div>' : '') + '<div class="hint">Kết nối HTTPS · PC01</div></div></html>';
}
function remoteId(req) {
  const cf = req.headers['cf-connecting-ip'];
  const candidate = typeof cf === 'string' ? cf : req.socket.remoteAddress || 'local';
  return createHash('sha256').update(candidate).digest('hex');
}
function verifiedSession(req) {
  const cookie = (req.headers.cookie || '').split(';').map((x) => x.trim()).find((x) => x.startsWith('pb_access='));
  if (!cookie) return false;
  const token = cookie.slice('pb_access='.length);
  if (!/^[a-f0-9]{64}$/.test(token)) return false;
  const s = sessions.get(token);
  if (!s || s.until < Date.now()) { sessions.delete(token); return false; }
  return true;
}
function usePassword(pwd) {
  const v = pbkdf2Sync(pwd, secretSalt, auth.iterations, 32, 'sha256');
  return timingSafeEqual(expectedHash, v);
}
function readBody(req, max = 2048) {
  return new Promise((resolveBody, reject) => {
    const pieces = []; let len = 0;
    req.on('data', (b) => { len += b.length; if (len > max) { reject(new Error('BODY_TOO_LARGE')); req.destroy(); } else pieces.push(b); });
    req.on('end', () => resolveBody(Buffer.concat(pieces).toString('utf8')));
    req.on('error', reject);
  });
}
function sensitive(k) {
  return /(?:password|secret|token|credential|api.?key|private.?key|pair.?key|webhook.?token|cert(?:ificate)?(?:path|key)?)/i.test(k);
}
export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const result = {};
    for (const [k, v] of Object.entries(value)) if (!sensitive(k)) result[k] = redact(v);
    return result;
  }
  return value;
}
const viewRoutes = new Set(['/api/config', '/api/state', '/api/quotas', '/api/work', '/api/procs', '/api/push', '/api/batteries', '/api/calendar', '/api/controls/state', '/api/feeds', '/api/docker', '/api/apps', '/api/steam', '/api/obs', '/api/discord', '/api/media/state', '/api/ha/states']);
export function viewAllowed(method, urlPath) {
  return method === 'GET' && (viewRoutes.has(urlPath) || urlPath === '/api/procs/detail');
}
function sameOrigin(req, mode) {
  const expected = 'https://' + (mode === 'admin' ? adminHost : viewHost);
  const origin = req.headers.origin || '';
  return origin === expected || (origin === '' && req.headers.referer?.startsWith(expected + '/'));
}
function serveAsset(req, res, path) {
  const name = path === '/' ? '/index.html' : path;
  let clean;
  try { clean = decodeURIComponent(name); } catch { return respond(res, 400, 'Bad path'); }
  if (clean.includes('\0') || clean.includes('\\')) return respond(res, 400, 'Bad path');
  const file = resolve(panelRoot, '.' + clean);
  if (!file.startsWith(panelRoot + sep)) return respond(res, 403, 'Forbidden');
  try {
    const st = statSync(file);
    if (!st.isFile()) return respond(res, 404, 'Not found');
    headers(res, (mime[extname(file).toLowerCase()] || 'application/octet-stream') + (['.js', '.css', '.html', '.json', '.svg'].includes(extname(file).toLowerCase()) ? '; charset=utf-8' : ''));
    res.setHeader('Content-Length', st.size);
    createReadStream(file).on('error', () => { if (!res.headersSent) respond(res, 500, 'File error'); else res.destroy(); }).pipe(res);
  } catch { respond(res, 404, 'Not found'); }
}
function proxy(req, res, mode, originalPath) {
  if (mode === 'view' && !viewAllowed(req.method, originalPath)) return respond(res, 405, 'Read only');
  const clientUrl = new URL(req.url, 'http://127.0.0.1');
  if (mode === 'admin' && req.method !== 'GET' && !sameOrigin(req, mode)) return respond(res, 403, 'Origin rejected');
  if (mode === 'admin' && Number(req.headers['content-length'] || '0') > maxBody) return respond(res, 413, 'Too large');
  const path = (mode === 'view' ? originalPath : clientUrl.pathname) + clientUrl.search;
  const outbound = httpRequest({ hostname: '127.0.0.1', port: 8765, path, method: req.method, headers: { accept: req.headers.accept || '*/*', 'content-type': req.headers['content-type'] || 'application/json' }, timeout: 8000 }, (up) => {
    if (mode === 'view' && originalPath === '/api/config') {
      const chunks = []; let total = 0;
      up.on('data', (chunk) => { total += chunk.length; if (total > maxBody) up.destroy(); else chunks.push(chunk); });
      up.on('end', () => {
        try { const object = JSON.parse(Buffer.concat(chunks).toString('utf8')); respond(res, 200, JSON.stringify(redact(object)), 'application/json; charset=utf-8'); }
        catch { respond(res, 502, 'Invalid config'); }
      });
    } else {
      headers(res, up.headers['content-type'] || 'application/octet-stream');
      res.statusCode = up.statusCode || 502;
      up.pipe(res);
    }
  });
  outbound.on('timeout', () => outbound.destroy(new Error('timeout')));
  outbound.on('error', () => { if (!res.headersSent) respond(res, 502, 'PhoneBox unavailable'); else res.destroy(); });
  req.pipe(outbound);
}
async function handler(req, res, mode) {
  let url;
  try { url = new URL(req.url || '/', 'http://127.0.0.1'); } catch { return respond(res, 400, 'Bad request'); }
  const pathname = url.pathname;
  if (pathname === '/healthz' && req.method === 'GET') return respond(res, 200, 'ok', 'text/plain; charset=utf-8');
  if (pathname === '/login' && req.method === 'POST') {
    const id = remoteId(req);
    const now = Date.now();
    const rate = failures.get(id) || { n: 0, until: now + 900000 };
    if (rate.until < now) { rate.n = 0; rate.until = now + 900000; }
    if (rate.n >= 6) return respond(res, 429, loginHtml(mode, true), 'text/html; charset=utf-8');
    let body;
    try { body = await readBody(req); } catch { return respond(res, 400, 'Bad body'); }
    const pwd = new URLSearchParams(body).get('password') || '';
    if (!usePassword(pwd)) {
      rate.n++; failures.set(id, rate);
      return respond(res, 401, loginHtml(mode, true), 'text/html; charset=utf-8');
    }
    failures.delete(id);
    const token = randomBytes(32).toString('hex');
    sessions.set(token, { until: now + sessionsMaxMs });
    if (sessions.size > 200) for (const [k, v] of sessions) if (v.until < now || sessions.size > 160) sessions.delete(k);
    res.statusCode = 303;
    headers(res);
    res.setHeader('Set-Cookie', 'pb_access=' + token + '; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800');
    res.setHeader('Location', '/');
    return res.end();
  }
  if (pathname === '/login' && req.method === 'GET') return respond(res, 200, loginHtml(mode, false), 'text/html; charset=utf-8');
  if (!verifiedSession(req)) {
    if (pathname.startsWith('/api/') || pathname.startsWith('/agent/')) return respond(res, 401, 'Login required');
    return respond(res, 200, loginHtml(mode, false), 'text/html; charset=utf-8');
  }
  if (pathname === '/logout' && req.method === 'POST') {
    if (!sameOrigin(req, mode)) return respond(res, 403, 'Origin rejected');
    const c = (req.headers.cookie || '').match(/pb_access=([a-f0-9]{64})/);
    if (c) sessions.delete(c[1]);
    headers(res);
    res.statusCode = 303;
    res.setHeader('Set-Cookie', 'pb_access=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict');
    res.setHeader('Location', '/login');
    return res.end();
  }
  if (mode === 'view') {
    if (pathname.startsWith('/agent/api/')) return proxy(req, res, mode, pathname.slice('/agent'.length));
    if (pathname.startsWith('/api/')) return respond(res, 404, 'Not found');
    if (req.method !== 'GET') return respond(res, 405, 'Read only');
    return serveAsset(req, res, pathname);
  }
  // The full original settings UI is reverse-proxied only after authentication.
  if (pathname.startsWith('/agent/')) return respond(res, 404, 'Not found');
  return proxy(req, res, mode, pathname);
}
export function createApplication(mode) {
  return createServer((req, res) => { handler(req, res, mode).catch(() => { if (!res.headersSent) respond(res, 500, 'Internal error'); else res.destroy(); }); });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createApplication('view').listen(dashboardPort, '127.0.0.1', () => process.stdout.write('PhoneBox view listening ' + dashboardPort + '\n'));
  createApplication('admin').listen(adminPort, '127.0.0.1', () => process.stdout.write('PhoneBox admin listening ' + adminPort + '\n'));
}
