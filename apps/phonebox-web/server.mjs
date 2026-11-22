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
// Temporary owner-requested direct access: display-only, never publish machine controls or secrets.
// Set PB_PUBLIC_READONLY=0 only after restoring a separately authenticated access policy.
const PUBLIC_READ_ONLY = process.env.PB_PUBLIC_READONLY !== '0';
// User-requested login-free widget editor, without exposing PC controls or other agent settings.
const PUBLIC_WIDGET_EDIT = PUBLIC_READ_ONLY && process.env.PB_PUBLIC_WIDGET_EDIT !== '0';
const widgetSaveTimes = new Map();
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
function makeLoginCsrf(role) {
  const payload = Buffer.from(JSON.stringify({
    role, issued: Date.now(), nonce: crypto.randomBytes(16).toString('hex')
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', Buffer.from(secrets.sessionSecret, 'hex'))
    .update('phonebox-login.' + payload).digest('base64url');
  return payload + '.' + sig;
}
function validLoginCsrf(value, role) {
  if (typeof value !== 'string' || value.length > 512) return false;
  const [payload, signature, extra] = value.split('.');
  if (!payload || !signature || extra !== undefined) return false;
  const expected = crypto.createHmac('sha256', Buffer.from(secrets.sessionSecret, 'hex'))
    .update('phonebox-login.' + payload).digest('base64url');
  if (!equal(signature, expected)) return false;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const age = Date.now() - decoded.issued;
    return decoded.role === role && typeof decoded.nonce === 'string' &&
      decoded.nonce.length === 32 && Number.isSafeInteger(age) && age >= 0 && age <= 86400000;
  } catch { return false; }
}
function acceptLoginOrigin(req, role, csrf) {
  if (sameOrigin(req, role)) return true;
  // Safari can send same-site without Origin/Referer: the login page sets no-referrer.
  // Only accept this case with a valid HMAC-signed form token.
  return req.headers['sec-fetch-site'] === 'same-site' &&
    !req.headers.origin && !req.headers.referer && validLoginCsrf(csrf, role);
}
function loginPage(role, bad = false) {
  const title = role === 'admin' ? 'PhoneBox Settings' : 'PC01 Monitor';
  return '<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
    '<title>' + title + '</title><style>*{box-sizing:border-box}body{font-family:system-ui,-apple-system,sans-serif;background:#0b1420;color:#e6f4f5;min-height:100dvh;display:grid;place-items:center;margin:0;padding:22px}main{width:min(100%,380px);padding:32px 26px;background:#152331;border:1px solid #304452;border-radius:20px}h1{font-size:23px;margin:0 0 8px}p{color:#94aab8;font-size:13px;margin:0 0 25px}input,button{width:100%;padding:14px;border-radius:10px;font:inherit}input{background:#0b1724;color:white;border:1px solid #45606c}input + input{margin-top:12px}button{margin-top:14px;border:0;background:#2dd4bf;color:#09221d;font-weight:800}small{display:block;margin-top:12px;color:#fda4af}</style>' +
    '<main><h1>' + title + '</h1><p>TigerIQ · Đăng nhập riêng tư</p><form method="POST" action="/__login"><input type="hidden" name="csrf" value="' + makeLoginCsrf(role) + '"><input type="text" name="username" autocomplete="username" placeholder="Tên đăng nhập" value="Administrator" required maxlength="64" autocapitalize="none" spellcheck="false"><input type="password" name="password" autocomplete="current-password" placeholder="Mật khẩu" required autofocus maxlength="256"><button type="submit">Đăng nhập</button></form>' +
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

const PUBLIC_METRICS = new Set(['cpu', 'gpu', 'ram', 'net', 'cputemp', 'gputemp', 'gpupower', 'down', 'up', 'ping']);
function finiteNumber(n) { return typeof n === 'number' && Number.isFinite(n) ? n : null; }
function safePageWidget(w, index) {
  if (!w || !['clock', 'stat', 'chart', 'meters'].includes(w.type)) return null;
  const int = (n, fallback, max) => Number.isInteger(n) && n >= 0 && n <= max ? n : fallback;
  const item = {
    id: 'public-' + index, type: w.type,
    x: int(w.x, 0, 12), y: int(w.y, 0, 12),
    w: int(w.w, 3, 12), h: int(w.h, 2, 12),
    options: {}
  };
  if (w.type === 'clock') item.options = { status: false, weather: false };
  if (w.type === 'stat' && PUBLIC_METRICS.has(w.options?.metric))
    item.options = { metric: w.options.metric };
  if (w.type === 'chart')
    item.options = { metrics: Array.isArray(w.options?.metrics)
      ? w.options.metrics.filter(m => PUBLIC_METRICS.has(m)).slice(0, 6) : [] };
  return item;
}
function safePublicConfig(raw) {
  const c = raw?.config || {};
  const source = Array.isArray(c.pages) ? c.pages : [];
  const pages = ['home', 'system'].map(id => {
    const page = source.find(p => p.id === id);
    const widgets = (Array.isArray(page?.widgets) ? page.widgets : [])
      .map(safePageWidget).filter(Boolean);
    return { id, title: id === 'home' ? 'Home' : 'System',
      icon: id === 'home' ? 'home' : 'activity',
      enabled: true, idleSec: 0, widgets };
  }).filter(p => p.widgets.length);
  if (!pages.length) pages.push({ id: 'home', title: 'Home', icon: 'home', enabled: true,
    widgets: [{ id: 'clock-public', type: 'clock', x: 0, y: 0, w: 12, h: 6, options: { status: false, weather: false } }] });
  return { version: 'public-readonly-1', config: {
    pages, shortcuts: [], rules: [], cameras: [],
    display: { language: 'vi', theme: 'default', accent: '#2dd4bf',
      hour12: false, showSeconds: true, orientation: 'portrait',
      appearance: { border: true, shadow: false } }
  }};
}
function safePublicState(raw) {
  const p = raw?.pc || {}, g = p.gpu || {};
  const disks = Array.isArray(p.disks) ? p.disks.slice(0, 8).map((disk, i) => ({
    name: 'Disk ' + (i + 1), usedGb: finiteNumber(disk?.usedGb), totalGb: finiteNumber(disk?.totalGb)
  })) : [];
  return {
    ts: Date.now(), host: 'PC01', os: 'windows', cfgVersion: 'public-readonly-1',
    events: [], evSeq: 0, pc: {
      cpu: finiteNumber(p.cpu), cpuTemp: finiteNumber(p.cpuTemp),
      ramUsedGb: finiteNumber(p.ramUsedGb), ramTotalGb: finiteNumber(p.ramTotalGb),
      gpu: { util: finiteNumber(g.util), temp: finiteNumber(g.temp),
        power: finiteNumber(g.power), powerLimit: finiteNumber(g.powerLimit) },
      netDownBps: finiteNumber(p.netDownBps), netUpBps: finiteNumber(p.netUpBps),
      disks, uptimeSec: finiteNumber(p.uptimeSec)
    }
  };
}
function readAgentJson(pathname) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    const req = http.get({ ...UPSTREAM, path: pathname, timeout: 6000,
      headers: { 'X-PhoneBox-Panel': '1' } }, incoming => {
      if (incoming.statusCode !== 200) {
        incoming.resume();
        reject(new Error('UPSTREAM_STATUS')); return;
      }
      incoming.on('data', chunk => {
        total += chunk.length;
        if (total > 2 * 1024 * 1024) { req.destroy(new Error('UPSTREAM_TOO_BIG')); return; }
        chunks.push(chunk);
      });
      incoming.once('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reject(new Error('UPSTREAM_INVALID_JSON')); }
      });
      incoming.once('error', reject);
    });
    req.once('timeout', () => req.destroy(new Error('UPSTREAM_TIMEOUT')));
    req.once('error', reject);
  });
}

