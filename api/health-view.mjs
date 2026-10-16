// Vercel is presentation transport only. All displayed data comes from PC01.
import { authorizedDevice } from './live-device-auth.mjs';
const PATHS = new Set([
  '/', '/work-ui.css', '/work-center-visual.css', '/work-center.js',
  '/api/status', '/api/live-status', '/api/health-live-work', '/api/work-history',
]);

// A degraded, read-only owner view. Never treats GitHub issue metadata as a live Core job.
const GITHUB_OPEN_ISSUES = 'https://api.github.com/repos/newsdayads/tigeriq-ai-lab/issues';
const REPO_ISSUE_LINK = 'https://github.com/newsdayads/tigeriq-ai-lab/issues/';
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
}[char]));
const issueField = (body, field) => String(body || '')
  .match(new RegExp('^' + field + '=([^\\r\\n]+)', 'm'))?.[1]?.trim() || '';

export function classifyFallbackIssue(issue) {
  const title = String(issue?.title || '');
  const body = String(issue?.body || '');
  const resourceScope = issueField(body, 'RESOURCE_SCOPE');
  const system = /\[(?:CENTRAL|STATE|REGISTRY|QUẢN TRỊ|TÀI NGUYÊN|RESULTS|POLICY|SOT)\]/i.test(title)
    || resourceScope.startsWith('SYSTEM_')
    || issueField(body, 'RESULT_INBOX') === 'true';
  const priority = title.match(/\[(P[0-5])\]/i)?.[1]?.toUpperCase() ||
    issueField(body, 'PRIORITY').toUpperCase() || '—';
  const state = issueField(body, 'CURRENT_STATE').toUpperCase();
  const autoQueue = issueField(body, 'AUTO_QUEUE').toUpperCase();
  const labels = (issue?.labels || []).map(label => String(label?.name || label).toLowerCase());
  const blocked = state.includes('BLOCKED') || labels.includes('tigeriq:terminal-blocked');
  const waiting = !blocked && (/WAIT|PENDING|NO_GO|EXCLUDED/.test(state + ' ' + autoQueue)
    || issueField(body,'TIGERIQ_EXECUTABLE').toLowerCase() === 'false');
  const status = system ? 'THAM CHIẾU' : blocked ? 'BỊ CHẶN'
    : waiting ? 'CHỜ / CHƯA SẴN SÀNG' : 'CHƯA XÁC MINH THỰC THI';
  const checked = issueField(body,'PROGRESS_VERIFIED').toLowerCase() === 'true';
  const completed = Number(issueField(body,'PROGRESS_COMPLETED'));
  const total = Number(issueField(body,'PROGRESS_TOTAL'));
  const milestones = checked && Number.isInteger(completed) && Number.isInteger(total) &&
    total > 0 && completed >= 0 && completed <= total ? completed + '/' + total + ' mốc' : null;
  return {number:Number(issue?.number),title,priority,system,status,milestones};
}

export async function readFallbackIssues(fetchImpl = fetch, token = process.env.TIGERIQ_GITHUB_TOKEN) {
  if (!token) return null;
  const issues = [];
  for (let page = 1; page <= 5; page++) {
    const url = GITHUB_OPEN_ISSUES + '?state=open&per_page=100&sort=updated&direction=desc&page=' + page;
    const response = await fetchImpl(url, {
      method:'GET', redirect:'error', signal:AbortSignal.timeout(2400),
      headers:{Accept:'application/vnd.github+json',Authorization:'Bearer ' + token,'User-Agent':'TigerIQ-Web-ReadOnly-Fallback'},
    });
    if (!response.ok) throw new Error('GITHUB_FALLBACK_HTTP_' + response.status);
    const batch = await response.json();
    if (!Array.isArray(batch)) throw new Error('GITHUB_FALLBACK_INVALID_RESPONSE');
    issues.push(...batch.filter(issue => issue?.state === 'open' && !issue.pull_request));
    if (batch.length < 100) return issues;
  }
  throw new Error('GITHUB_FALLBACK_INCOMPLETE_PAGINATION');
}

