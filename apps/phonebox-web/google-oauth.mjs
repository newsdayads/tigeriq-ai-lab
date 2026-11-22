// PhoneBox Owner Google OAuth (server-side authorization code + PKCE).
// Self-hosted on PC01. The admin role is never granted based only on a browser email.
import crypto from 'node:crypto';

const GOOGLE_AUTHORIZE='https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN='https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO='https://openidconnect.googleapis.com/v1/userinfo';
const STATE_COOKIE='__Host-pbgoogle-state';
const GOOGLE_STATE_MAX_SECONDS=600;
const OWNER='newsdayads@gmail.com';

function strictEqual(a,b) {
  const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));
  return x.length>0 && x.length===y.length && crypto.timingSafeEqual(x,y);
}
function findCookie(req,name) {
  for(const part of String(req.headers.cookie||'').split(';')) {
    const s=part.trim();
    if(s.startsWith(name+'='))return s.slice(name.length+1);
  }
  return '';
}
function cookie(value,maxAge) {
  return STATE_COOKIE+'='+value+'; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age='+maxAge;
}
function sign(payload,key) {
  return crypto.createHmac('sha256',key).update('phonebox-google:'+payload).digest('base64url');
}
function stateCookie(payload,key) {return payload+'.'+sign(payload,key);}
function readState(req,key) {
  const value=findCookie(req,STATE_COOKIE);
  const dot=value.indexOf('.');
  if(dot<1)return null;
  const payload=value.slice(0,dot),signature=value.slice(dot+1);
  if(!strictEqual(signature,sign(payload,key)))return null;
  try {
    const parsed=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
    if(typeof parsed.state!=='string'||typeof parsed.verifier!=='string'||
       !Number.isInteger(parsed.issued)||parsed.issued>Date.now()+30000||
       parsed.issued<Date.now()-GOOGLE_STATE_MAX_SECONDS*1000)return null;
    return parsed;
  }catch{return null;}
}
function localRedirect(res,target) {
  res.writeHead(303,{'Location':target,'Cache-Control':'no-store'});
  res.end();
}
function configured(config) {
  return Boolean(config?.clientId?.endsWith('.apps.googleusercontent.com') &&
    typeof config.clientSecret==='string' && config.clientSecret.length>=8 &&
    config.redirectUri==='https://phonebox.tigeriq.io.vn/__auth/google/callback' &&
    config.ownerEmail===OWNER &&
    /^[a-f0-9]{64,}$/.test(config.sessionKey));
}
function sendError(res,status,reason) {
  res.writeHead(status,{'Content-Type':'text/plain; charset=utf-8',
    'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(reason);
}
function makeGoogleOAuth(config,{fetchImpl=fetch,
  authorizeEndpoint=GOOGLE_AUTHORIZE,
  tokenEndpoint=GOOGLE_TOKEN,
  userEndpoint=GOOGLE_USERINFO}={}) {
  if(!configured(config)) throw new Error('PHONEBOX_GOOGLE_AUTH_NOT_CONFIGURED');
  const key=Buffer.from(config.sessionKey,'hex');
  return {
    configured:true,
    login(req,res){
      const state=crypto.randomBytes(24).toString('base64url');
      const verifier=crypto.randomBytes(32).toString('base64url');
      const challenge=crypto.createHash('sha256').update(verifier).digest('base64url');
      const payload=Buffer.from(JSON.stringify({state,verifier,issued:Date.now()})).toString('base64url');
      const url=new URL(authorizeEndpoint);
      url.search=new URLSearchParams({
        client_id:config.clientId,redirect_uri:config.redirectUri,
        response_type:'code',scope:'openid email',state,
        code_challenge:challenge,code_challenge_method:'S256',
        prompt:'select_account',access_type:'online'
      }).toString();
      res.setHeader('Set-Cookie',cookie(stateCookie(payload,key),GOOGLE_STATE_MAX_SECONDS));
      localRedirect(res,url.toString());
    },
    async callback(req,res,setAdminSession){
      res.setHeader('Set-Cookie',cookie('',0));
      const query=new URL(req.url,'https://phonebox.tigeriq.io.vn').searchParams;
      const state=readState(req,key);
      const code=query.get('code');
      if(!state||!strictEqual(state.state,query.get('state'))||
         typeof code!=='string'||code.length<8||code.length>4096)
        return sendError(res,403,'Google authentication state invalid');
      try{
        const tokenResponse=await fetchImpl(tokenEndpoint,{
          method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
          body:new URLSearchParams({
            grant_type:'authorization_code',code,client_id:config.clientId,
            client_secret:config.clientSecret,redirect_uri:config.redirectUri,
            code_verifier:state.verifier
          }),signal:AbortSignal.timeout(10000)
        });
        if(!tokenResponse.ok)throw Error('TOKEN_EXCHANGE_DENIED');
        const tokens=await tokenResponse.json();
        const accessToken=String(tokens.access_token||'');
        if(accessToken.length<12)throw Error('ACCESS_TOKEN_MISSING');
        const userResponse=await fetchImpl(userEndpoint,{
          headers:{Authorization:'Bearer '+accessToken},signal:AbortSignal.timeout(10000)
        });
        if(!userResponse.ok)throw Error('GOOGLE_USERINFO_DENIED');
        const identity=await userResponse.json();
        if(String(identity.email||'').trim().toLowerCase()!==OWNER||
           identity.email_verified!==true)throw Error('NOT_OWNER');
        // No email, OAuth code, access token or credential appears in the cookie.
        setAdminSession(res);
        return localRedirect(res,'/');
      }catch {
        return sendError(res,403,'Google Owner authentication failed');
      }
    }
  };
}
export {makeGoogleOAuth,configured as googleOAuthConfigured};
