import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { runInNewContext } from 'node:vm';
import { createPc01AuthorizationServer, ownerCodeDigest, CHATGPT_CLIENT, CHATGPT_REDIRECT } from '../apps/tigeriq-core/pc01-authorization-server.mjs';
import { createOAuthResourceServer } from '../apps/tigeriq-core/pc-operator-oauth-runtime.mjs';

const origin='https://pc01.example.test', resource=origin+'/mcp';
const ownerCode='fixture-owner-code-only-not-a-real-secret-123456';
const salt='a'.repeat(32), verifier='v'.repeat(43);
const keys=generateKeyPairSync('rsa',{modulusLength:2048});
const base={issuerUrl:origin+'/',resourceUrl:resource,ownerSubject:'windows:S-1-5-21-1000',
  ownerCodeSalt:salt,ownerCodeHash:ownerCodeDigest(ownerCode,salt),privateKeyPem:keys.privateKey.export({type:'pkcs8',format:'pem'})};
function fixture() {
  let clock=1800000000000, fetches=0; const audit=[];
  const auth=createPc01AuthorizationServer({config:base,now:()=>clock,audit:e=>audit.push(e),fetchImpl:async url=>{
    expect(url).toBe(CHATGPT_CLIENT); fetches++;
    return new Response(JSON.stringify({client_id:CHATGPT_CLIENT,redirect_uris:[CHATGPT_REDIRECT],token_endpoint_auth_methods_supported:['none','private_key_jwt']}));
  }});
  async function call(path, {method='GET',data={},headers={}}={}) {
    const req=Readable.from(method==='POST'?[Buffer.from(typeof data==='string'?data:new URLSearchParams(data).toString())]:[]);
    req.method=method; req.headers={...(method==='POST'?{'content-type':'application/x-www-form-urlencoded'}:{}),...headers};
    const response={status:0,headers:{},body:'',setHeader(k,v){this.headers[k.toLowerCase()]=v;},
      writeHead(status,values={}){this.status=status;for(const [k,v] of Object.entries(values))this.setHeader(k,v);return this;},
      end(value=''){this.body+=value;return this;}};
    response.handled=await auth.handle(req,response,new URL(path,origin));
    return response;
  }
  const params=overrides=>new URLSearchParams({client_id:CHATGPT_CLIENT,redirect_uri:CHATGPT_REDIRECT,response_type:'code',
    resource,scope:'mcp:read pc01:execute pc01:admin',state:'opaque-state',
    code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',...overrides});
  async function pending(overrides={}) {
    const page=await call('/oauth/authorize?'+params(overrides));
    expect(page.status).toBe(200);
    return {id:page.body.match(/name="request_id" value="([^"]+)"/)[1],cookie:page.headers['set-cookie'].split(';')[0],page};
  }
  async function approve(request, overrides={}) {
    return call('/oauth/approve',{method:'POST',headers:{origin,cookie:request.cookie},data:{request_id:request.id,owner_code:ownerCode,...overrides}});
  }
  async function code() {
    const request=await pending(), response=await approve(request);
    expect(response.status).toBe(303);
    const result=new URL(response.headers.location);
    expect(result.searchParams.get('iss')).toBe(origin+'/');
    expect(result.searchParams.get('state')).toBe('opaque-state');
    return result.searchParams.get('code');
  }
  const exchange=(code, overrides={})=>call('/oauth/token',{method:'POST',data:{grant_type:'authorization_code',client_id:CHATGPT_CLIENT,
    redirect_uri:CHATGPT_REDIRECT,resource,code,code_verifier:verifier,...overrides}});
  return {auth,call,params,pending,approve,code,exchange,audit,advance:ms=>{clock+=ms;},now:()=>Math.floor(clock/1000),fetches:()=>fetches};
}
describe('PC01 Owner-authenticated self-hosted OAuth',()=>{
  it('uses POST/303/GET callback and does not issue another code for duplicate approval',async()=>{
    const f=fixture(), request=await f.pending();
    const [first, duplicate]=await Promise.all([f.approve(request),f.approve(request)]);
    expect(first.status).toBe(303);
    expect(duplicate.status).toBe(409);
    expect(duplicate.headers.location).toBeUndefined();
    const callback=new URL(first.headers.location);
    expect(callback.origin+callback.pathname).toBe(CHATGPT_REDIRECT);
    expect(callback.searchParams.get('state')).toBe('opaque-state');
    const code=callback.searchParams.get('code');
    expect((await f.exchange(code)).status).toBe(200);
    expect((await f.exchange(code)).status).toBe(400);
    expect(f.audit.filter(e=>e.event==='OAUTH_OWNER_CONSENT_GRANTED')).toHaveLength(1);
    expect(f.audit.filter(e=>e.event==='OAUTH_APPROVAL_DUPLICATE')).toHaveLength(1);
    const serialized=JSON.stringify(f.audit);
    expect(serialized).not.toContain(code);
    expect(serialized).not.toContain(request.id);
    expect(serialized).not.toContain(ownerCode);
  });
  it('keeps CSRF checks for duplicate approvals and records only safe request diagnostics',async()=>{
    const f=fixture(), request=await f.pending();
    await f.approve(request);
    const result=await f.call('/oauth/approve',{method:'POST',headers:{origin:'https://evil.test',cookie:request.cookie},
      data:{request_id:request.id,owner_code:ownerCode}});
    expect(result.status).toBe(403);
    expect(f.audit.at(-1)).toMatchObject({event:'OAUTH_REQUEST_DENIED',method:'POST',path:'/oauth/approve',stage:'origin',reason:'access_denied'});
    expect((await f.exchange('invalid-code')).status).toBe(400);
    expect(f.audit.at(-1)).toMatchObject({event:'OAUTH_REQUEST_DENIED',method:'POST',path:'/oauth/token',stage:'code_exchange',reason:'invalid_grant'});
  });
  it('locks repeated browser submit with a nonce-authorized script',async()=>{
    const f=fixture(), {page}=await f.pending();
    const script=page.body.match(/<script nonce="([^"]+)">([\s\S]*?)<\/script>/);
    expect(script).not.toBeNull();
    expect(page.headers['content-security-policy']).toContain("script-src 'nonce-"+script[1]+"'");
    let submit;
    const button={disabled:false,textContent:''};
    const form={dataset:{},querySelector:()=>button,addEventListener:(name,handler)=>{expect(name).toBe('submit');submit=handler;}};
    runInNewContext(script[2],{document:{querySelector:()=>form}});
    const first={preventDefault:()=>{throw Error('first submit blocked');}};
    submit.call(form,first);
    expect(button.disabled).toBe(true);
    let blocked=false;
    submit.call(form,{preventDefault:()=>{blocked=true;}});
    expect(blocked).toBe(true);
  });
  it('publishes exact issuer, S256, CIMD and public-only JWKS',async()=>{
    const f=fixture(), metadata=await f.call('/.well-known/oauth-authorization-server');
    expect(JSON.parse(metadata.body)).toMatchObject({issuer:origin+'/',client_id_metadata_document_supported:true,authorization_response_iss_parameter_supported:true,code_challenge_methods_supported:['S256']});
    const jwks=JSON.parse((await f.call('/oauth/jwks')).body);
    expect(jwks.keys[0]).toMatchObject({kty:'RSA',alg:'RS256',use:'sig'});
    for(const name of ['d','p','q','dp','dq','qi'])expect(jwks.keys[0][name]).toBeUndefined();
  });
  it('keeps browser form Origin while suppressing cross-origin referrers',async()=>{
    const f=fixture(), request=await f.pending();
    // Basic HTML form POST uses a null Origin under no-referrer.
    // Keep strict Origin+CSRF validation; use a form-compatible policy.
    expect(request.page.headers['referrer-policy']).toBe('same-origin');
    expect((await f.call('/oauth/approve',{method:'POST',headers:{origin:'null',cookie:request.cookie},data:{request_id:request.id,owner_code:ownerCode}})).status).toBe(403);
    expect((await f.approve(request)).status).toBe(303);
  });
  it('requires Owner login and issues a verifiable audience/scoped RS256 token',async()=>{
    const f=fixture(), code=await f.code(), result=await f.exchange(code);
    expect(result.status).toBe(200); const tokens=JSON.parse(result.body);
    const jwks=JSON.parse((await f.call('/oauth/jwks')).body);
    const verifierServer=createOAuthResourceServer({config:f.auth.config,now:f.now,fetchImpl:async()=>new Response(JSON.stringify(jwks))});
    expect(await verifierServer.verifyBearer({authorization:'Bearer '+tokens.access_token})).toMatchObject({ok:true,principal:{sub:base.ownerSubject,aud:[resource],scopes:['mcp:read','pc01:execute','pc01:admin']}});
    const segments=tokens.access_token.split('.'); segments[2]=(segments[2][0]==='A'?'B':'A')+segments[2].slice(1);
    expect((await verifierServer.verifyBearer({authorization:'Bearer '+segments.join('.')})).ok).toBe(false);
    expect(JSON.stringify(f.audit)).not.toContain(ownerCode);
    expect(JSON.stringify(f.audit)).not.toContain(tokens.access_token);
    expect(JSON.stringify(f.audit)).not.toContain(tokens.refresh_token);
  });
  it('rejects owner-code failures and cross-origin/missing-CSRF approvals',async()=>{
    const f=fixture(), request=await f.pending();
    expect((await f.approve(request,{owner_code:'wrong'.repeat(10)})).status).toBe(403);
    expect((await f.call('/oauth/approve',{method:'POST',headers:{origin:'https://evil.test',cookie:request.cookie},data:{request_id:request.id,owner_code:ownerCode}})).status).toBe(403);
    expect((await f.call('/oauth/approve',{method:'POST',headers:{origin},data:{request_id:request.id,owner_code:ownerCode}})).status).toBe(403);
    expect((await f.approve(request)).status).toBe(303);
    expect((await f.approve(request)).status).toBe(409);
  });
  it.each([
    {client_id:'https://evil.test/client.json'},{redirect_uri:'https://evil.test/callback'},
    {redirect_uri:CHATGPT_REDIRECT+'?injected=1'},{resource:'https://evil.test/mcp'},
    {code_challenge_method:'plain'},{code_challenge:'bad'},{scope:'mcp:read system:admin'},{state:''},
  ])('rejects unsafe authorization parameters before network discovery: %j',async overrides=>{
    const f=fixture(), response=await f.call('/oauth/authorize?'+f.params(overrides));
    expect(response.status).toBe(400);expect(f.fetches()).toBe(0);expect(response.headers.location).toBeUndefined();
  });
  it('rejects duplicate parameters',async()=>{
    const f=fixture(), response=await f.call('/oauth/authorize?'+f.params({})+'&resource='+encodeURIComponent(resource));
    expect(response.status).toBe(400);
  });
  it('binds codes to S256, redirect, resource and client, then prevents replay',async()=>{
    const f=fixture(), code=await f.code();
    for(const overrides of [{code_verifier:'x'.repeat(43)},{redirect_uri:'https://evil.test'},{resource:'https://evil.test/mcp'},{client_id:'fake'}])
      expect((await f.exchange(code,overrides)).status).toBe(400);
    expect((await f.exchange(code)).status).toBe(200);
    expect((await f.exchange(code)).status).toBe(400);
  });
  it('expires pending consent and authorization codes',async()=>{
    const f=fixture(), request=await f.pending(); f.advance(600001);
    expect((await f.approve(request)).status).toBe(403);
    const code=await f.code();f.advance(60001);
    expect((await f.exchange(code)).status).toBe(400);
  });
  it('rotates refresh tokens, rejects replay, wrong client and scope expansion',async()=>{
    const f=fixture(), tokens=JSON.parse((await f.exchange(await f.code())).body);
    const renew=overrides=>f.call('/oauth/token',{method:'POST',data:{grant_type:'refresh_token',client_id:CHATGPT_CLIENT,refresh_token:tokens.refresh_token,...overrides}});
    expect((await renew({client_id:'fake'})).status).toBe(400);
    expect((await renew({scope:'mcp:read pc01:execute pc01:admin pc01:write'})).status).toBe(400);
    expect((await renew({})).status).toBe(200);
    expect((await renew({})).status).toBe(400);
  });
  it('expires refresh tokens',async()=>{
    const f=fixture(), tokens=JSON.parse((await f.exchange(await f.code())).body);f.advance(86400001);
    expect((await f.call('/oauth/token',{method:'POST',data:{grant_type:'refresh_token',client_id:CHATGPT_CLIENT,refresh_token:tokens.refresh_token}})).status).toBe(400);
  });
  it('bounds login attempts and request bodies',async()=>{
    const f=fixture(), request=await f.pending();
    for(let i=0;i<10;i++)expect((await f.approve(request,{owner_code:'wrong'.repeat(10)})).status).toBe(403);
    expect((await f.approve(request)).status).toBe(503);
    expect((await f.call('/oauth/token',{method:'POST',data:'x'.repeat(8193)})).status).toBe(400);
  });
  it('fails closed when Owner identity or signing key is not configured',()=>{
    expect(()=>createPc01AuthorizationServer({config:{...base,ownerCodeHash:''}})).toThrow('OWNER_LOGIN_NOT_CONFIGURED');
    expect(()=>createPc01AuthorizationServer({config:{...base,ownerSubject:'caller-supplied'}})).toThrow('OWNER_LOGIN_NOT_CONFIGURED');
  });
  it('persists refresh sessions across restart and supports explicit revocation',async()=>{
    const stored=[]; const store={load:()=>stored.slice(),save:items=>{stored.splice(0,stored.length,...items)},revoke:hash=>{const i=stored.findIndex(x=>x.hash===hash);if(i>=0)stored.splice(i,1)}};
    const first=fixture(); const tokens=JSON.parse((await first.exchange(await first.code())).body);
    stored.push({hash:createHash('sha256').update(tokens.refresh_token).digest('hex'),clientId:CHATGPT_CLIENT,redirectUri:CHATGPT_REDIRECT,resource,scopes:['mcp:read','pc01:execute','pc01:admin'],expires:null,familyId:'family'});
    const restarted=createPc01AuthorizationServer({config:base,now:()=>1800000000000+365*86400000,sessionStore:store,fetchImpl:async()=>new Response(JSON.stringify({client_id:CHATGPT_CLIENT,redirect_uris:[CHATGPT_REDIRECT],token_endpoint_auth_methods_supported:['none']}))});
    const call=(token,grant_type='refresh_token')=>{const req=Readable.from([Buffer.from(new URLSearchParams({grant_type,client_id:CHATGPT_CLIENT,...(grant_type==='revoke'?{token}:{refresh_token:token})}).toString())]);req.method='POST';req.headers={'content-type':'application/x-www-form-urlencoded'};const res={status:0,headers:{},body:'',setHeader(k,v){this.headers[k.toLowerCase()]=v},writeHead(status,v={}){this.status=status;Object.assign(this.headers,v);return this},end(v=''){this.body+=v;return this}};return restarted.handle(req,res,new URL('/oauth/token',origin)).then(()=>res)};
    const renewed=await call(tokens.refresh_token); expect(renewed.status).toBe(200); const rotated=JSON.parse(renewed.body).refresh_token;
    const revoked=await call(rotated,'revoke'); expect(revoked.status).toBe(204); expect(stored).toHaveLength(0);
  });
});