const ORIGINAL_PAGE_NAMES = Object.freeze({
  home: ['Home', '🏠'], ai: ['AI quotas', '✳'],
  work: ['Sessions', '▣'], system: ['System', '▥'],
  procs: ['Processes', '⚙'], deck: ['Shortcuts', '☷'],
  music: ['Music', '♫'], focus: ['Focus', '◷'], world: ['World', '◎']
});
const EDITOR_WIDGET_TYPES = new Set([
  'clock', 'media', 'stat', 'quotas', 'sessions', 'github',
  'chart', 'meters', 'processes', 'shortcuts', 'forecast',
  'pomodoro', 'note', 'worldclock', 'calendar'
]);
function safePublicEditorSettings(raw) {
  const config = raw?.config || {};
  const source = Array.isArray(config.pages) ? config.pages : [];
  const pages = source.filter(page => Object.hasOwn(ORIGINAL_PAGE_NAMES, page?.id)).map(page => ({
    id: page.id,
    title: ORIGINAL_PAGE_NAMES[page.id][0],
    icon: ORIGINAL_PAGE_NAMES[page.id][1],
    enabled: page.enabled !== false,
    idleSec: 0,
    widgets: (Array.isArray(page.widgets) ? page.widgets : [])
      .filter(w => EDITOR_WIDGET_TYPES.has(w?.type)).slice(0, 30)
      .map((w, i) => {
        const scrubbed = safePageWidget(w, i) || {
          id: 'readonly-' + page.id + '-' + i,
          type: w.type,
          x: Number.isInteger(w.x) && w.x >= 0 && w.x < 12 ? w.x : 0,
          y: Number.isInteger(w.y) && w.y >= 0 && w.y < 6 ? w.y : 0,
          w: Number.isInteger(w.w) && w.w > 0 && w.w <= 12 ? w.w : 2,
          h: Number.isInteger(w.h) && w.h > 0 && w.h <= 6 ? w.h : 2,
          options: {}
        };
        return { ...scrubbed, id: 'readonly-' + page.id + '-' + i,
          appearance: {}, options: scrubbed.options || {} };
      })
  }));
  if (!pages.length) pages.push({
    id: 'home', title: 'Home', icon: '⌂', enabled: true, idleSec: 0,
    widgets: [{ id: 'readonly-clock', type: 'clock', x: 0, y: 0,
      w: 12, h: 5, options: {}, appearance: {} }]
  });
  return {
    pages, shortcuts: [], rules: [], phones: [], calendars: [], feeds: [],
    cameras: { sources: [], ffmpeg: '' }, console: { profiles: [] },
    lan: { enabled: true, port: 8766, token: '', webhookToken: '' },
    weather: { unit: 'celsius' }, photos: { source: 'folder', folder: '' },
    ping: { adapters: [] }, night: { enabled: false },
    updates: { auto: false, repo: 'ersinkoc/phonebox' },
    claude: { phoneApprovals: false },
    opencode: { phoneApprovals: false, sessions: false },
    cursor: {}, antigravity: {}, charge: { enabled: false },
    homeAssistant: {}, obs: {}, discord: {}, steam: { enabled: false },
    codexBar: { providers: [], rotate: false },
    display: { language: 'vi', orientation: 'landscape', theme: 'default',
      accent: '#2dd4bf', showSeconds: true, hour12: false }
  };
}
function safeSettingsInfo(info) {
  return {
    version: typeof info?.version === 'string' && /^[0-9.]+$/.test(info.version) ? info.version : '0.9',
    os: 'windows', configPath: 'PC01 (local)', logPath: 'PC01 (local)',
    adb: info?.adb ? 'ADB kết nối nội bộ' : null,
    connected: info?.connected === true,
    via: info?.via === 'USB' ? 'USB' : info?.via === 'Wi-Fi' ? 'Wi-Fi' : null,
    devices: [], appMissing: [], usbProblem: null, webviewProblem: null
  };
}
function originalSettingsReadOnlyHtml(html) {
  if (!/<html\b/i.test(html) || !/<body\b/i.test(html)) throw new Error('UPSTREAM_NOT_HTML');
  // Serve the installed upstream settings UI, with only a read-only notice and disabled write buttons.
  const extraCss = '<style id="tigeriq-readonly-style">' +
    '#openPhone,#restartBtn,#updTop,#updApply,#updCheck,#lanPair,#lanRegen,#installApp{display:none!important}' +
    '#tigeriq-readonly{padding:9px 16px;text-align:center;background:#193435;color:#d2faf4;' +
    'border-bottom:1px solid #2dd4bf;font:600 13px system-ui,sans-serif}' +
    '</style>';
  const banner = '<div id="tigeriq-readonly" role="status">PhoneBox gốc trên PC01 · Sửa và lưu bố cục widget trực tiếp · Các lệnh điều khiển hệ thống vẫn bị khóa</div>';
  return html.replace(/<\/head>/i, extraCss + '</head>')
    .replace(/<body([^>]*)>/i, (_, attrs) => '<body' + attrs + '>' + banner);
}
function readAgentText(pathname) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    const req = http.get({ ...UPSTREAM, path: pathname, timeout: 7000 }, response => {
      if (response.statusCode !== 200) {
        response.resume(); reject(new Error('UPSTREAM_HTML_STATUS')); return;
      }
      response.on('data', piece => {
        total += piece.length;
        if (total > 1024 * 1024) { req.destroy(new Error('HTML_TOO_LARGE')); return; }
        chunks.push(piece);
      });
      response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      response.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('HTML_TIMEOUT')));
    req.on('error', reject);
  });
}

