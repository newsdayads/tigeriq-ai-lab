import test from 'node:test';
import assert from 'node:assert/strict';
import { rewritePc01DashboardRoutes } from '../api/health-view.mjs';

test('Owner API and OAuth routes stay on authenticated HTTPS origin',()=>{
 const input = [
   "fetch('/api/control?operation=owner-work-request&issue=5252')",
   "fetch('/api/control',{method:'POST'})",
   "link.href='/api/owner-auth?action=login'",
   "fetch('/api/status')",
   "fetch('/api/work-history?number=5252')",
   "fetch('/api/live-status')",
   "fetch('/api/health-live-work')",
   "fetch('/pc01/api/status')",
 ].join('\n');
 const output=rewritePc01DashboardRoutes(input);
 assert.ok(output.includes("fetch('/api/control?operation=owner-work-request&issue=5252')"));
 assert.ok(output.includes("fetch('/api/control',{method:'POST'})"));
 assert.ok(output.includes("link.href='/api/owner-auth?action=login'"));
 for(const route of ['status','work-history','live-status','health-live-work'])
   assert.ok(output.includes('/pc01/api/'+route),route);
 assert.ok(!output.includes('/pc01/api/control'));
 assert.ok(!output.includes('/pc01/api/owner-auth'));
 assert.ok(!output.includes('/pc01/pc01/api/status'));
});

test('Owner OAuth callback retains BOTH session and expired state cookie',async()=>{
 const names=['TIGERIQ_OWNER_EMAIL','TIGERIQ_OWNER_GOOGLE_CLIENT_ID','TIGERIQ_OWNER_GOOGLE_CLIENT_SECRET','TIGERIQ_OWNER_OAUTH_REDIRECT_URI','TIGERIQ_OWNER_SESSION_SECRET'];
 const previous=Object.fromEntries(names.map(k=>[k,process.env[k]]));
 const originalFetch=globalThis.fetch;
 Object.assign(process.env,{
  TIGERIQ_OWNER_EMAIL:'owner-unit@example.test',
  TIGERIQ_OWNER_GOOGLE_CLIENT_ID:'unit-client',
  TIGERIQ_OWNER_GOOGLE_CLIENT_SECRET:'unit-secret',
  TIGERIQ_OWNER_OAUTH_REDIRECT_URI:'https://tigeriq-ai-lab.vercel.app/api/owner-auth?action=callback',
  TIGERIQ_OWNER_SESSION_SECRET:'unit-session-secret-value-should-not-be-used-in-production'
 });
 const makeRes=()=>{
  const headers=new Map();
  return {statusCode:200,headers,getHeader(k){return headers.get(k.toLowerCase());},
   setHeader(k,v){headers.set(k.toLowerCase(),v);},
   end(body=''){this.body=body;}};
 };
 try{
  const {default:handler,isOwnerAuthorized}=await import('../api/owner-auth.mjs?route-cookie-canary=5252');
  const start=makeRes();
  await handler({method:'GET',url:'/api/owner-auth?action=login',headers:{}},start);
  assert.equal(start.statusCode,302);
  const redirect=new URL(start.getHeader('location'));
  const state=redirect.searchParams.get('state');
  assert.ok(state);
  const setState=start.getHeader('set-cookie');
  assert.ok(String(setState).startsWith('tigeriq_owner_oauth_state='));
  const cookiePair=String(setState).split(';',1)[0];
  globalThis.fetch=async(url)=>{
   if(String(url).includes('oauth2.googleapis.com/token'))return {ok:true,json:async()=>({access_token:'synthetic-test-token'})};
   if(String(url).includes('openidconnect.googleapis.com/v1/userinfo'))return {ok:true,json:async()=>({email:'owner-unit@example.test',email_verified:true})};
   throw Error('unexpected_network');
  };
  const finish=makeRes();
  const callbackUrl='/api/owner-auth?action=callback&state='+encodeURIComponent(state)+'&code=synthetic-test-code';
  await handler({method:'GET',url:callbackUrl,headers:{cookie:cookiePair}},finish);
  assert.equal(finish.statusCode,302);
  assert.equal(finish.getHeader('location'),'/?owner=connected');
  const cookies=finish.getHeader('set-cookie');
  assert.ok(Array.isArray(cookies),'Set-Cookie must retain both values');
  assert.equal(cookies.length,2);
  assert.ok(cookies[0].startsWith('tigeriq_owner_session='));
  assert.ok(cookies[1].startsWith('tigeriq_owner_oauth_state='));
  assert.ok(cookies[1].includes('Max-Age=0'));
  const sessionCookie=cookies[0].split(';',1)[0];
  assert.equal(isOwnerAuthorized({headers:{cookie:sessionCookie}}),true);
 } finally {
  globalThis.fetch=originalFetch;
  for(const k of names){if(previous[k]===undefined)delete process.env[k];else process.env[k]=previous[k]}
 }
});
