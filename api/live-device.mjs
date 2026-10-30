// Owner-controlled device enrollment. A 10-minute, high-entropy invitation
// uses fragment or a 10-minute ?invite= HTTPS fallback for iPhone in-app links; credentials are scrubbed before same-origin POST.
// No public API can mint a new invitation.
import { createDeviceSession, verifyPairLinkToken, sessionCookie } from './live-device-auth.mjs';

const ACTIVATE_HTML=`<!doctype html><html lang="vi"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>Kết nối TigerIQ LIVE</title>
<style>body{margin:0;background:#0d1b2e;color:#e8f4ff;font:16px system-ui;display:grid;min-height:100svh;place-items:center}
main{max-width:380px;margin:20px;padding:24px;border:1px solid #415d80;border-radius:16px;background:#14263f}
h1{font-size:22px;margin:0 0 14px}p{line-height:1.5}small{color:#a5b9cc}a{color:#72d0ff}</style>
</head><body><main><h1>🐯 Kết nối thiết bị với TigerIQ LIVE</h1>
<p id="state" role="status">Đang xác thực thiết bị…</p>
<small>Chỉ anh Sơn được cấp quyền xem dữ liệu PC01. Không cần nhập mật khẩu trên thiết bị đã kết nối.</small></main>
<script>
(async function(){
 // Some in-app browsers rewrite '#' into '%23', producing a Vercel NOT_FOUND.
 // Support the one-tap ?invite= link and the original fragment-only flow.
 // Read then immediately scrub BOTH credentials from browser history before POST.
 const fragment=new URLSearchParams(location.hash.slice(1));
 const query=new URLSearchParams(location.search);
 const token=fragment.get('token')||query.get('invite')||'';
 history.replaceState(null,'',location.pathname);
 const state=document.getElementById('state');
 if(!/^[A-Za-z0-9_-]{50,1400}\\.[A-Za-z0-9_-]{40,90}$/.test(token)){
  state.textContent='Thiếu liên kết kích hoạt hợp lệ. Vui lòng mở lại liên kết riêng được cấp.';return;
 }
 try{
  const res=await fetch('/api/live-device',{method:'POST',
   headers:{'Content-Type':'application/json'},credentials:'same-origin',
   body:JSON.stringify({token})});
  if(!res.ok){state.textContent='Liên kết đã hết hạn hoặc không hợp lệ. Cần liên kết kích hoạt mới.';return;}
  state.textContent='Đã xác thực. Đang mở LIVE…';
  location.replace('/');
 }catch{state.textContent='Không kết nối được. Kiểm tra Internet rồi thử lại bằng liên kết mới.';}
})();
</script></body></html>`;

export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store, max-age=0');
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Referrer-Policy','no-referrer');
 res.setHeader('X-Robots-Tag','noindex, nofollow');
 const key=process.env.TIGERIQ_LIVE_DEVICE_KEY||'';
 if(key.length<48)return res.status(503).send('VIEW_DEVICE_AUTH_NOT_CONFIGURED');
 if(req.method==='GET'){
  res.setHeader('Content-Type','text/html; charset=utf-8');
  return res.status(200).send(ACTIVATE_HTML);
 }
 if(req.method!=='POST'){
  res.setHeader('Allow','GET, POST');return res.status(405).send('METHOD_NOT_ALLOWED');
 }
 const origin=String(req.headers.origin||'');
 const host=String(req.headers.host||'');
 if(!host||origin!=='https://'+host)return res.status(403).send('ORIGIN_REJECTED');
 const body=req.body;
 const token=typeof body==='object'&&body!==null&&!Array.isArray(body)?body.token:
  typeof body==='string'&&body.length<1800?(()=>{try{return JSON.parse(body).token;}catch{return null;}})():null;
 if(!verifyPairLinkToken(token,key))return res.status(403).send('LINK_EXPIRED_OR_INVALID');
 res.setHeader('Set-Cookie',sessionCookie(createDeviceSession(key)));
 return res.status(200).send('DEVICE_ACTIVATED');
}
