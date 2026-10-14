// Vercel is presentation transport only. All displayed data comes from PC01.
import { authorizedDevice } from './live-device-auth.mjs';
const PATHS = new Set([
  '/', '/work-ui.css', '/work-center-visual.css', '/work-center.js',
  '/api/status', '/api/live-status', '/api/health-live-work', '/api/work-history',
]);
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
      redirect:'error', signal:AbortSignal.timeout(12000), cache:'no-store',
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
  } catch {
    res.status(502).send('PC01_UNAVAILABLE');
  }
}
