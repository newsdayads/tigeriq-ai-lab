import { createHash, createPrivateKey, createPublicKey, randomBytes, scryptSync, sign, timingSafeEqual } from 'node:crypto';
import { OAUTH_SCOPES, exactHttpsUrl } from './pc-operator-oauth-policy.mjs';

export const CHATGPT_CLIENT = 'https://chatgpt.com/oauth/client.json';
export const CHATGPT_REDIRECT = 'https://chatgpt.com/connector_platform_oauth_redirect';
const hash = value => createHash('sha256').update(value).digest('hex');
const random = () => randomBytes(32).toString('base64url');
const escapeHtml = value => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const same = (a, b) => {
  const left = Buffer.from(String(a)), right = Buffer.from(String(b));
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
};
function json(res, status, value) {
  res.writeHead(status, {'Content-Type':'application/json','Cache-Control':'no-store','Pragma':'no-cache'}).end(JSON.stringify(value));
}
async function body(req) {
  if (!String(req.headers['content-type'] || '').startsWith('application/x-www-form-urlencoded')) throw Error('invalid_request');
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > 8192) throw Error('invalid_request');
    chunks.push(Buffer.from(chunk));
  }
  const data = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
  for (const key of new Set(data.keys())) if (data.getAll(key).length !== 1) throw Error('invalid_request');
  return data;
}
export function ownerCodeDigest(code, salt) {
  return scryptSync(code, salt, 32, {N:16384,r:8,p:1}).toString('hex');
}
export function createPc01AuthorizationServer({config, fetchImpl = fetch, now = Date.now, audit = () => {}}) {
  const issuer = exactHttpsUrl(config.issuerUrl);
  const resource = exactHttpsUrl(config.resourceUrl, {resource:true});
  const origin = new URL(issuer).origin;
  if (issuer !== origin + '/' || new URL(resource).origin !== origin) throw Error('SELF_HOSTED_ORIGIN_INVALID');
  if (!/^[a-f0-9]{64}$/.test(config.ownerCodeHash || '') || !/^[a-f0-9]{32,128}$/.test(config.ownerCodeSalt || '') ||
      typeof config.ownerSubject !== 'string' || !/^windows:S-1-5-[0-9-]+$/.test(config.ownerSubject)) throw Error('OWNER_LOGIN_NOT_CONFIGURED');
  const key = createPrivateKey(config.privateKeyPem);
  if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength < 2048) throw Error('SIGNING_KEY_INVALID');
  const publicJwk = createPublicKey(key).export({format:'jwk'});
  const kid = hash(publicJwk.n).slice(0,24);
  const pending = new Map(), codes = new Map(), refresh = new Map();
  let cachedClient = null, clientAt = 0, loginWindow = 0, loginCount = 0;
  const prune = map => { for (const [id, item] of map) if (item.expires <= now()) map.delete(id); };
  function limited(map) { prune(map); if (map.size >= 1000) throw Error('temporarily_unavailable'); }
  const events = (event, extra = {}) => audit({event, ...extra, at:new Date(now()).toISOString()});
  async function client() {
    if (cachedClient && now() - clientAt < 300000) return cachedClient;
    const response = await fetchImpl(CHATGPT_CLIENT, {redirect:'error', signal:AbortSignal.timeout(5000), headers:{accept:'application/json'}});
    if (!response.ok) throw Error('invalid_client');
    const text = await response.text();
    if (Buffer.byteLength(text) > 32768) throw Error('invalid_client');
    const doc = JSON.parse(text);
    const methods = doc.token_endpoint_auth_methods_supported || [doc.token_endpoint_auth_method];
    if ((doc.client_id && doc.client_id !== CHATGPT_CLIENT) || !Array.isArray(doc.redirect_uris) ||
        !doc.redirect_uris.includes(CHATGPT_REDIRECT) || !Array.isArray(methods) || !methods.includes('none')) throw Error('invalid_client');
    cachedClient = doc; clientAt = now(); return doc;
  }
  function requestParams(params) {
    for (const name of new Set(params.keys())) if (params.getAll(name).length !== 1) throw Error('invalid_request');
    if (params.get('client_id') !== CHATGPT_CLIENT || params.get('redirect_uri') !== CHATGPT_REDIRECT) throw Error('invalid_client');
    if (params.get('response_type') !== 'code' || params.get('resource') !== resource) throw Error('invalid_request');
    if (params.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(params.get('code_challenge') || '')) throw Error('invalid_request');
    const scopeText = params.get('scope') || '';
    const scopes = [...new Set(scopeText.split(/\s+/).filter(Boolean))];
    if (!scopes.includes('mcp:read') || scopes.some(scope => !OAUTH_SCOPES.includes(scope))) throw Error('invalid_scope');
    const state = params.get('state') || '';
    if (!state || state.length > 2048 || /[\x00-\x1f]/.test(state)) throw Error('invalid_request');
    return {clientId:CHATGPT_CLIENT,redirectUri:CHATGPT_REDIRECT,resource,scopes,state,challenge:params.get('code_challenge')};
  }
  function tokens(grant, familyExpires = now() + 86400000) {
    limited(refresh);
    const seconds = Math.floor(now()/1000);
    const header = Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT',kid})).toString('base64url');
    const payload = Buffer.from(JSON.stringify({iss:issuer,aud:resource,sub:config.ownerSubject,
      iat:seconds,exp:seconds+600,jti:random(),scope:grant.scopes.join(' ')})).toString('base64url');
    const input = header + '.' + payload;
    const access = input + '.' + sign('RSA-SHA256', Buffer.from(input), key).toString('base64url');
    const renewal = random();
    refresh.set(hash(renewal), {...grant, expires:familyExpires});
    events('OAUTH_TOKEN_ISSUED', {clientId:grant.clientId,scopes:grant.scopes});
    return {access_token:access,token_type:'Bearer',expires_in:600,scope:grant.scopes.join(' '),refresh_token:renewal};
  }
  const metadata = {
    issuer,authorization_endpoint:origin+'/oauth/authorize',token_endpoint:origin+'/oauth/token',
    jwks_uri:origin+'/oauth/jwks',response_types_supported:['code'],
    grant_types_supported:['authorization_code','refresh_token'],code_challenge_methods_supported:['S256'],
    token_endpoint_auth_methods_supported:['none'],client_id_metadata_document_supported:true,
    authorization_response_iss_parameter_supported:true,scopes_supported:[...OAUTH_SCOPES],
  };
  async function handle(req, res, url) {
    const path = url.pathname;
    let stage = 'route';
    if (!path.startsWith('/oauth/') && !path.startsWith('/.well-known/oauth-')) return false;
    res.setHeader('Cache-Control','no-store'); res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','same-origin'); res.setHeader('X-Frame-Options','DENY');
    try {
      if (req.method === 'GET' && ['/\.well-known/oauth-authorization-server'.replace('\\',''),'/.well-known/openid-configuration'].includes(path)) {
        json(res,200,metadata); return true;
      }
      if (req.method === 'GET' && ['/.well-known/oauth-protected-resource','/.well-known/oauth-protected-resource/mcp'].includes(path)) {
        json(res,200,{resource,authorization_servers:[issuer],scopes_supported:[...OAUTH_SCOPES],bearer_methods_supported:['header']}); return true;
      }
      if (req.method === 'GET' && path === '/oauth/jwks') { json(res,200,{keys:[{...publicJwk,kid,alg:'RS256',use:'sig'}]}); return true; }
      if (req.method === 'GET' && path === '/oauth/authorize') {
        const grant = requestParams(url.searchParams); await client(); limited(pending);
        const id = random(), csrf = random(), nonce = random();
        pending.set(id,{...grant,csrfHash:hash(csrf),expires:now()+600000});
        res.setHeader('Set-Cookie','__Host-tigeriq_oauth_csrf='+csrf+'; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=600');
        res.setHeader('Content-Security-Policy',"default-src 'none';style-src 'unsafe-inline';form-action 'self';script-src 'nonce-"+nonce+"';base-uri 'none';frame-ancestors 'none'");
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end(
          '<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
          '<title>TigerIQ — cấp quyền PC01</title><style>body{font:16px system-ui;background:#101827;color:#fff;max-width:620px;margin:8vh auto;padding:24px}input,button{display:block;padding:14px;margin:16px 0;width:100%;box-sizing:border-box}code{word-break:break-all}</style>'+
          '<h1>ChatGPT → PC01</h1><p>Máy chủ: '+escapeHtml(origin)+'</p><p>Quyền yêu cầu: <code>'+escapeHtml(grant.scopes.join(' '))+'</code></p>'+
          '<p>Quyền Windows, cổng quản trị từng tác vụ và nhật ký vẫn được áp dụng.</p>'+
          '<form action="/oauth/approve" method="post"><input type="hidden" name="request_id" value="'+id+'">'+
          '<label>Mã Owner riêng trên PC01<input name="owner_code" type="password" autocomplete="off" required minlength="32" maxlength="192"></label>'+
          '<button type="submit">ĐĂNG NHẬP VÀ CẤP QUYỀN</button></form>'+
          '<script nonce="'+nonce+'">document.querySelector("form").addEventListener("submit",function(event){'+
          'if(this.dataset.submitted){event.preventDefault();return;}this.dataset.submitted="true";'+
          'const button=this.querySelector("button");button.disabled=true;button.textContent="ĐANG KẾT NỐI";});</script></html>');
        events('OAUTH_CONSENT_REQUESTED',{clientId:grant.clientId,scopes:grant.scopes}); return true;
      }
      if (req.method === 'POST' && path === '/oauth/approve') {
        stage = 'origin';
        if (req.headers.origin !== origin || String(req.headers['sec-fetch-site'] || '') === 'cross-site') throw Error('access_denied');
        stage = 'body';
        const params = await body(req), id = params.get('request_id') || '';
        stage = 'csrf';
        const grant = pending.get(id);
        const cookie = String(req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith('__Host-tigeriq_oauth_csrf='));
        const csrf = cookie ? cookie.slice('__Host-tigeriq_oauth_csrf='.length) : '';
        if (!grant || grant.expires <= now() || !same(hash(csrf),grant.csrfHash)) throw Error('access_denied');
        // A double click must not mint a second code or disturb the first exchange.
        // Retain only the CSRF-bound consumed marker until the original expiry.
        if (grant.approved) {
          events('OAUTH_APPROVAL_DUPLICATE',{method:req.method,path,status:409});
          json(res,409,{error:'approval_already_processed'}); return true;
        }
        stage = 'owner_login';
        if (now()-loginWindow >= 60000) { loginWindow=now(); loginCount=0; }
        if (++loginCount > 10) throw Error('temporarily_unavailable');
        const ownerCode = params.get('owner_code') || '';
        if (ownerCode.length < 32 || ownerCode.length > 192 || !same(ownerCodeDigest(ownerCode,config.ownerCodeSalt),config.ownerCodeHash)) {
          events('OAUTH_OWNER_LOGIN_DENIED'); throw Error('access_denied');
        }
        stage = 'code_issue';
        limited(codes);
        pending.set(id,{csrfHash:grant.csrfHash,expires:grant.expires,approved:true});
        const code = random(); codes.set(hash(code),{...grant,expires:now()+60000});
        const redirect = new URL(grant.redirectUri);
        redirect.searchParams.set('code',code);redirect.searchParams.set('state',grant.state);redirect.searchParams.set('iss',issuer);
        res.setHeader('Set-Cookie','__Host-tigeriq_oauth_csrf=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0');
        res.writeHead(303,{location:redirect.href}).end();events('OAUTH_OWNER_CONSENT_GRANTED',{clientId:grant.clientId,scopes:grant.scopes}); return true;
      }
      if (req.method === 'POST' && path === '/oauth/token') {
        stage = 'token_client';
        const params = await body(req);
        if (req.headers.authorization || params.get('client_id') !== CHATGPT_CLIENT) throw Error('invalid_client');
        let grant;
        if (params.get('grant_type') === 'authorization_code') {
          stage = 'code_exchange';
          const codeHash = hash(params.get('code') || ''); grant = codes.get(codeHash);
          const verifier = params.get('code_verifier') || '';
          if (!grant || grant.expires <= now() || params.get('redirect_uri') !== grant.redirectUri ||
              params.get('resource') !== grant.resource || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) ||
              !same(createHash('sha256').update(verifier).digest('base64url'),grant.challenge)) throw Error('invalid_grant');
          codes.delete(codeHash);
          json(res,200,tokens(grant));return true;
        }
        if (params.get('grant_type') === 'refresh_token') {
          stage = 'refresh_exchange';
          const renewalHash = hash(params.get('refresh_token') || ''); grant = refresh.get(renewalHash);
          if (!grant || grant.expires <= now() || grant.clientId !== params.get('client_id') ||
              (params.has('resource') && params.get('resource') !== grant.resource) ||
              (params.has('scope') && params.get('scope') !== grant.scopes.join(' '))) throw Error('invalid_grant');
          refresh.delete(renewalHash);
          json(res,200,tokens(grant,grant.expires));return true;
        }
        throw Error('unsupported_grant_type');
      }
      json(res,404,{error:'not_found'});return true;
    } catch (error) {
      const allowed = ['invalid_request','invalid_client','invalid_scope','access_denied','invalid_grant','unsupported_grant_type','temporarily_unavailable'];
      const reason = allowed.includes(error?.message) ? error.message : 'temporarily_unavailable';
      events('OAUTH_REQUEST_DENIED',{reason,method:req.method,path,stage});
      json(res,reason === 'access_denied' ? 403 : reason === 'temporarily_unavailable' ? 503 : 400,{error:reason});
      return true;
    }
  }
  return Object.freeze({handle,metadata,config:Object.freeze({
    issuerUrl:issuer,resourceUrl:resource,jwksUrl:metadata.jwks_uri,
    authorizationEndpoint:metadata.authorization_endpoint,tokenEndpoint:metadata.token_endpoint,registrationEndpoint:'',
  })});
}
