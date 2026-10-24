import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

test('Owner internal login: first-party challenge, session, CSRF and access denial',async()=>{
 const keys=['TIGERIQ_OWNER_INTERNAL_KEY_SHA256','TIGERIQ_OWNER_SESSION_SECRET','TIGERIQ_OWNER_GOOGLE_CLIENT_ID','TIGERIQ_OWNER_GOOGLE_CLIENT_SECRET','TIGERIQ_OWNER_OAUTH_REDIRECT_URI'];
 const previous=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 const code='synthetic_CI_internal_owner_key_0123456789abcdefghijklmnopqrstuvwxyz';
 process.env.TIGERIQ_OWNER_INTERNAL_KEY_SHA256=createHash('sha256').update(code).digest('hex');
 process.env.TIGERIQ_OWNER_SESSION_SECRET='synthetic_internal_session_secret_0123456789abcdef';
 process.env.TIGERIQ_OWNER_GOOGLE_CLIENT_ID='synthetic-google-client';
 process.env.TIGERIQ_OWNER_GOOGLE_CLIENT_SECRET='synthetic-google-secret';
 process.env.TIGERIQ_OWNER_OAUTH_REDIRECT_URI='https://stale-preview.example.test/api/owner-auth?action=callback';
 const {default:handler,isOwnerAuthorized}=await import('../api/owner-auth.mjs?internalOwnerTest=5252');
 const mkres=()=>{
   const headers=new Map();return {statusCode:200,body:'',
    setHeader(key,value){headers.set(String(key).toLowerCase(),value)},
    getHeader(key){return headers.get(String(key).toLowerCase())},
    end(body=''){this.body=String(body||'')}};
 };
 const req=(method,url,body,origin='https://tigeriq-ai-lab.vercel.app')=>({method,url,body,
  headers:{host:'tigeriq-ai-lab.vercel.app',origin,'content-type':'application/json','sec-fetch-site':'same-origin'}});
 try{
   const status=mkres();
   await handler(req('GET','/api/owner-auth?action=status'),status);
   assert.equal(status.statusCode,200);
   assert.equal(JSON.parse(status.body).methods.internal,true);

   const login=mkres();
   await handler(req('GET','/api/owner-auth?action=login'),login);
   assert.equal(login.statusCode,200);
   assert.ok(login.body.includes('Không cần Google'));
   assert.ok(login.body.includes('method="POST"'));

   const unauthorized=mkres();
   await handler(req('POST','/api/owner-auth?action=internal-login',{code:'bad'}),unauthorized);
   assert.equal(unauthorized.statusCode,401);
   assert.equal(unauthorized.getHeader('set-cookie'),undefined);

   const crossSite=mkres();
   await handler(req('POST','/api/owner-auth?action=internal-login',{code},'https://attacker.invalid'),crossSite);
   assert.equal(crossSite.statusCode,403);
   assert.equal(crossSite.getHeader('set-cookie'),undefined);

   const valid=mkres();
   await handler(req('POST','/api/owner-auth?action=internal-login',{code}),valid);
   assert.equal(valid.statusCode,302);
   assert.equal(valid.getHeader('location'),'/?owner=connected');
   const session=String(valid.getHeader('set-cookie')||'');
   assert.ok(session.startsWith('tigeriq_owner_session='));
   for(const part of ['HttpOnly','Secure','SameSite=Lax','Max-Age=28800'])assert.ok(session.includes(part),part);
   const cookie=session.split(';')[0];
   assert.equal(isOwnerAuthorized({headers:{cookie}}),true);
   assert.equal(isOwnerAuthorized({headers:{cookie:'tigeriq_owner_session=forged'}}),false);

   const alias=mkres();
   await handler({method:'GET',url:'/api/owner-auth?action=login',headers:{host:'outdated-preview.vercel.app'}},alias);
   assert.equal(alias.statusCode,302);
   assert.equal(alias.getHeader('location'),'https://tigeriq-ai-lab.vercel.app/api/owner-auth?action=login');
 }finally{
   for(const key of keys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key]}
 }
});