export function renderFallbackPage(issues, checkedAt = new Date().toISOString()) {
  const all = Array.isArray(issues) ? issues.map(classifyFallbackIssue).filter(i=>Number.isSafeInteger(i.number)&&i.number>0) : [];
  const work = all.filter(item=>!item.system).sort((a,b)=>{
    const ranks={P0:0,P1:1,P2:2,P3:3,P4:4,P5:5};
    return (ranks[a.priority]??9)-(ranks[b.priority]??9) || a.number-b.number;
  });
  const references=all.filter(item=>item.system).sort((a,b)=>a.number-b.number);
  const renderCard = item => '<li><a rel="noopener noreferrer" href="' + REPO_ISSUE_LINK + item.number +
    '"><strong>' + esc(item.title) + '</strong></a><small>#' + item.number + ' · ' +
    esc(item.priority) + ' · ' + esc(item.status) + (item.milestones ? ' · ' + esc(item.milestones) : '') +
    '</small></li>';
  const workList = work.length ? work.map(renderCard).join('') :
    '<li>Chưa có dữ liệu danh sách công việc. Không suy đoán trạng thái.</li>';
  return '<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>TigerIQ — dữ liệu dự phòng</title><style>' +
    'body{font:15px/1.5 system-ui,sans-serif;margin:0;padding:18px;background:#0d1b2e;color:#edf4ff}' +
    'main{max-width:740px;margin:auto}h1{font-size:20px;margin:0 0 8px}h2{font-size:16px;margin:24px 0 8px}' +
    '.notice{padding:12px;border:1px solid #c78c37;border-radius:12px;background:#302615}' +
    'ul{list-style:none;padding:0}li{padding:12px;margin:8px 0;border:1px solid #465369;border-radius:12px}' +
    'li a{color:#b9d7ff;text-decoration:none}li small{display:block;color:#ccd6e5;margin-top:5px}' +
    'button{background:#2b6bd3;color:white;border:0;border-radius:9px;padding:11px 16px;font:inherit}' +
    'details{margin-top:22px}summary{cursor:pointer}p,footer{color:#c2cddd}footer{font-size:12px;margin:20px 0}' +
    '</style></head><body><main><h1>TigerIQ / DANH SÁCH CÔNG VIỆC</h1>' +
    '<p class="notice"><strong>ĐANG DÙNG DỮ LIỆU GITHUB DỰ PHÒNG.</strong> Không kết nối được PC01 trực tiếp. ' +
    'Không có bằng chứng tác vụ đang chạy; không thực thi hoặc phê duyệt việc từ trang này.</p>' +
    '<p><button type="button" onclick="location.reload()">KIỂM TRA LẠI WEB</button></p>' +
    '<h2>CÔNG VIỆC ĐANG MỞ (' + work.length + ')</h2><ul>' + workList + '</ul>' +
    '<details><summary>HỒ SƠ THAM CHIẾU (' + references.length + ')</summary><ul>' +
    references.map(renderCard).join('') + '</ul></details>' +
    '<footer>Nguồn: GitHub, đối chiếu lúc ' + esc(checkedAt) +
    '. Số mốc chỉ từ hồ sơ; đây không phải xác minh trạng thái Core tức thời.</footer>' +
    '</main></body></html>';
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control','no-store, max-age=0');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Robots-Tag','noindex, nofollow');
  if (req.method !== 'GET') { res.status(405).send('method_not_allowed'); return; }
  // Device enrollment is explicit, HMAC-signed and bound to this HTTPS host.
  // Do not emit WWW-Authenticate: on iPhone it opens a native password dialog.
  const deviceKey=String(process.env.TIGERIQ_LIVE_DEVICE_KEY||'');
  if(deviceKey.length<48){res.status(503).send('VIEW_DEVICE_AUTH_NOT_CONFIGURED');return;}
  if(!authorizedDevice(String(req.headers?.cookie||''),deviceKey)){
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.status(403).send('<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Thiết bị chưa kết nối</title><body style="font:16px system-ui;padding:24px;background:#0d1b2e;color:#e8f4ff"><h2>TigerIQ LIVE</h2><p>Thiết bị chưa được xác thực. Hãy mở liên kết kích hoạt riêng đã được cấp để truy cập mà không cần mật khẩu.</p></body></html>');
    return;
  }

  const pathValue = req.query?.resource;
  const path = '/' + String(Array.isArray(pathValue) ? '' : (pathValue || '')).replace(/^\/+/, '');
  if (!PATHS.has(path)) { res.status(404).send('not_found'); return; }
  const origin = process.env.TIGERIQ_HEALTH_VIEW_ORIGIN;
  const key = process.env.TIGERIQ_HEALTH_VIEW_KEY;
  if (!origin || !/^https:\/\/[a-z0-9.-]+\.ts\.net(?::443)?\/?$/i.test(origin) || !key || key.length < 32) {
    res.status(503).send('HEALTH_VIEW_NOT_CONFIGURED'); return;
  }
  const target = new URL(path, origin);
  if (path === '/api/work-history') {
    const number = String(req.query?.number || '');
    if (!/^[1-9]\d{0,7}$/.test(number)) { res.status(400).send('invalid_number'); return; }
    target.searchParams.set('number', number);
  }
  try {
    const upstream = await fetch(target, {
      method:'GET', headers: { authorization:'Bearer ' + key },
      redirect:'error', signal:AbortSignal.timeout(5500), cache:'no-store',
    });
    const raw = Buffer.from(await upstream.arrayBuffer());
    if (raw.length > 5 * 1024 * 1024) { res.status(502).send('upstream_too_large'); return; }
    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    res.status(upstream.status);
    res.setHeader('Content-Type',contentType);
    if (contentType.includes('text/html')) {
      // Rebase all dashboard AJAX and asset paths to the isolated read-only proxy namespace.
      const html = raw.toString('utf8')
        .replaceAll('/api/', '/pc01/api/')
        .replaceAll('/work-ui.css', '/pc01/work-ui.css')
        .replaceAll('/work-center-visual.css', '/pc01/work-center-visual.css')
        .replaceAll('/work-center.js', '/pc01/work-center.js');
      res.send(html);
      return;
    }
    res.send(raw);
  } catch (error) {
    // Keep network diagnostics redacted: no tokens, cookies, or request headers in logs.
    const reason = String(error?.cause?.code || error?.name || 'UPSTREAM_ERROR').slice(0,48);
    console.warn('HEALTH_VIEW_UPSTREAM_UNAVAILABLE', {reason, path});
    if (path === '/') {
      let issues = null;
      try {
        issues = await readFallbackIssues();
      } catch (fallbackError) {
        console.warn('HEALTH_VIEW_GITHUB_FALLBACK_UNAVAILABLE', {
          reason:String(fallbackError?.cause?.code || fallbackError?.name || 'READ_ERROR').slice(0,48),
        });
      }
      res.setHeader('Content-Type','text/html; charset=utf-8');
      res.setHeader('X-TigerIQ-Data-Source', issues ? 'github-fallback' : 'unavailable');
      res.setHeader('Retry-After','20');
      return res.status(503).send(renderFallbackPage(issues));
    }
    res.status(502).send('PC01_UNAVAILABLE');
  }
}
