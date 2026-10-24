import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const OWNER_EMAIL = String(process.env.TIGERIQ_OWNER_EMAIL || 'newsdayads@gmail.com').trim().toLowerCase();
const CLIENT_ID = String(process.env.TIGERIQ_OWNER_GOOGLE_CLIENT_ID || '').trim();
const CLIENT_SECRET = String(process.env.TIGERIQ_OWNER_GOOGLE_CLIENT_SECRET || '').trim();
const REDIRECT_URI = String(process.env.TIGERIQ_OWNER_OAUTH_REDIRECT_URI || '').trim();
const SESSION_SECRET = String(process.env.TIGERIQ_OWNER_SESSION_SECRET || '').trim();
const SESSION_COOKIE = 'tigeriq_owner_session';
const STATE_COOKIE = 'tigeriq_owner_oauth_state';
const MAX_AGE_SECONDS = 8 * 60 * 60;
const INTERNAL_KEY_SHA256 = String(process.env.TIGERIQ_OWNER_INTERNAL_KEY_SHA256 || '').trim().toLowerCase();
const OWNER_ORIGIN = 'https://tigeriq-ai-lab.vercel.app';
function internalConfigured(){return /^[a-f0-9]{64}$/.test(INTERNAL_KEY_SHA256) && SESSION_SECRET.length >= 32;}
function googleConfigured(){return Boolean(OWNER_EMAIL && CLIENT_ID && CLIENT_SECRET && REDIRECT_URI && SESSION_SECRET);}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  res.end(JSON.stringify(body));
}

function configured() {
  return internalConfigured() || googleConfigured();
}