function safeText(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
}
function publicSettingsHtml(config, state) {
  const pages = config.config.pages.map(p => '<li><b>' + safeText(p.title) +
    '</b><span>' + p.widgets.length + ' widget</span></li>').join('');
  const pc = state.pc || {};
  const pct = n => n == null ? '—' : Math.round(n) + '%';
  return '<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>PhoneBox — PC01</title><style>*{box-sizing:border-box}body{margin:0;padding:22px;font-family:system-ui,-apple-system,sans-serif;background:#0b1420;color:#e8f6f7}main{max-width:950px;margin:auto}h1{font-size:clamp(24px,5vw,36px);margin:20px 0 6px}p{color:#a7bdc4;line-height:1.6}a{color:#081c1e;background:#2dd4bf;padding:12px 18px;text-decoration:none;display:inline-block;border-radius:12px;font-weight:700}section{margin:18px 0;background:#172633;border:1px solid #34505d;border-radius:18px;padding:22px}ul{list-style:none;margin:10px 0;padding:0}li{display:flex;justify-content:space-between;gap:12px;padding:13px 2px;border-bottom:1px solid #2a414b}li:last-child{border:0}li span,.muted{color:#9fbdc7}.metric{display:flex;gap:24px;flex-wrap:wrap}.metric b{font-size:28px;display:block}iframe{width:100%;height:560px;border:1px solid #34505d;border-radius:12px;background:#081520}@media(max-width:600px){body{padding:12px}section{padding:16px}iframe{height:440px}}</style>' +
    '<main><h1>PhoneBox Settings</h1><p>PC01 · Truy cập trực tiếp — xem trạng thái và bố cục hiện tại</p>' +
    '<p class="muted">Chế độ tạm thời chỉ xem. Chức năng chỉnh sửa và lệnh điều khiển PC01 không được mở công khai.</p>' +
    '<a href="https://pc01.tigeriq.io.vn/">Xem bảng điều khiển PC01</a>' +
    '<section><h2>Hệ thống</h2><div class="metric"><div><b>' + pct(pc.cpu) + '</b><span class="muted">CPU</span></div><div><b>' +
    (pc.ramUsedGb == null || pc.ramTotalGb == null ? '—' : pct(pc.ramUsedGb * 100 / pc.ramTotalGb)) +
    '</b><span class="muted">RAM</span></div><div><b>' + pct(pc.gpu?.util) +
    '</b><span class="muted">GPU</span></div></div></section>' +
    '<section><h2>Bố cục an toàn</h2><ul>' + pages + '</ul></section>' +
    '<section><h2>Xem trước giao diện gốc</h2><iframe src="/panel/" title="PhoneBox panel preview" loading="lazy"></iframe></section>' +
    '</main></html>';
}

