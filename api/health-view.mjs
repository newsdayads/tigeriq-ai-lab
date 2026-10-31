// Vercel is presentation transport only. All displayed data comes from PC01.
import { authorizedDevice } from './live-device-auth.mjs';
import { request as httpsRequest } from 'node:https';

// Native IPv4 HTTPS retry is restricted to the same validated Tailscale Funnel origin.
// No redirects, authentication changes, new domains, or writes.
export function isResetConnection(error) {
  const causes = [error, error?.cause, error?.cause?.cause];
  // Native fetch + AbortSignal.timeout() throws DOMException TimeoutError
  // (numeric code 23), not ETIMEDOUT. Permit only the existing GET/IPv4
  // fallback to the SAME validated Tailscale origin; no new trust boundary.
  return causes.some(cause =>
    ['ECONNRESET','ETIMEDOUT','ENETUNREACH','EHOSTUNREACH','EAI_AGAIN'].includes(String(cause?.code||''))
    || (cause?.name==='TimeoutError' && Number(cause?.code)===23)
  );
}
export function readIpv4Https(target, token, requestImpl=httpsRequest) {
  return new Promise((resolve,reject)=>{
    let settled=false;
    const finish=(error,result)=>{
      if(settled)return;
      settled=true;
      if(error)reject(error);else resolve(result);
    };
    const request=requestImpl(target,{
      method:'GET',family:4,agent:false,servername:target.hostname,
      headers:{authorization:'Bearer '+token,accept:'*/*'},
      timeout:8500,
    },response=>{
      if(response.statusCode>=300 && response.statusCode<400){
        response.resume?.();
        finish(new Error('upstream_redirect_rejected'));
        return;
      }
      const chunks=[];let size=0;
      response.on('data',chunk=>{
        size+=chunk.length;
        if(size>5*1024*1024){
          request.destroy(new Error('upstream_too_large'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end',()=>finish(null,{
        status:response.statusCode||502,
        contentType:response.headers?.['content-type']||'application/octet-stream',
        raw:Buffer.concat(chunks),
      }));
      response.on('error',finish);
    });
    request.on('timeout',()=>request.destroy(new Error('ipv4_transport_timeout')));
    request.on('error',finish);
    request.end();
  });
}
// Rebase only PC01 endpoints. Owner commands and OAuth must remain on this
// HTTPS Vercel origin, never in the read-only /pc01/ proxy namespace.
export function rewritePc01DashboardRoutes(html) {
  return String(html||'').replace(/(?<!\/pc01)\/api\/([a-z][a-z0-9-]*)(?=[/?'"\x60]|$)/gi, (path, endpoint) => {
    if(endpoint==='control'||endpoint==='owner-auth')return path;
    return '/pc01'+path;
  });
}
// Owner-facing only: the Vercel presentation proxy can display the Mobile
// reload shortcut before the independently gated PC01 runtime is upgraded.
const FLOATING_RELOAD_HTML = `<style id="tiq-proxy-mobile-reload-style">
@media(max-width:767px){
 #reloadPage.tiq-floating-reload{position:fixed!important;right:max(16px,env(safe-area-inset-right))!important;bottom:calc(20px + env(safe-area-inset-bottom))!important;z-index:65!important;display:grid!important;place-items:center!important;width:52px!important;height:52px!important;border-radius:50%!important;border:1px solid #81c9ff!important;background:#126bd3!important;color:#fff!important;box-shadow:0 8px 22px #0009!important;cursor:pointer!important;touch-action:manipulation}
 #reloadPage.tiq-floating-reload svg{width:25px!important;height:25px!important}
 body.drawer-open #reloadPage,body.work-detail-open #reloadPage{visibility:hidden!important;pointer-events:none!important}
}
</style><script id="tiq-proxy-mobile-reload-bootstrap">
(()=>{const mount=()=>{
 if(window.TigerIQWorkCenter&&typeof window.TigerIQWorkCenter.mountFloatingReload==='function'){window.TigerIQWorkCenter.mountFloatingReload();return}
 if(window.matchMedia&&!window.matchMedia('(max-width:767px)').matches)return;
 if(document.getElementById('reloadPage'))return;
 const button=document.createElement('button');button.id='reloadPage';button.className='tiq-floating-reload';button.type='button';
 button.setAttribute('aria-label','Tải lại trang');button.title='Tải lại trang';
 button.innerHTML='<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-2.3 6"/><path d="M20 4v7h-7"/></svg>';
 button.addEventListener('click',()=>window.location.reload());document.body.appendChild(button);
 };if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount()})();
</script>`;
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
  // The public port 443 serves OAuth MCP at /; the read-only viewer is mounted
  // on an independently bearer-gated Funnel path, without changing MCP routes.
  const viewPrefix=String(process.env.TIGERIQ_HEALTH_VIEW_PATH_PREFIX||'');
  if(viewPrefix && !/^\/[a-z0-9-]{1,48}$/.test(viewPrefix)){
    res.status(503).send('HEALTH_VIEW_PATH_INVALID');return;
  }
  const target = new URL(viewPrefix + path, origin);
  if (path === '/api/work-history') {
    const number = String(req.query?.number || '');
    if (!/^[1-9]\d{0,7}$/.test(number)) { res.status(400).send('invalid_number'); return; }
    target.searchParams.set('number', number);
  }
  try {
    let response;
    try {
      const upstream = await fetch(target, {
        method:'GET', headers: { authorization:'Bearer ' + key },
        redirect:'error', signal:AbortSignal.timeout(5500), cache:'no-store',
      });
      response={
        status:upstream.status,
        contentType:upstream.headers.get('content-type')||'application/octet-stream',
        raw:Buffer.from(await upstream.arrayBuffer()),
      };
    } catch (firstError) {
      if(!isResetConnection(firstError))throw firstError;
      response=await readIpv4Https(target,key);
    }
    const {raw,contentType}=response;
    if(raw.length>5*1024*1024){res.status(502).send('upstream_too_large');return;}
    res.status(response.status);
    res.setHeader('Content-Type',contentType);
    if (contentType.includes('text/html')) {
      // Rebase all dashboard AJAX and asset paths to the isolated read-only proxy namespace.
      const html = rewritePc01DashboardRoutes(raw.toString('utf8'))
        .replaceAll('/work-ui.css', '/pc01/work-ui.css')
        .replaceAll('/work-center-visual.css', '/pc01/work-center-visual.css')
        .replaceAll('/work-center.js', '/pc01/work-center.js')
        .replace('</body>', FLOATING_RELOAD_HTML + '</body>');
      res.send(html);
      return;
    }
    res.send(raw);
  } catch (error) {
    // Redacted transport diagnosis only. Never log device cookies or gateway secrets.
    console.warn('TIGERIQ_ORIGINAL_VIEW_TRANSPORT_FAILED',{path,code:String(error?.code||error?.cause?.code||error?.name||'UNKNOWN').slice(0,40)});
    res.status(502).send('PC01_UNAVAILABLE');
  }
}