function ownerWriteOrigin(req) {
  return String(req.headers?.host||'').toLowerCase()==='tigeriq-ai-lab.vercel.app'
    && String(req.headers?.origin||'')===OWNER_ORIGIN
    && req.headers?.['sec-fetch-site']!=='cross-site';
}
function internalKeyMatches(value) {
  if(!internalConfigured()||typeof value!=='string'||value.length<32||value.length>192
    || !/^[A-Za-z0-9_-]+$/.test(value))return false;
  return safeEqual(createHash('sha256').update(value).digest('hex'), INTERNAL_KEY_SHA256);
}
async function internalLoginBody(req) {
  if(req.body && typeof req.body==='object' && !Buffer.isBuffer(req.body))return req.body;
  let raw=''; for await(const chunk of req){raw+=Buffer.from(chunk).toString('utf8');if(raw.length>1024)throw Error('body_too_large')}
  if(String(req.headers?.['content-type']||'').startsWith('application/x-www-form-urlencoded'))
    return Object.fromEntries(new URLSearchParams(raw));
  try{return JSON.parse(raw||'{}')}catch{throw Error('body_invalid')}
}
function internalLoginPage(res) {
  res.statusCode=200;
  res.setHeader('content-type','text/html; charset=utf-8');
  res.setHeader('cache-control','no-store');
  res.setHeader('x-frame-options','DENY');
  res.setHeader('content-security-policy',"default-src 'none';style-src 'unsafe-inline';form-action 'self';base-uri 'none';frame-ancestors 'none'");
  res.end([
   '<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>TigerIQ Owner</title>',
   '<style>body{background:#101a2d;color:#fff;font:16px system-ui;min-height:100vh;display:grid;place-items:center;padding:16px;box-sizing:border-box}',
   'main{width:100%;max-width:440px;border:1px solid #3f5272;border-radius:16px;padding:24px;box-sizing:border-box}',
   'input,button{box-sizing:border-box;width:100%;height:50px;border-radius:9px;margin:8px 0;padding:10px;font:inherit}',
   'input{background:#0b1424;color:#fff;border:1px solid #6483ac}button{background:#285bb0;color:#fff;border:0;font-weight:700}',
   'p{color:#bfd0e3;line-height:1.5}a{color:#8ac4ff}</style>',
   '<main><h2>TigerIQ — Owner nội bộ</h2><p>Nhập mã Owner riêng để giao việc. Không cần Google.</p>',
   '<form method="POST" action="/api/owner-auth?action=internal-login">',
   '<label for="code">Mã Owner</label><input type="password" name="code" id="code" autocomplete="off" minlength="32" maxlength="192" required>',
   '<button type="submit">XÁC THỰC OWNER</button></form><p><a href="/">Quay lại TigerIQ</a></p></main></html>'
  ].join(''));
}
function cookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map((part) => {
    const index = part.indexOf('=');
    return index < 0 ? [] : [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter((entry) => entry.length === 2));
}

function sign(value) {
  return createHmac('sha256', SESSION_SECRET).update(value).digest('base64url');
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

function setCookie(res, name, value, maxAge = MAX_AGE_SECONDS) {
  const next=`${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
  const existing=res.getHeader('set-cookie');
  res.setHeader('set-cookie', existing ? [...(Array.isArray(existing)?existing:[existing]),next] : next);
}

function sessionValue(email) {
  const payload = Buffer.from(JSON.stringify({ email, exp: Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function isOwnerAuthorized(req) {
  if (!configured()) return false;
  const raw = cookies(req)[SESSION_COOKIE] || '';
  const [payload, signature] = raw.split('.');
  if (!payload || !signature || !safeEqual(sign(payload), signature)) return false;
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return value?.email === OWNER_EMAIL && Number(value?.exp || 0) > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function redirect(res, location) {
  res.statusCode = 302;
  res.setHeader('location', location);
  res.setHeader('cache-control', 'no-store');
  res.end();
}

async function exchangeCode(code) {
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenResponse.ok) throw new Error('google_token_exchange_failed');
  const tokens = await tokenResponse.json();
  const accessToken = String(tokens?.access_token || '');
  if (!accessToken) throw new Error('google_access_token_missing');
  const userResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!userResponse.ok) throw new Error('google_userinfo_failed');
  const user = await userResponse.json();
  const email = String(user?.email || '').trim().toLowerCase();
  if (email !== OWNER_EMAIL || user?.email_verified !== true) throw new Error('owner_email_not_authorized');
  return email;
}

export default async function handler(req, res) {
  const action = String(new URL(req.url || '/', 'https://localhost').searchParams.get('action') || 'status');
  if (action === 'internal-login') {
    if(req.method!=='POST')return json(res,405,{error:'method_not_allowed'});
    if(!internalConfigured())return json(res,503,{error:'internal_login_not_configured'});
    if(!ownerWriteOrigin(req))return json(res,403,{error:'invalid_owner_origin'});
    let payload;try{payload=await internalLoginBody(req)}catch{return json(res,400,{error:'invalid_login_body'})}
    if(!internalKeyMatches(payload?.code))return json(res,401,{error:'invalid_owner_code'});
    setCookie(res, SESSION_COOKIE, sessionValue(OWNER_EMAIL));
    return redirect(res,'/?owner=connected');
  }
  if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });
  if (action === 'status') return json(res, 200, { ok: true, configured: configured(), authenticated: isOwnerAuthorized(req), owner: OWNER_EMAIL, methods:{internal:internalConfigured(),google:googleConfigured()} });
  if (!configured()) return json(res, 503, { error: 'owner_auth_not_configured' });

  if (action === 'login' && internalConfigured()){
    if(String(req.headers?.host||'').toLowerCase()!=='tigeriq-ai-lab.vercel.app')
      return redirect(res,OWNER_ORIGIN+'/api/owner-auth?action=login');
    return internalLoginPage(res);
  }
  if (action === 'login' && googleConfigured()) {
    const nonce = randomBytes(24).toString('base64url');
    const state = `${nonce}.${sign(nonce)}`;
    setCookie(res, STATE_COOKIE, state, 600);
    const authorize = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authorize.search = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account',
    }).toString();
    return redirect(res, authorize.toString());
  }

  if (action === 'callback') {
    const url = new URL(req.url || '/', 'https://localhost');
    const expected = cookies(req)[STATE_COOKIE] || '';
    const state = url.searchParams.get('state') || '';
    const [nonce, signature] = state.split('.');
    if (!nonce || !signature || !safeEqual(state, expected) || !safeEqual(sign(nonce), signature)) return json(res, 400, { error: 'invalid_oauth_state' });
    try {
      const email = await exchangeCode(String(url.searchParams.get('code') || ''));
      setCookie(res, SESSION_COOKIE, sessionValue(email));
      setCookie(res, STATE_COOKIE, '', 0);
      return redirect(res, '/?owner=connected');
    } catch (error) {
      return json(res, 403, { error: String(error instanceof Error ? error.message : error).slice(0, 96) });
    }
  }
  return json(res, 400, { error: 'unsupported_action' });
}
