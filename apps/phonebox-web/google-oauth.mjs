import crypto from 'node:crypto';
const ORIGIN='https://phonebox.tigeriq.io.vn';
const COOKIE='__Host-pbgoogle-nonce';
const GOOGLE_JWKS='https://www.googleapis.com/oauth2/v3/certs';
const OWNER='newsdayads@gmail.com';
function equal(a,b){const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length>0&&x.length===y.length&&crypto.timingSafeEqual(x,y)}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function cookieValue(req,name){return String(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1)||''}
function sign(payload,key){return crypto.createHmac('sha256',key).update('phonebox-gis:'+payload).digest('base64url')}
function validatedNonce(req,key){
  const cookie=cookieValue(req,COOKIE),dot=cookie.indexOf('.');
  if(dot<1)return null;
  const payload=cookie.slice(0,dot);
  if(!equal(cookie.slice(dot+1),sign(payload,key)))return null;
  try{const data=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
    return typeof data.nonce==='string'&&data.nonce.length>=24&&Number.isInteger(data.issued)&&
      data.issued<Date.now()+30000&&data.issued>Date.now()-300000?data.nonce:null;
  }catch{return null}
}
function deny(res,code,message){
  res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify({error:message}));
}
function jwtParts(idToken){
  if(typeof idToken!=='string'||idToken.length>16384||idToken.length<200)throw Error('INVALID_JWT_LENGTH');
  const p=idToken.split('.');
  if(p.length!==3)throw Error('INVALID_JWT_PARTS');
  const header=JSON.parse(Buffer.from(p[0],'base64url').toString('utf8'));
  const claims=JSON.parse(Buffer.from(p[1],'base64url').toString('utf8'));
  if(header.alg!=='RS256'||typeof header.kid!=='string')throw Error('JWT_ALGORITHM_DENIED');
  return {header,claims,content:p[0]+'.'+p[1],signature:Buffer.from(p[2],'base64url')};
}
function makeGoogleOAuth(config,{fetchImpl=fetch,jwksUrl=GOOGLE_JWKS}={}){
  if(!/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(config?.clientId||'')||
     config?.ownerEmail!==OWNER||!(/^[a-f0-9]{64,}$/.test(config.sessionKey||'')))
    throw Error('PHONEBOX_GOOGLE_AUTH_NOT_CONFIGURED');
  const expectedOrigin=config.origin||ORIGIN;
  if(![ORIGIN,'https://pc01.tigeriq.io.vn'].includes(expectedOrigin))
    throw Error('INVALID_GOOGLE_OWNER_ORIGIN');
  const loginTitle=expectedOrigin===ORIGIN?'PhoneBox — PC01':'PC01 — Theo dõi';
  const loginDescription=expectedOrigin===ORIGIN?
    'Đăng nhập bằng newsdayads@gmail.com để điều khiển PhoneBox gốc.':
    'Đăng nhập bằng newsdayads@gmail.com để xem trạng thái PC01.';
  const key=Buffer.from(config.sessionKey,'hex');
  let cache={keys:[],expires:0};
  async function jwks(force=false){
    if(!force&&Date.now()<cache.expires&&cache.keys.length)return cache.keys;
    const r=await fetchImpl(jwksUrl,{signal:AbortSignal.timeout(9000)});
    if(!r.ok)throw Error('GOOGLE_KEYS_UNAVAILABLE');
    const body=await r.json();
    if(!Array.isArray(body.keys)||!body.keys.length)throw Error('GOOGLE_KEYS_INVALID');
    cache={keys:body.keys,expires:Date.now()+3600000};return cache.keys;
  }
  async function verify(jwt,nonce){
    const {header,claims,content,signature}=jwtParts(jwt);
    let cert=(await jwks()).find(k=>k.kid===header.kid&&k.kty==='RSA');
    if(!cert)cert=(await jwks(true)).find(k=>k.kid===header.kid&&k.kty==='RSA');
    if(!cert||!crypto.verify('RSA-SHA256',Buffer.from(content),
      crypto.createPublicKey({key:cert,format:'jwk'}),signature))throw Error('SIGNATURE_INVALID');
    const now=Math.floor(Date.now()/1000);
    if(!['accounts.google.com','https://accounts.google.com'].includes(claims.iss))throw Error('G01_ISSUER');
    if(claims.aud!==config.clientId||(claims.azp&&claims.azp!==config.clientId))throw Error('G02_AUDIENCE');
    if(typeof claims.sub!=='string'||claims.sub.length<8)throw Error('G03_SUBJECT');
    if(!Number.isInteger(claims.exp)||claims.exp<=now||
       !Number.isInteger(claims.iat)||claims.iat>now+60||claims.iat<now-600)
      throw Error('G04_TOKEN_EXPIRED');
    if(claims.nonce!==nonce)throw Error('G05_NONCE');
    if(claims.email_verified!==true)throw Error('G06_EMAIL_NOT_VERIFIED');
    if(String(claims.email||'').trim().toLowerCase()!==OWNER)throw Error('G07_OTHER_GOOGLE_ACCOUNT');
    return OWNER;
  }
  return {
    configured:true,
    login(req,res){
      const nonce=crypto.randomBytes(22).toString('base64url');
      const payload=Buffer.from(JSON.stringify({nonce,issued:Date.now()})).toString('base64url');
      const jsNonce=crypto.randomBytes(18).toString('base64url');
      const body=[
        '<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
        '<title>'+escapeHtml(loginTitle)+' — Google Owner</title>',
        '<style>body{font:16px system-ui;background:#101a2d;color:#fff;min-height:90vh;display:grid;place-items:center}main{max-width:400px;padding:28px;border:1px solid #384966;border-radius:14px;text-align:center}p{color:#d3dce9}#error{color:#fecaca}</style>',
        '<main><h2>'+escapeHtml(loginTitle)+'</h2><p>'+escapeHtml(loginDescription)+'</p>',
        '<div id="g_id_onload" data-client_id="'+escapeHtml(config.clientId)+'" data-nonce="'+escapeHtml(nonce)+'" data-callback="phoneboxGoogle" data-auto_prompt="false"></div>',
        '<div class="g_id_signin" data-type="standard" data-size="large" data-text="signin_with" data-shape="pill"></div>',
        '<p id="error" role="alert"></p></main>',
        '<script nonce="'+jsNonce+'">async function phoneboxGoogle(token){try{const r=await fetch("/__auth/google/credential",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",body:JSON.stringify({credential:token.credential})});if(!r.ok){const info=await r.json().catch(()=>({}));throw Error(info.code||"G99")}location.replace("/")}catch(e){const code=String(e.message||"G99");document.getElementById("error").textContent=code==="G07_OTHER_GOOGLE_ACCOUNT"?"Tài khoản Google này chưa được cấp quyền ("+code+")":code==="G09_LOGIN_COOKIE"?"Phiên đăng nhập hết hạn. Tải lại trang rồi thử lại ("+code+")":"Đăng nhập chưa thành công ("+code+")."}}</script>',
        '<script src="https://accounts.google.com/gsi/client" async defer></script></html>'
      ].join('');
      res.setHeader('Set-Cookie',COOKIE+'='+payload+'.'+sign(payload,key)+'; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=300');
      res.setHeader('Content-Security-Policy',
        "default-src 'none'; script-src 'nonce-"+jsNonce+"' https://accounts.google.com; frame-src https://accounts.google.com; connect-src 'self' https://accounts.google.com; style-src 'unsafe-inline' https://accounts.google.com; img-src 'self' data: https://*.googleusercontent.com; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
      res.end(body);
    },
    async credential(req,res,setAdminSession){
      function rejectEarly(status,code){
        console.warn('PhoneBox Google auth reject:',expectedOrigin,code);
        res.writeHead(status,{'Content-Type':'application/json; charset=utf-8',
          'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
        res.end(JSON.stringify({error:'Google sign-in request not accepted',code}));
      }
      if(req.method!=='POST'||req.headers.origin!==expectedOrigin||
         req.headers['sec-fetch-site']==='cross-site')
        return rejectEarly(403,'G08_ORIGIN');
      if(!String(req.headers['content-type']||'').startsWith('application/json'))
        return rejectEarly(415,'G10_CONTENT_TYPE');
      const nonce=validatedNonce(req,key);
      if(!nonce)return rejectEarly(403,'G09_LOGIN_COOKIE');
      try{
        let body='';
        for await(const part of req){
          body+=Buffer.from(part).toString('utf8');
          if(body.length>18000)return deny(res,413,'Too large');
        }
        const json=JSON.parse(body);
        await verify(json.credential,nonce);
        setAdminSession(res);
        const prev=res.getHeader('Set-Cookie');
        res.setHeader('Set-Cookie',[...(Array.isArray(prev)?prev:[prev].filter(Boolean)),
          COOKIE+'=; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=0']);
        res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
        res.end('{"authorized":true}');
      }catch(e){
        // Safe diagnostic codes only; never log or return Google tokens, email claims,
        // private keys, signed cookies or external request content.
        const allowed=new Set(['G01_ISSUER','G02_AUDIENCE','G03_SUBJECT',
          'G04_TOKEN_EXPIRED','G05_NONCE','G06_EMAIL_NOT_VERIFIED',
          'G07_OTHER_GOOGLE_ACCOUNT','SIGNATURE_INVALID',
          'GOOGLE_KEYS_UNAVAILABLE','GOOGLE_KEYS_INVALID','UNKNOWN_GOOGLE_KEY']);
        const code=allowed.has(String(e?.message))?String(e.message):'G99_UNCLASSIFIED';
        console.warn('PhoneBox Google auth reject:',expectedOrigin,code);
        res.writeHead(403,{'Content-Type':'application/json; charset=utf-8',
          'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
        res.end(JSON.stringify({error:'Google identity was not accepted',code}));
      }
    }
  };
}
export {makeGoogleOAuth};
