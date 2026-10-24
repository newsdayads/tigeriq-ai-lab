import test from 'node:test';
import assert from 'node:assert/strict';

test('Google-only Owner auth reports real methods without recursion or internal fallback',async()=>{
 const names=['TIGERIQ_OWNER_INTERNAL_KEY_SHA256','TIGERIQ_OWNER_SESSION_SECRET','TIGERIQ_OWNER_GOOGLE_CLIENT_ID','TIGERIQ_OWNER_GOOGLE_CLIENT_SECRET','TIGERIQ_OWNER_OAUTH_REDIRECT_URI'];
 const saved=Object.fromEntries(names.map(k=>[k,process.env[k]]));
 process.env.TIGERIQ_OWNER_INTERNAL_KEY_SHA256='';
 process.env.TIGERIQ_OWNER_SESSION_SECRET='synthetic_google_only_session_secret_0123456789';
 process.env.TIGERIQ_OWNER_GOOGLE_CLIENT_ID='synthetic-client.apps.googleusercontent.com';
 process.env.TIGERIQ_OWNER_GOOGLE_CLIENT_SECRET='synthetic-client-secret';
 process.env.TIGERIQ_OWNER_OAUTH_REDIRECT_URI='https://tigeriq-ai-lab.vercel.app/api/owner-auth?action=callback';
 const headers=new Map();
 const createResponse=()=>({
   statusCode:200,body:'',
   getHeader(name){return headers.get(String(name).toLowerCase())},
   setHeader(name,value){headers.set(String(name).toLowerCase(),value)},
   end(body=''){this.body=String(body||'')}
 });
 try{
  const {default:handler}=await import('../api/owner-auth.mjs?googleOnlyConfig=5252');
  const req={method:'GET',url:'/api/owner-auth?action=status',headers:{host:'tigeriq-ai-lab.vercel.app'}};
  const status=createResponse();
  await handler(req,status);
  assert.equal(status.statusCode,200,'status cannot recurse');
  const body=JSON.parse(status.body);
  assert.equal(body.configured,true);
  assert.deepEqual(body.methods,{internal:false,google:true});
  const login=createResponse();
  await handler({...req,url:'/api/owner-auth?action=login'},login);
  assert.equal(login.statusCode,302);
  const destination=new URL(login.getHeader('location'));
  assert.equal(destination.hostname,'accounts.google.com');
  assert.equal(destination.searchParams.get('redirect_uri'),process.env.TIGERIQ_OWNER_OAUTH_REDIRECT_URI);
  assert.ok(destination.searchParams.get('state'));
  assert.match(String(login.getHeader('set-cookie')),/^tigeriq_owner_oauth_state=/);
 }finally{
  for(const name of names){if(saved[name]===undefined)delete process.env[name];else process.env[name]=saved[name]}
 }
});