// Anonymous public scope is intentionally limited to *presentation* widgets.
// Never proxy raw public settings writes to the PC agent.
const SAFE_NEW_WIDGETS = new Set([
  'clock', 'stat', 'chart', 'meters', 'media', 'forecast', 'worldclock', 'calendar'
]);
const SAFE_VISUAL_OPTIONS = new Set([
  'metric', 'metrics', 'label', 'title', 'format', 'variant', 'mode', 'layout',
  'fontSize', 'font', 'size', 'scale', 'align', 'alignment', 'color', 'accent',
  'opacity', 'radius', 'border', 'shadow', 'showDate', 'showSeconds', 'hour12',
  'decimals', 'precision', 'smooth', 'showGrid', 'showTitle', 'showLegend',
  'showIcon', 'compact', 'historySec', 'unit', 'units', 'dateFormat', 'timeFormat',
  'timeZone', 'timezone'
]);
const SAFE_METRIC_TYPES = PUBLIC_METRICS;
function safeVisualOptions(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const result = {};
  for (const [k, v] of Object.entries(input)) {
    if (!SAFE_VISUAL_OPTIONS.has(k)) continue;
    if (k === 'metric' && typeof v === 'string' && SAFE_METRIC_TYPES.has(v)) { result[k] = v; continue; }
    if (k === 'metrics' && Array.isArray(v)) {
      result[k] = v.filter(x => typeof x === 'string' && SAFE_METRIC_TYPES.has(x)).slice(0, 6);
      continue;
    }
    if (k === 'metric' || k === 'metrics') continue;
    if (typeof v === 'boolean') { result[k] = v; continue; }
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 7200) { result[k] = v; continue; }
    if (typeof v === 'string' && v.length <= 64 &&
        /^[\p{L}\p{N}\s#.:,()/_+\-]*$/u.test(v)) result[k] = v;
  }
  return result;
}
function validatedGeometry(w) {
  const x = w?.x, y = w?.y, width = w?.w, height = w?.h;
  if (![x,y,width,height].every(Number.isInteger) ||
      x < 0 || y < 0 || width < 1 || height < 1 ||
      x + width > 12 || y + height > 6) throw new Error('INVALID_WIDGET_GEOMETRY');
  return { x, y, w: width, h: height };
}
function mergeEditorWidgetChanges(current, submitted) {
  if (!submitted || typeof submitted !== 'object' || Array.isArray(submitted) ||
      !Array.isArray(submitted.pages) || submitted.pages.length > 9) throw new Error('INVALID_LAYOUT');
  const newIds = new Set();
  const currentPages = Array.isArray(current?.pages) ? current.pages : [];
  if (currentPages.length !== submitted.pages.length) throw new Error('PAGE_SET_CHANGED');
  const submittedPages = new Map();
  for (const page of submitted.pages) {
    if (!page || !Object.hasOwn(ORIGINAL_PAGE_NAMES, page.id) ||
        submittedPages.has(page.id) || !Array.isArray(page.widgets) ||
        page.widgets.length > 35) throw new Error('PAGE_INVALID');
    submittedPages.set(page.id, page);
  }
  if (currentPages.some(p => !submittedPages.has(p.id))) throw new Error('PAGE_SET_CHANGED');
  const out = structuredClone(current);
  out.pages = currentPages.map((basePage) => {
    const page = submittedPages.get(basePage.id);
    const originalWidgets = Array.isArray(basePage.widgets) ? basePage.widgets : [];
    const visibleWidgets = originalWidgets.filter(w => EDITOR_WIDGET_TYPES.has(w?.type)).slice(0, 30);
    const known = new Map(visibleWidgets.map((w, i) => ['readonly-' + basePage.id + '-' + i, w]));
    const widgets = [];
    for (const incoming of page.widgets) {
      if (!incoming || typeof incoming !== 'object') throw new Error('WIDGET_INVALID');
      const geometry = validatedGeometry(incoming);
      const old = known.get(incoming.id);
      if (old) {
        if (old.type !== incoming.type || newIds.has(incoming.id)) throw new Error('WIDGET_TYPE_CHANGED');
        newIds.add(incoming.id);
        const previous = structuredClone(old);
        Object.assign(previous, geometry);
        if (SAFE_NEW_WIDGETS.has(old.type)) {
          previous.options = { ...(previous.options || {}), ...safeVisualOptions(incoming.options) };
        }
        widgets.push(previous);
      } else {
        if (typeof incoming.id === 'string' && incoming.id.startsWith('readonly-')) throw new Error('UNRECOGNIZED_WIDGET');
        if (!SAFE_NEW_WIDGETS.has(incoming.type)) throw new Error('UNSAFE_NEW_WIDGET');
        if (widgets.length >= 35) throw new Error('WIDGET_LIMIT');
        widgets.push({
          id: crypto.randomUUID().slice(0, 12), type: incoming.type,
          ...geometry, options: safeVisualOptions(incoming.options)
        });
      }
    }
    // Unknown plugin-specific widgets remain untouched rather than silently deleted.
    for (const w of originalWidgets) if (!EDITOR_WIDGET_TYPES.has(w?.type)) widgets.push(w);
    return { ...basePage, widgets, enabled: page.enabled !== false };
  });
  return out;
}
async function savePublicWidgets(req, res) {
  const origin = req.headers.origin;
  const site = req.headers['sec-fetch-site'];
  if (site === 'cross-site' || (origin && origin !== 'https://' + HOSTS.admin) ||
      (!origin && site !== 'same-origin')) return respond(res, 403, 'Origin denied');
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || ''))
    return respond(res, 415, '{"error":"JSON required"}', 'application/json');
  if (Number(req.headers['content-length'] || 0) > MAX_BODY)
    return respond(res, 413, '{"error":"Too large"}', 'application/json');
  const key = clientKey(req);
  if ((widgetSaveTimes.get(key) || 0) > Date.now())
    return respond(res, 429, '{"error":"Try again shortly"}', 'application/json');
  let textBody = '';
  for await (const chunk of req) {
    textBody += chunk.toString('utf8');
    if (textBody.length > MAX_BODY) return respond(res, 413, '{"error":"Too large"}', 'application/json');
  }
  let incoming;
  try { incoming = JSON.parse(textBody); }
  catch { return respond(res, 400, '{"error":"Bad JSON"}', 'application/json'); }
  try {
    const current = await readAgentJson('/api/config');
    const version = String(current.version || '');
    const submittedVersion = req.headers['x-config-version'];
    if (!/^\d+$/.test(version) || submittedVersion !== version)
      return respond(res, 409, '{"error":"Reload the latest settings before saving"}', 'application/json');
    const next = mergeEditorWidgetChanges(current.config, incoming);
    const raw = Buffer.from(JSON.stringify(next), 'utf8');
    if (raw.length > 2 * 1024 * 1024) throw new Error('SAVED_CONFIG_TOO_LARGE');
    const writeResult = await new Promise((resolve, reject) => {
      const request = http.request({
        ...UPSTREAM, path: '/api/settings', method: 'PUT', timeout: 20000,
        headers: {
          'Content-Type': 'application/json', 'Content-Length': raw.length,
          'X-Config-Version': version, 'Origin': 'http://127.0.0.1:' + UPSTREAM.port,
          'Sec-Fetch-Site': 'same-origin'
        }
      }, response => {
        const chunks = []; let length = 0;
        response.on('data', part => {
          length += part.length;
          if (length > 65536) { request.destroy(new Error('SAVE_RESPONSE_TOO_LARGE')); return; }
          chunks.push(part);
        });
        response.on('end', () => resolve({ status: response.statusCode, payload: Buffer.concat(chunks).toString('utf8') }));
        response.on('error', reject);
      });
      request.on('timeout', () => request.destroy(new Error('SAVE_TIMEOUT')));
      request.on('error', reject);
      request.end(raw);
    });
    if (writeResult.status === 409)
      return respond(res, 409, '{"error":"Settings changed; reload first"}', 'application/json');
    if (writeResult.status !== 200)
      return respond(res, 422, '{"error":"Layout could not be saved"}', 'application/json');
    widgetSaveTimes.set(key, Date.now() + 1500);
    let versionAfter = '';
    try { versionAfter = String(JSON.parse(writeResult.payload).version || ''); } catch {}
    return respond(res, 200, JSON.stringify({ version: versionAfter, saved: 'widgets-only' }), 'application/json');
  } catch {
    return respond(res, 400, '{"error":"Invalid widget layout or settings changed"}', 'application/json');
  }
}

