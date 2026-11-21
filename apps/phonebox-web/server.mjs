// TigerIQ PhoneBox web gateway: reuses the installed PhoneBox UI, never copies or alters Note8 settings.
// PC01 only. Two loopback listeners; wildcard Cloudflare router handles public HTTPS.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { URLSearchParams } from 'node:url';

const VIEW_PORT = Number(process.env.PB_VIEW_PORT || 8924);
const ADMIN_PORT = Number(process.env.PB_ADMIN_PORT || 8925);
const UPSTREAM = { hostname: '127.0.0.1', port: Number(process.env.PB_AGENT_PORT || 8765) };
const AUTH_FILE = process.env.PB_AUTH_FILE || 'D:\\TigerIQ\\Secrets\\phonebox-web-auth.json';
const HOSTS = { view: 'pc01.tigeriq.io.vn', admin: 'phonebox.tigeriq.io.vn' };
const COOKIE = { view: '__Host-pbview', admin: '__Host-pbadmin' };
const MAX_BODY = 1048576;
const LOGIN_USER = 'Administrator';
const TTL_MS = 7 * 86400000;
const fails = new Map();
let secrets;

function loadSecrets() {
  const obj = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
  if (!/^[a-f0-9]{32,}$/.test(obj.salt) || !/^[a-f0-9]{64}$/.test(obj.hash) ||
      !/^[a-f0-9]{64,}$/.test(obj.sessionSecret)) throw new Error('INVALID_AUTH_FILE');
  return obj;
}
function equal(a, b) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function verifyPassword(pass) {
  const digest = crypto.pbkdf2Sync(pass, Buffer.from(secrets.salt, 'hex'), 310000, 32, 'sha256').toString('hex');
  return equal(digest, secrets.hash);
}
function token(role) {
  const data = Buffer.from(JSON.stringify({ role, exp: Date.now() + TTL_MS, id: crypto.randomBytes(16).toString('hex') })).toString('base64url');
  return data + '.' + crypto.createHmac('sha256', Buffer.from(secrets.sessionSecret, 'hex')).update(data).digest('base64url');
}
function authenticated(req, role) {
  const match = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE[role] + '='));
  if (!match) return false;
  const val = match.slice(COOKIE[role].length + 1), dot = val.indexOf('.');
  if (dot < 1) return false;
  const data = val.slice(0, dot), sig = val.slice(dot + 1);
  const expected = crypto.createHmac('sha256', Buffer.from(secrets.sessionSecret, 'hex')).update(data).digest('base64url');
  if (!equal(sig, expected)) return false;
  try {
    const obj = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    return obj.role === role && Number.isSafeInteger(obj.exp) && obj.exp > Date.now() && obj.exp < Date.now() + TTL_MS + 60000;
  } catch { return false; }
}
function secureHeaders(res, isLogin = false) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN'); // PhoneBox settings embeds the panel preview
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (isLogin) res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
}
function respond(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type });
  res.end(body);
}
function loginPage(role, bad = false) {
  const title = role === 'admin' ? 'PhoneBox Settings' : 'PC01 Monitor';
  return '<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
    '<title>' + title + '</title><style>*{box-sizing:border-box}body{font-family:system-ui,-apple-system,sans-serif;background:#0b1420;color:#e6f4f5;min-height:100dvh;display:grid;place-items:center;margin:0;padding:22px}main{width:min(100%,380px);padding:32px 26px;background:#152331;border:1px solid #304452;border-radius:20px}h1{font-size:23px;margin:0 0 8px}p{color:#94aab8;font-size:13px;margin:0 0 25px}input,button{width:100%;padding:14px;border-radius:10px;font:inherit}input{background:#0b1724;color:white;border:1px solid #45606c}button{margin-top:14px;border:0;background:#2dd4bf;color:#09221d;font-weight:800}small{display:block;margin-top:12px;color:#fda4af}</style>' +
    '<main><h1>' + title + '</h1><p>TigerIQ · Đăng nhập riêng tư</p><form method="POST" action="/__login"><input type="text" name="username" autocomplete="username" placeholder="Tên đăng nhập" value="Administrator" required maxlength="64" autocapitalize="none" spellcheck="false"><input type="password" name="password" autocomplete="current-password" placeholder="Mật khẩu" required autofocus maxlength="256"><button type="submit">Đăng nhập</button></form>' +
    (bad ? '<small>Mật khẩu không đúng hoặc tạm khóa do thử quá nhiều.</small>' : '') + '</main></html>';
}
function clientKey(req) {
  return String(req.headers['cf-connecting-ip'] || req.socket.remoteAddress || 'unknown').slice(0, 120);
}
function sameOrigin(req, role) {
  const origin = req.headers.origin;
  const site = req.headers['sec-fetch-site'];
  const expected = 'https://' + HOSTS[role];
  if (site === 'cross-site' || (origin && origin !== expected)) return false;
  // Safari/WebKit may report "same-site" for a same-host form submission.
  // Require a verified exact origin (or same-origin Referrer) rather than denying it outright.
  if (site === 'same-site') {
    if (origin === expected) return true;
    try { return new URL(req.headers.referer || '').origin === expected; }
    catch { return false; }
  }
  return true;
}
function allowedView(path) {
  if (path === '/favicon.ico' || path === '/panel' || path.startsWith('/panel/')) return true;
  if (!path.startsWith('/agent/api/')) return false;
  const p = path.slice('/agent/api/'.length);
  const rules = [
    /^state$/, /^stream$/, /^config$/, /^quotas$/, /^work$/, /^work\/conversation$/, /^procs$/, /^procs\/(icon|detail)$/,
    /^apps$/, /^apps\/icon$/, /^shortcuts\/icon$/, /^latency$/, /^calendar$/, /^feeds$/,
    /^photos(?:\/[A-Za-z0-9_-]+)?$/, /^camera$/, /^docker$/, /^ha\/(states|entities)$/,
    /^network\/adapters$/, /^obs$/, /^discord(?:\/img)?$/, /^steam(?:\/avatar)?$/,
    /^batteries$/, /^charge$/, /^spectrum$/, /^art$/, /^push(?:\/[A-Za-z0-9_-]+)?$/,
    /^controls\/(state|listen|radio-logo|obs)$/, /^controls\/radio-directory\/(countries|stations)$/,
    /^controls\/spotify\/state$/
  ];
  return rules.some(r => r.test(p));
}
function allowedAdmin(path, method) {
  if (method === 'GET' || method === 'HEAD') {
    if (path === '/' || path === '/favicon.ico' || path === '/panel' || path.startsWith('/panel/')) return true;
    if (!path.startsWith('/api/')) return false;
    return !/^\/api\/(?:proxy|claude\/hook|codex\/hook|controls\/spotify\/connect|approvals)(?:\/|$)/.test(path);
  }
  if (method === 'PUT' && path === '/api/settings') return true;
  if (method === 'POST' && (path === '/api/settings/shortcut-icon' || /^\/api\/widget\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/note$/.test(path))) return true;
  if (method === 'DELETE' && path === '/api/settings/shortcut-icon') return true;
  return false;
}
function proxy(req, res, role, path) {
  const target = role === 'view' && path.startsWith('/agent/api/') ? path.slice('/agent'.length) : path;
  const headers = { ...req.headers, host: '127.0.0.1:' + UPSTREAM.port, 'accept-encoding': 'identity' };
  delete headers.cookie; delete headers.authorization; delete headers['cf-access-jwt-assertion'];
  delete headers['cf-connecting-ip']; delete headers['x-forwarded-for']; delete headers['x-forwarded-host'];
  delete headers['x-forwarded-proto']; delete headers['content-length']; // set from body stream automatically only when present
  if (req.headers['content-length']) headers['content-length'] = req.headers['content-length'];
  headers.origin = 'http://127.0.0.1:' + UPSTREAM.port;
  headers.referer = 'http://127.0.0.1:' + UPSTREAM.port + '/';
  headers['sec-fetch-site'] = 'same-origin';
  const upstream = http.request({ ...UPSTREAM, path: target + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''), method: req.method, headers, timeout: 15000 }, upstreamRes => {
    const out = { ...upstreamRes.headers };
    delete out['set-cookie']; delete out['content-security-policy']; delete out['transfer-encoding'];
    // Don't expose the origin's private headers or cache sensitive PC state.
    delete out['server'];
    out['cache-control'] = 'no-store';
    out['x-frame-options'] = 'SAMEORIGIN';
    out['x-content-type-options'] = 'nosniff';
    out['referrer-policy'] = 'no-referrer';
    if (out.location?.startsWith('http://127.0.0.1:')) out.location = '/';
    res.writeHead(upstreamRes.statusCode || 502, out);
    upstreamRes.pipe(res);
  });
  upstream.on('timeout', () => upstream.destroy(new Error('AGENT_TIMEOUT')));
  upstream.on('error', () => { if (!res.headersSent) respond(res, 502, 'PhoneBox agent unavailable'); else res.destroy(); });
  req.pipe(upstream);
}
function start(role, port) {
  const server = http.createServer(async (req, res) => {
    secureHeaders(res);
    const host = String(req.headers.host || '').toLowerCase().split(':')[0];
    if (host !== HOSTS[role] && host !== '127.0.0.1' && host !== 'localhost') return respond(res, 421, 'Wrong host');
    let path;
    try { path = new URL(req.url, 'http://localhost').pathname; } catch { return respond(res, 400, 'Bad path'); }
    if (path === '/healthz' && req.method === 'GET') return respond(res, 200, JSON.stringify({ ok: true, service: 'phonebox-web', role }), 'application/json');
    if (path === '/__login' && req.method === 'GET') { secureHeaders(res, true); return respond(res, 200, loginPage(role), 'text/html; charset=utf-8'); }
    if (path === '/__login' && req.method === 'POST') {
      secureHeaders(res, true);
      if (!sameOrigin(req, role)) return respond(res, 403, 'Forbidden');
      const key = role + ':' + clientKey(req), entry = fails.get(key) || { count: 0, until: 0 };
      if (entry.until > Date.now()) return respond(res, 429, loginPage(role, true), 'text/html; charset=utf-8');
      let body = '';
      for await (const chunk of req) {
        body += chunk.toString('utf8');
        if (body.length > 2048) return respond(res, 413, 'Too large');
      }
      const fields = new URLSearchParams(body);
      const user = fields.get('username') || '';
      const pass = fields.get('password') || '';
      if (user === LOGIN_USER && verifyPassword(pass)) {
        fails.delete(key);
        res.setHeader('Set-Cookie', COOKIE[role] + '=' + token(role) + '; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800');
        res.writeHead(303, { Location: role === 'view' ? '/panel/' : '/' });
        return res.end();
      }
      entry.count += 1;
      entry.until = entry.count >= 6 ? Date.now() + 30 * 60000 : 0;
      fails.set(key, entry);
      return respond(res, entry.until ? 429 : 401, loginPage(role, true), 'text/html; charset=utf-8');
    }
    if (!authenticated(req, role)) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return respond(res, 401, 'Login required');
      res.writeHead(303, { Location: '/__login' });
      return res.end();
    }
    if (path === '/__logout' && req.method === 'POST') {
      if (!sameOrigin(req, role)) return respond(res, 403, 'Forbidden');
      res.setHeader('Set-Cookie', COOKIE[role] + '=; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
      res.writeHead(303, { Location: '/__login' }); return res.end();
    }
    if (role === 'view' && path === '/') { res.writeHead(303, { Location: '/panel/' }); return res.end(); }
    if (role === 'view') {
      if (req.method !== 'GET' && req.method !== 'HEAD') return respond(res, 405, 'Read-only dashboard');
      if (!allowedView(path)) return respond(res, 403, 'Read-only endpoint denied');
      if (path.startsWith('/agent/api/widget/') && new URL(req.url, 'http://localhost').searchParams.get('force') === 'true')
        return respond(res, 403, 'Command execution denied');
    } else {
      if (!allowedAdmin(path, req.method)) return respond(res, 403, 'Endpoint denied');
      if (!['GET', 'HEAD'].includes(req.method) && !sameOrigin(req, role)) return respond(res, 403, 'Origin denied');
      if (Number(req.headers['content-length'] || 0) > MAX_BODY) return respond(res, 413, 'Too large');
    }
    proxy(req, res, role, path);
  });
  server.listen(port, '127.0.0.1', () => console.log('PhoneBox ' + role + ' listening on 127.0.0.1:' + port));
  return server;
}
export { allowedView, allowedAdmin, sameOrigin, LOGIN_USER };
if (process.env.PB_NO_LISTEN !== '1') {
  secrets = loadSecrets();
  start('view', VIEW_PORT);
  start('admin', ADMIN_PORT);
}
