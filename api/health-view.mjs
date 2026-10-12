// Vercel is presentation transport only. All displayed data comes from PC01.
const PATHS = new Set([
  '/', '/work-ui.css', '/work-center-visual.css', '/work-center.js',
  '/api/status', '/api/live-status', '/api/health-live-work', '/api/work-history',
]);
export default async function handler(req, res) {
  res.setHeader('Cache-Control','no-store, max-age=0');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Robots-Tag','noindex, nofollow');
  if (req.method !== 'GET') { res.status(405).send('method_not_allowed'); return; }
  const pathValue = req.query?.resource;
  const path = '/' + String(Array.isArray(pathValue) ? '' : (pathValue || '')).replace(/^\/+/, '');
  if (!PATHS.has(path)) { res.status(404).send('not_found'); return; }
  const origin = process.env.TIGERIQ_HEALTH_VIEW_ORIGIN;
  const key = process.env.TIGERIQ_HEALTH_VIEW_KEY;
  if (!origin || !/^https:\/\/[a-z0-9.-]+(?::443)?\/?$/i.test(origin) || !key || key.length < 32) {
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
