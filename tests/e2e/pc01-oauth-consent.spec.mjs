import { test, expect } from '@playwright/test';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { createPc01AuthorizationServer, ownerCodeDigest, CHATGPT_CLIENT, CHATGPT_REDIRECT } from '../../apps/tigeriq-core/pc01-authorization-server.mjs';

test('PC01 consent reaches only the exact ChatGPT callback as GET without Owner credentials', async ({ page, context }) => {
  // All traffic and credentials are synthetic; no PC01 or ChatGPT account is contacted.
  const origin='https://pc01.example.test', resource=origin+'/mcp';
  const ownerCode='synthetic-browser-owner-code-not-a-real-secret-123456';
  const salt='b'.repeat(32), verifier='v'.repeat(43), audit=[];
  const keys=generateKeyPairSync('rsa',{modulusLength:2048});
  const auth=createPc01AuthorizationServer({config:{issuerUrl:origin+'/',resourceUrl:resource,
    ownerSubject:'windows:S-1-5-21-1000',ownerCodeSalt:salt,ownerCodeHash:ownerCodeDigest(ownerCode,salt),
    privateKeyPem:keys.privateKey.export({type:'pkcs8',format:'pem'})},
    audit:event=>audit.push(event),
    fetchImpl:async()=>new Response(JSON.stringify({client_id:CHATGPT_CLIENT,redirect_uris:[CHATGPT_REDIRECT],token_endpoint_auth_methods_supported:['none']}))});
  const dispatch=async (url,method,headers,data='')=>{
    const req=Readable.from(data?[Buffer.from(data)]:[]);req.method=method;req.headers=headers;
    const res={status:0,headers:{},body:'',setHeader(k,v){this.headers[k.toLowerCase()]=v;},
      writeHead(status,headers={}){this.status=status;for(const [k,v] of Object.entries(headers))this.setHeader(k,v);return this;},
      end(data=''){this.body+=data;return this;}};
    await auth.handle(req,res,new URL(url));return res;
  };
  const callbacks=[], approvals=[];
  await context.route('**/*',async route=>{
    const req=route.request(), url=new URL(req.url());
    if(url.origin===origin){
      if(url.pathname==='/oauth/approve')approvals.push(req.method());
      const result=await dispatch(req.url(),req.method(),await req.allHeaders(),req.postData()||'');
      await route.fulfill({status:result.status,headers:result.headers,body:result.body});return;
    }
    if(url.origin+url.pathname===CHATGPT_REDIRECT){
      callbacks.push({method:req.method(),url:req.url(),body:req.postData()});
      await route.fulfill({status:200,contentType:'text/html',body:'<h1>Synthetic callback accepted</h1>'});return;
    }
    await route.abort();
  });
  const params=new URLSearchParams({client_id:CHATGPT_CLIENT,redirect_uri:CHATGPT_REDIRECT,response_type:'code',
    resource,scope:'mcp:read pc01:execute pc01:admin',state:'browser-fixture-state',
    code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});
  await page.goto(origin+'/oauth/authorize?'+params);
  await page.locator('input[name=owner_code]').fill(ownerCode);
  await page.getByRole('button',{name:'ĐĂNG NHẬP VÀ CẤP QUYỀN'}).click();
  await expect(page.getByRole('heading',{name:'Synthetic callback accepted'})).toBeVisible({timeout:7000});
  expect(approvals).toEqual(['POST']);
  expect(callbacks).toHaveLength(1);
  expect(callbacks[0].method).toBe('GET');
  expect(callbacks[0].body).toBeNull();
  expect(callbacks[0].url).not.toContain(ownerCode);
  const callback=new URL(callbacks[0].url);
  expect(callback.searchParams.get('state')).toBe('browser-fixture-state');
  expect(callback.searchParams.get('iss')).toBe(origin+'/');
  const data=new URLSearchParams({grant_type:'authorization_code',client_id:CHATGPT_CLIENT,
    redirect_uri:CHATGPT_REDIRECT,resource,code:callback.searchParams.get('code'),code_verifier:verifier});
  const exchange=()=>dispatch(origin+'/oauth/token','POST',{'content-type':'application/x-www-form-urlencoded'},data.toString());
  expect((await exchange()).status).toBe(200);
  expect((await exchange()).status).toBe(400);
  expect(audit.filter(e=>e.event==='OAUTH_OWNER_CONSENT_GRANTED')).toHaveLength(1);
});