async function publicReadOnly(req, res, role, path) {
  if (role === 'admin' && path === '/api/settings' && req.method === 'PUT' && PUBLIC_WIDGET_EDIT)
    return savePublicWidgets(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') return respond(res, 405, 'Read-only mode');
  if (path === '/__login' || path === '/__logout') {
    res.writeHead(303, { Location: '/' }); return res.end();
  }
  if (path === '/panel') { res.writeHead(303, { Location: '/panel/' }); return res.end(); }
  if (role === 'view' && path === '/') {
    res.writeHead(303, { Location: '/panel/' }); return res.end();
  }
  if (role === 'admin' && path === '/') {
    try { return respond(res, 200, originalSettingsReadOnlyHtml(await readAgentText('/')), 'text/html; charset=utf-8'); }
    catch { return respond(res, 502, 'PhoneBox is temporarily unavailable'); }
  }
  if (role === 'admin' && path === '/api/settings') {
    try { const origin = await readAgentJson('/api/config');
      if (typeof origin.version === 'string' && /^\\d+$/.test(origin.version))
        res.setHeader('X-Config-Version', origin.version);
      return respond(res, 200, JSON.stringify(safePublicEditorSettings(origin)), 'application/json; charset=utf-8'); }
    catch { return respond(res, 502, '{"error":"upstream"}', 'application/json'); }
  }
  if (role === 'admin' && path === '/api/catalog') return proxy(req, res, role, path);
  if (role === 'admin' && path === '/api/info') {
    try { return respond(res, 200,
      JSON.stringify(safeSettingsInfo(await readAgentJson('/api/info'))),
      'application/json; charset=utf-8'); }
    catch { return respond(res, 502, '{"error":"upstream"}', 'application/json'); }
  }
  if (role === 'admin' && path === '/api/lan') {
    try { const lan = await readAgentJson('/api/lan');
      return respond(res, 200, JSON.stringify({configured:!!lan.configured,
        active:!!lan.active,port:8766,restartNeeded:!!lan.restartNeeded,
        hosts:[]}), 'application/json; charset=utf-8'); }
    catch { return respond(res, 502, '{"error":"upstream"}', 'application/json'); }
  }
  if (role === 'admin' && path === '/api/update')
    return respond(res, 200, JSON.stringify({installed:true,auto:false,status:{
      agentVersion:'0.9',appVersion:null,agentUpdate:false,appUpdate:false,
      latest:null,lastCheck:null,state:'idle',error:null}}), 'application/json; charset=utf-8');
  if (role === 'admin' && ['/api/phones','/api/network/adapters'].includes(path))
    return respond(res, 200, '[]', 'application/json; charset=utf-8');
  if (role === 'admin' && ['/api/claude/hook','/api/codex/hook'].includes(path))
    return respond(res, 200, '{"installed":false}', 'application/json; charset=utf-8');
  if (role === 'admin' && path === '/api/push')
    return respond(res, 200, '{"items":{}}', 'application/json; charset=utf-8');
  if (role === 'admin' && path === '/api/state') {
    try { return respond(res, 200, JSON.stringify(safePublicState(await readAgentJson('/api/state'))), 'application/json; charset=utf-8'); }
    catch { return respond(res, 502, '{"error":"upstream"}', 'application/json'); }
  }
  if (path === '/agent/api/config') {
    try { return respond(res, 200, JSON.stringify(safePublicConfig(await readAgentJson('/api/config'))), 'application/json; charset=utf-8'); }
    catch { return respond(res, 502, '{"error":"upstream"}', 'application/json'); }
  }
  if (path === '/agent/api/state') {
    try { return respond(res, 200, JSON.stringify(safePublicState(await readAgentJson('/api/state'))), 'application/json; charset=utf-8'); }
    catch { return respond(res, 502, '{"error":"upstream"}', 'application/json'); }
  }
  if (path === '/agent/api/stream') return respond(res, 204, '');
  if (path === '/favicon.ico' || /^\/panel\/[A-Za-z0-9_./-]*$/.test(path) && !path.split('/').includes('..'))
    return proxy(req, res, role, path);
  return respond(res, 404, 'Not found');
}

function start(role, port) {
  const server = http.createServer(async (req, res) => {
    secureHeaders(res);
    const host = String(req.headers.host || '').toLowerCase().split(':')[0];
    if (host !== HOSTS[role] && host !== '127.0.0.1' && host !== 'localhost') return respond(res, 421, 'Wrong host');
    let path;
    try { path = new URL(req.url, 'http://localhost').pathname; } catch { return respond(res, 400, 'Bad path'); }
    if (path === '/healthz' && req.method === 'GET') return respond(res, 200, JSON.stringify({ ok: true, service: 'phonebox-web', role }), 'application/json');
    if (PUBLIC_READ_ONLY) return publicReadOnly(req, res, role, path);
    if (path === '/__login' && req.method === 'GET') { secureHeaders(res, true); return respond(res, 200, loginPage(role), 'text/html; charset=utf-8'); }
    if (path === '/__login' && req.method === 'POST') {
      secureHeaders(res, true);
      const key = role + ':' + clientKey(req), entry = fails.get(key) || { count: 0, until: 0 };
      if (entry.until > Date.now()) return respond(res, 429, loginPage(role, true), 'text/html; charset=utf-8');
      let body = '';
      for await (const chunk of req) {
        body += chunk.toString('utf8');
        if (body.length > 2048) return respond(res, 413, 'Too large');
      }
      const fields = new URLSearchParams(body);
      const csrf = fields.get('csrf');
      if (!validLoginCsrf(csrf, role) || !acceptLoginOrigin(req, role, csrf))
        return respond(res, 403, loginPage(role, true), 'text/html; charset=utf-8');
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
export { allowedView, allowedAdmin, sameOrigin, LOGIN_USER, validLoginCsrf, acceptLoginOrigin, safePublicConfig, safePublicState, PUBLIC_READ_ONLY, safePublicEditorSettings, safeSettingsInfo, originalSettingsReadOnlyHtml, PUBLIC_WIDGET_EDIT, mergeEditorWidgetChanges };
if (process.env.PB_NO_LISTEN !== '1') {
  secrets = loadSecrets();
  start('view', VIEW_PORT);
  start('admin', ADMIN_PORT);
}
