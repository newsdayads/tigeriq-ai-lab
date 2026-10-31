import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { runInNewContext } from 'node:vm';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPc01AuthorizationServer, ownerCodeDigest, CHATGPT_CLIENT, CHATGPT_REDIRECT } from '../apps/tigeriq-core/pc01-authorization-server.mjs';
import { createOAuthResourceServer } from '../apps/tigeriq-core/pc-operator-oauth-runtime.mjs';
import { createOAuthSessionStore, verifyWindowsAcl, ensureSecureWindowsAcl, atomicWriteFile, withFileLock } from '../apps/tigeriq-core/mcp-funnel-gateway.mjs';

const origin='https://pc01.example.test', resource=origin+'/mcp';
const ownerCode='fixture-owner-code-only-not-a-real-secret-123456';
const salt='a'.repeat(32), verifier='v'.repeat(43);
const keys=generateKeyPairSync('rsa',{modulusLength:2048});
const base={issuerUrl:origin+'/',resourceUrl:resource,ownerSubject:'windows:S-1-5-21-1000',
  ownerCodeSalt:salt,ownerCodeHash:ownerCodeDigest(ownerCode,salt),privateKeyPem:keys.privateKey.export({type:'pkcs8',format:'pem'})};

function fixture(customStore = null) {
  let clock=1800000000000, fetches=0; const audit=[];
  const sessionStore = customStore || { load: () => [], save: () => {}, revoke: () => {} };
  const auth=createPc01AuthorizationServer({config:base,now:()=>clock,audit:e=>audit.push(e),sessionStore,fetchImpl:async url=>{
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
  async function code(overrides={}) {
    const request=await pending(overrides), response=await approve(request);
    expect(response.status).toBe(303);
    const result=new URL(response.headers.location);
    expect(result.searchParams.get('iss')).toBe(origin+'/');
    expect(result.searchParams.get('state')).toBe(overrides.state || 'opaque-state');
    return result.searchParams.get('code');
  }
  const exchange=(code, overrides={})=>call('/oauth/token',{method:'POST',data:{grant_type:'authorization_code',client_id:CHATGPT_CLIENT,
    redirect_uri:CHATGPT_REDIRECT,resource,code,code_verifier:verifier,...overrides}});
  return {auth,call,params,pending,approve,code,exchange,audit,advance:ms=>{clock+=ms;},now:()=>Math.floor(clock/1000),fetches:()=>fetches,clockVal:()=>clock};
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
    expect(JSON.parse(metadata.body)).toMatchObject({
      issuer:origin+'/',
      client_id_metadata_document_supported:true,
      authorization_response_iss_parameter_supported:true,
      code_challenge_methods_supported:['S256'],
      grant_types_supported:['authorization_code','refresh_token'],
      revocation_endpoint:origin+'/oauth/revoke',
    });
    const jwks=JSON.parse((await f.call('/oauth/jwks')).body);
    expect(jwks.keys[0]).toMatchObject({kty:'RSA',alg:'RS256',use:'sig'});
    for(const name of ['d','p','q','dp','dq','qi'])expect(jwks.keys[0][name]).toBeUndefined();
  });
  it('keeps browser form Origin while suppressing cross-origin referrers',async()=>{
    const f=fixture(), request=await f.pending();
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
    const firstRenew=await renew({});
    expect(firstRenew.status).toBe(200);
    const newTokens=JSON.parse(firstRenew.body);
    expect(newTokens.refresh_token).not.toBe(tokens.refresh_token);
    // Old token replay rejected
    expect((await renew({})).status).toBe(400);
  });
  it('keeps refresh sessions indefinitely until explicitly revoked',async()=>{
    const f=fixture(), tokens=JSON.parse((await f.exchange(await f.code())).body);
    f.advance(365*86400000);
    expect((await f.call('/oauth/token',{method:'POST',data:{grant_type:'refresh_token',client_id:CHATGPT_CLIENT,refresh_token:tokens.refresh_token}})).status).toBe(200);
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

  // RFC 7009 & standard OAuth revocation tests
  it('rejects non-standard grant_type: revoke on /oauth/token per RFC 6749',async()=>{
    const f=fixture(), tokens=JSON.parse((await f.exchange(await f.code())).body);
    const response=await f.call('/oauth/token',{method:'POST',data:{grant_type:'revoke',client_id:CHATGPT_CLIENT,token:tokens.refresh_token}});
    expect(response.status).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({error:'unsupported_grant_type'});
  });

  it('revokes a refresh session explicitly via RFC 7009 POST /oauth/revoke endpoint',async()=>{
    const f=fixture(), tokens=JSON.parse((await f.exchange(await f.code())).body);
    // Invalid client rejected
    const badClient=await f.call('/oauth/revoke',{method:'POST',data:{client_id:'https://evil.test',token:tokens.refresh_token}});
    expect(badClient.status).toBe(400);

    // Missing token rejected
    const missingToken=await f.call('/oauth/revoke',{method:'POST',data:{client_id:CHATGPT_CLIENT}});
    expect(missingToken.status).toBe(400);

    // Valid revocation succeeds with 200
    const revoked=await f.call('/oauth/revoke',{method:'POST',data:{client_id:CHATGPT_CLIENT,token:tokens.refresh_token}});
    expect(revoked.status).toBe(200);

    // Subsequent refresh token attempt fails
    expect((await f.call('/oauth/token',{method:'POST',data:{grant_type:'refresh_token',client_id:CHATGPT_CLIENT,refresh_token:tokens.refresh_token}})).status).toBe(400);

    // RFC 7009 Section 2.2: revoking an already-revoked or invalid token returns 200
    const revokedAgain=await f.call('/oauth/revoke',{method:'POST',data:{client_id:CHATGPT_CLIENT,token:tokens.refresh_token}});
    expect(revokedAgain.status).toBe(200);
  });

  // offline_access scope support
  it('supports offline_access scope in authorize request and metadata',async()=>{
    const f=fixture();
    const metadata=await f.call('/.well-known/oauth-authorization-server');
    const parsedMeta=JSON.parse(metadata.body);
    expect(parsedMeta.scopes_supported).toContain('offline_access');

    // Authorize with offline_access included
    const code=await f.code({scope:'mcp:read pc01:execute offline_access'});
    const exchangeResult=await f.exchange(code);
    expect(exchangeResult.status).toBe(200);
    const tokens=JSON.parse(exchangeResult.body);
    expect(tokens.scope).toContain('offline_access');
    expect(tokens.scope).toContain('mcp:read');

    // Refresh preserves offline_access
    const refreshResult=await f.call('/oauth/token',{method:'POST',data:{grant_type:'refresh_token',client_id:CHATGPT_CLIENT,refresh_token:tokens.refresh_token}});
    expect(refreshResult.status).toBe(200);
    const refreshedTokens=JSON.parse(refreshResult.body);
    expect(refreshedTokens.scope).toContain('offline_access');
  });

  // Replay detection revokes family
  it('detects refresh token replay and revokes the whole grant family',async()=>{
    const f=fixture(), tokens=JSON.parse((await f.exchange(await f.code())).body);
    const rt1=tokens.refresh_token;

    // First refresh: RT1 -> RT2
    const firstRefresh=await f.call('/oauth/token',{method:'POST',data:{grant_type:'refresh_token',client_id:CHATGPT_CLIENT,refresh_token:rt1}});
    expect(firstRefresh.status).toBe(200);
    const rt2=JSON.parse(firstRefresh.body).refresh_token;

    // Second refresh with valid RT2 -> RT3
    const secondRefresh=await f.call('/oauth/token',{method:'POST',data:{grant_type:'refresh_token',client_id:CHATGPT_CLIENT,refresh_token:rt2}});
    expect(secondRefresh.status).toBe(200);
    const rt3=JSON.parse(secondRefresh.body).refresh_token;

    // Now replay RT1 (already spent)!
    const replayAttempt=await f.call('/oauth/token',{method:'POST',data:{grant_type:'refresh_token',client_id:CHATGPT_CLIENT,refresh_token:rt1}});
    expect(replayAttempt.status).toBe(400);
    expect(f.audit.filter(e=>e.event==='OAUTH_REPLAY_DETECTED').length).toBeGreaterThanOrEqual(1);

    // Family is revoked: even the latest RT3 is now invalid!
    const compromisedUse=await f.call('/oauth/token',{method:'POST',data:{grant_type:'refresh_token',client_id:CHATGPT_CLIENT,refresh_token:rt3}});
    expect(compromisedUse.status).toBe(400);
  });

  // Persistence across server restart (new instance)
  it('persists sessions across gateway/PC01 restarts into a new instance without Owner code reentry',async()=>{
    const tmpDir=mkdtempSync(path.join(tmpdir(),'tigeriq-mcp-test-'));
    const storePath=path.join(tmpDir,'sessions.json');
    try {
      const store=createOAuthSessionStore(storePath);

      // Instance 1: Owner grants consent once
      let clock=1800000000000;
      const f1=fixture(store);
      const code=await f1.code();
      const tokens=JSON.parse((await f1.exchange(code)).body);
      const rt1=tokens.refresh_token;
      expect(tokens.expires_in).toBe(600); // 10 minute access token

      // Advance clock 15 minutes: access token is expired!
      clock+=15*60*1000;

      // Advance clock 25 hours: past old 24h hard limit!
      clock+=25*3600*1000;

      // Simulate PC01 restart: create a completely new server instance pointing to the same sessionStore
      const audit2=[];
      const auth2=createPc01AuthorizationServer({config:base,now:()=>clock,audit:e=>audit2.push(e),sessionStore:store,fetchImpl:async url=>new Response(JSON.stringify({client_id:CHATGPT_CLIENT,redirect_uris:[CHATGPT_REDIRECT],token_endpoint_auth_methods_supported:['none']}))});

      const call2=async(path,{method='GET',data={},headers={}}={})=>{
        const req=Readable.from(method==='POST'?[Buffer.from(typeof data==='string'?data:new URLSearchParams(data).toString())]:[]);
        req.method=method; req.headers={...(method==='POST'?{'content-type':'application/x-www-form-urlencoded'}:{}),...headers};
        const response={status:0,headers:{},body:'',setHeader(k,v){this.headers[k.toLowerCase()]=v;},
          writeHead(status,values={}){this.status=status;for(const [k,v] of Object.entries(values))this.setHeader(k,v);return this;},
          end(value=''){this.body+=value;return this;}};
        response.handled=await auth2.handle(req,response,new URL(path,origin));
        return response;
      };

      // Instance 2 successfully refreshes without Owner code prompt!
      const refreshResult=await call2('/oauth/token',{method:'POST',data:{grant_type:'refresh_token',client_id:CHATGPT_CLIENT,refresh_token:rt1}});
      expect(refreshResult.status).toBe(200);
      const tokens2=JSON.parse(refreshResult.body);
      expect(tokens2.access_token).toBeDefined();
      expect(tokens2.refresh_token).not.toBe(rt1);

      // Verify old token cannot be reused on instance 2
      expect((await call2('/oauth/token',{method:'POST',data:{grant_type:'refresh_token',client_id:CHATGPT_CLIENT,refresh_token:rt1}})).status).toBe(400);
    } finally {
      rmSync(tmpDir,{recursive:true,force:true});
    }
  });

  // Replay detection across restart
  it('detects replay across server restarts into a new instance',async()=>{
    const tmpDir=mkdtempSync(path.join(tmpdir(),'tigeriq-mcp-replay-'));
    const storePath=path.join(tmpDir,'sessions.json');
    try {
      const store=createOAuthSessionStore(storePath);
      let clock=1800000000000;
      const f1=fixture(store);
      const code=await f1.code();
      const tokens1=JSON.parse((await f1.exchange(code)).body);
      const rt1=tokens1.refresh_token;

      // Rotate RT1 -> RT2 on instance 1
      const refresh1=await f1.call('/oauth/token',{method:'POST',data:{grant_type:'refresh_token',client_id:CHATGPT_CLIENT,refresh_token:rt1}});
      expect(refresh1.status).toBe(200);
      const rt2=JSON.parse(refresh1.body).refresh_token;

      // Restart PC01: instance 2 loads store from disk
      const auth2=createPc01AuthorizationServer({config:base,now:()=>clock,sessionStore:store,fetchImpl:async()=>new Response(JSON.stringify({client_id:CHATGPT_CLIENT,redirect_uris:[CHATGPT_REDIRECT],token_endpoint_auth_methods_supported:['none']}))});
      const call2=async(path,{method='GET',data={},headers={}}={})=>{
        const req=Readable.from(method==='POST'?[Buffer.from(typeof data==='string'?data:new URLSearchParams(data).toString())]:[]);
        req.method=method; req.headers={...(method==='POST'?{'content-type':'application/x-www-form-urlencoded'}:{}),...headers};
        const response={status:0,headers:{},body:'',setHeader(k,v){this.headers[k.toLowerCase()]=v;},
          writeHead(status,values={}){this.status=status;for(const [k,v] of Object.entries(values))this.setHeader(k,v);return this;},
          end(value=''){this.body+=value;return this;}};
        response.handled=await auth2.handle(req,response,new URL(path,origin));
        return response;
      };

      // Replay RT1 on instance 2: must be detected as replay and rejected!
      const replayResult=await call2('/oauth/token',{method:'POST',data:{grant_type:'refresh_token',client_id:CHATGPT_CLIENT,refresh_token:rt1}});
      expect(replayResult.status).toBe(400);

      // RT2 is also invalidated due to replay
      const rt2Result=await call2('/oauth/token',{method:'POST',data:{grant_type:'refresh_token',client_id:CHATGPT_CLIENT,refresh_token:rt2}});
      expect(rt2Result.status).toBe(400);
    } finally {
      rmSync(tmpDir,{recursive:true,force:true});
    }
  });

  // Session store durability, atomic writes, locking, and recovery
  it('handles atomic writes, concurrent access, and corrupt JSON safely',async()=>{
    const tmpDir=mkdtempSync(path.join(tmpdir(),'tigeriq-mcp-durability-'));
    const storePath=path.join(tmpDir,'sessions.json');
    try {
      const store=createOAuthSessionStore(storePath);

      // Initial state is empty
      expect(store.load()).toEqual([]);

      // Atomic write
      store.save([{familyId:'f1',activeHash:'h1',spentHashes:[],revoked:false}]);
      expect(store.load()).toHaveLength(1);
      expect(existsSync(storePath)).toBe(true);

      // Backup exists
      expect(existsSync(storePath+'.bak')).toBe(true);

      // If main file is corrupted, it recovers from backup
      writeFileSync(storePath,'{corrupted json');
      expect(store.load()).toHaveLength(1);

      // Lock prevents concurrent corruption
      let locked=false;
      withFileLock(store.lockPath,()=>{
        locked=true;
        expect(existsSync(store.lockPath)).toBe(true);
      });
      expect(locked).toBe(true);
      expect(existsSync(store.lockPath)).toBe(false);
    } finally {
      rmSync(tmpDir,{recursive:true,force:true});
    }
  });

  // Concurrent refresh handling
  it('handles concurrent refresh requests safely without race condition',async()=>{
    const tmpDir=mkdtempSync(path.join(tmpdir(),'tigeriq-mcp-concurrent-'));
    const storePath=path.join(tmpDir,'sessions.json');
    try {
      const store=createOAuthSessionStore(storePath);
      const f=fixture(store);
      const code=await f.code();
      const tokens=JSON.parse((await f.exchange(code)).body);
      const rt=tokens.refresh_token;

      // Two simultaneous calls with the same refresh token
      const [res1, res2] = await Promise.all([
        f.call('/oauth/token',{method:'POST',data:{grant_type:'refresh_token',client_id:CHATGPT_CLIENT,refresh_token:rt}}),
        f.call('/oauth/token',{method:'POST',data:{grant_type:'refresh_token',client_id:CHATGPT_CLIENT,refresh_token:rt}}),
      ]);

      const statuses = [res1.status, res2.status].sort();
      // Exactly one must succeed (200), the other must be rejected (400)
      expect(statuses).toEqual([200, 400]);
    } finally {
      rmSync(tmpDir,{recursive:true,force:true});
    }
  });

  // Explicit timing test for access token expiration vs refresh persistence
  it('verifies access token expiration at 10m and refresh succession at 10m, 24h, 365d',async()=>{
    const f=fixture();
    const code=await f.code();
    const tokens=JSON.parse((await f.exchange(code)).body);

    const jwks=JSON.parse((await f.call('/oauth/jwks')).body);
    const verifierServer=createOAuthResourceServer({config:f.auth.config,now:f.now,fetchImpl:async()=>new Response(JSON.stringify(jwks))});

    // Access token is valid right now
    const validCheck=await verifierServer.verifyBearer({authorization:'Bearer '+tokens.access_token});
    expect(validCheck.ok).toBe(true);

    // After 10 minutes (601 seconds), access token is expired
    f.advance(601*1000);
    const expiredCheck=await verifierServer.verifyBearer({authorization:'Bearer '+tokens.access_token});
    expect(expiredCheck.ok).toBe(false);
    expect(expiredCheck.reason).toBe('OAUTH_CLAIMS_INVALID');

    // But refresh token still works at 10m!
    const renew1=await f.call('/oauth/token',{method:'POST',data:{grant_type:'refresh_token',client_id:CHATGPT_CLIENT,refresh_token:tokens.refresh_token}});
    expect(renew1.status).toBe(200);
    const tokens1=JSON.parse(renew1.body);

    // After 24 hours, refresh token still works!
    f.advance(24*3600*1000);
    const renew2=await f.call('/oauth/token',{method:'POST',data:{grant_type:'refresh_token',client_id:CHATGPT_CLIENT,refresh_token:tokens1.refresh_token}});
    expect(renew2.status).toBe(200);
    const tokens2=JSON.parse(renew2.body);

    // After 365 days, refresh token still works!
    f.advance(365*24*3600*1000);
    const renew3=await f.call('/oauth/token',{method:'POST',data:{grant_type:'refresh_token',client_id:CHATGPT_CLIENT,refresh_token:tokens2.refresh_token}});
    expect(renew3.status).toBe(200);
  });

  // Windows ACL verification
  it('verifies and tightens access control on Windows',async()=>{
    const tmpDir=mkdtempSync(path.join(tmpdir(),'tigeriq-mcp-acl-'));
    try {
      if (process.platform === 'win32') {
        const secureResult = ensureSecureWindowsAcl(tmpDir);
        expect(secureResult).toBe(true);
        const audit = verifyWindowsAcl(tmpDir);
        expect(audit.secure).toBe(true);
      } else {
        const audit = verifyWindowsAcl(tmpDir);
        expect(audit.secure).toBe(true);
      }
    } finally {
      rmSync(tmpDir,{recursive:true,force:true});
    }
  });
});
