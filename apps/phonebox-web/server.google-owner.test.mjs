import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {setTimeout as sleep} from 'node:timers/promises';
import {makeGoogleOAuth} from './google-oauth.mjs';

const ORIGIN='https://phonebox.tigeriq.io.vn';
const cfg={
  clientId:'unit-test-client.apps.googleusercontent.com',
  clientSecret:'unit-test-secret-valid-32-bytes',
  redirectUri:ORIGIN+'/__auth/google/callback',
  ownerEmail:'newsdayads@gmail.com',
  sessionKey:'bb'.repeat(32)
};
function fakeRes(){
  return {statusCode:200,headers:{},
    setHeader(key,value){this.headers[key.toLowerCase()]=value},
    getHeader(key){return this.headers[key.toLowerCase()]},
    writeHead(code,headers){this.statusCode=code;for(const [k,v] of Object.entries(headers||{}))this.setHeader(k,v)},
    end(value){this.body=value}};
}
test('Google Identity Services login verifies RS256 JWT, nonce, audience and exact verified owner',async()=>{
  const {publicKey,privateKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
  const jwk={...publicKey.export({format:'jwk'}),kid:'unit-2026',alg:'RS256',use:'sig'};
  let requests=0;
  const auth=makeGoogleOAuth(cfg,{
    fetchImpl:async()=>{requests++;return {ok:true,json:async()=>({keys:[jwk]})}},
    jwksUrl:'https://google.example.invalid/keys'
  });
  const first=fakeRes();
  auth.login({headers:{}},first);
  assert.equal(first.statusCode,200);
  assert.match(first.body,/accounts\.google\.com\/gsi\/client/);
  assert.match(first.body,/newsdayads@gmail\.com/);
  const nonce=first.body.match(/data-nonce="([^"]+)"/)?.[1];
  assert.ok(nonce);
  const ownerCookie=first.headers['set-cookie'].split(';')[0];
  const buildToken=(overrides={})=>{
    const header=Buffer.from(JSON.stringify({alg:'RS256',kid:jwk.kid})).toString('base64url');
    const now=Math.floor(Date.now()/1000);
    const payload=Buffer.from(JSON.stringify({
      iss:'https://accounts.google.com',aud:cfg.clientId,sub:'109876543212345678900',
      email:'newsdayads@gmail.com',email_verified:true,nonce,
      exp:now+3600,iat:now,...overrides
    })).toString('base64url');
    const content=header+'.'+payload;
    const signature=crypto.sign('RSA-SHA256',Buffer.from(content),privateKey).toString('base64url');
    return content+'.'+signature;
  };
  const credentialReq=(credential, origin=ORIGIN)=>({
    method:'POST',
    url:'/__auth/google/credential',
    headers:{cookie:ownerCookie,origin,'content-type':'application/json',
      'sec-fetch-site':'same-origin'},
    async *[Symbol.asyncIterator](){yield Buffer.from(JSON.stringify({credential}))}
  });
  let granted=0;
  const ok=fakeRes();
  await auth.credential(credentialReq(buildToken()),ok,()=>{granted++});
  assert.equal(ok.statusCode,200);
  assert.equal(granted,1);
  assert.equal(requests,1);
  const wrongOwner=fakeRes();
  await auth.credential(credentialReq(buildToken({email:'other@example.test'})),wrongOwner,()=>granted++);
  assert.equal(wrongOwner.statusCode,403);
  assert.equal(granted,1);
  const wrongAud=fakeRes();
  await auth.credential(credentialReq(buildToken({aud:'other-client.apps.googleusercontent.com'})),wrongAud,()=>granted++);
  assert.equal(wrongAud.statusCode,403);
  const wrongNonce=fakeRes();
  await auth.credential(credentialReq(buildToken({nonce:'spoofed'})),wrongNonce,()=>granted++);
  assert.equal(wrongNonce.statusCode,403);
  const wrongOrigin=fakeRes();
  await auth.credential(credentialReq(buildToken(),'https://evil.invalid'),wrongOrigin,()=>granted++);
  assert.equal(wrongOrigin.statusCode,403);
  const tampered=fakeRes();
  const valid=buildToken();
  await auth.credential(credentialReq(valid.slice(0,-3)+'xyz'),tampered,()=>granted++);
  assert.equal(tampered.statusCode,403);
  assert.equal(granted,1);
});
async function port(){const s=net.createServer();await new Promise(ok=>s.listen(0,'127.0.0.1',ok));const p=s.address().port;await new Promise(ok=>s.close(ok));return p;}
test('Full original admin APIs require Google owner session, while public view remains read-only', {timeout:30000},async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'phonebox-google-'));
 const upstreamPort=await port(),adminPort=await port(),viewPort=await port();
 const secrets={salt:'11'.repeat(24),hash:'22'.repeat(32),sessionSecret:'33'.repeat(48)};
 await fs.writeFile(path.join(dir,'auth.json'),JSON.stringify(secrets));
 await fs.writeFile(path.join(dir,'google.json'),JSON.stringify({
   clientId:cfg.clientId,clientSecret:cfg.clientSecret,redirectUri:cfg.redirectUri
 }));
 let executed=0;
 const upstream=http.createServer(async(req,res)=>{
   if(req.url==='/')return res.end('<!doctype html><html><head></head><body><button id="restartBtn">Restart</button></body></html>');
   if(req.url==='/api/settings'){
     if(req.method==='GET'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({pages:[{id:'home'}],lan:{token:'PRIVATE'}}))}
     if(req.method==='PUT'){executed++;res.setHeader('Content-Type','application/json');return res.end('{"saved":true}')}
   }
   if(req.url==='/api/restart'&&req.method==='POST'){executed++;return res.end('executed')}
   if(req.url==='/api/state'){res.setHeader('Content-Type','application/json');return res.end('{"pc":{"cpu":5}}')}
   if(req.url==='/api/config'){res.setHeader('Content-Type','application/json');return res.end('{"version":"2","config":{"pages":[]}}')}
   if(req.url==='/panel/'){res.setHeader('Content-Type','text/html');return res.end('<html><body>phone</body></html>')}
   res.writeHead(404);res.end('unknown');
 });
 await new Promise(resolve=>upstream.listen(upstreamPort,'127.0.0.1',resolve));
 const child=spawn(process.execPath,['apps/phonebox-web/server.mjs'],{env:{
   ...process.env,PB_AGENT_PORT:String(upstreamPort),
   PB_VIEW_PORT:String(viewPort),PB_ADMIN_PORT:String(adminPort),
   PB_GOOGLE_AUTH:'1',PB_GOOGLE_CONFIG_FILE:path.join(dir,'google.json'),
   PB_AUTH_FILE:path.join(dir,'auth.json'),PB_PRIVATE_TAILNET_PORT:'0'
 },stdio:['ignore','pipe','pipe']});
 let errors='';child.stderr.on('data',s=>errors+=s.toString());
 t.after(async()=>{child.kill();await new Promise(ok=>upstream.close(ok));await fs.rm(dir,{recursive:true,force:true})});
 async function req(p,path,init){return fetch('http://127.0.0.1:'+p+path,{redirect:'manual',...init})}
 let ok=false;
 for(let i=0;i<90;i++){try{if((await req(adminPort,'/healthz')).status===200){ok=true;break}}catch{}await sleep(60)}
 assert.equal(ok,true,errors);
 assert.equal((await req(adminPort,'/')).status,303);
 const login=await req(adminPort,'/__auth/google');
 assert.equal(login.status,303);
 assert.equal(new URL(login.headers.get('location')).host,'accounts.google.com');
 assert.equal((await req(adminPort,'/api/restart',{method:'POST',body:'{}'})).status,401);
 const payload=Buffer.from(JSON.stringify({role:'admin',exp:Date.now()+3600000,id:'123456789abcdef0123456789abcdef0'})).toString('base64url');
 const sig=crypto.createHmac('sha256',Buffer.from(secrets.sessionSecret,'hex')).update(payload).digest('base64url');
 const cookie='__Host-pbadmin='+payload+'.'+sig;
 const authHeaders={Cookie:cookie};
 const root=await req(adminPort,'/',{headers:authHeaders});assert.equal(root.status,200);assert.match(await root.text(),/restartBtn/);
 const settings=await req(adminPort,'/api/settings',{headers:authHeaders});assert.equal(settings.status,200);assert.match(await settings.text(),/PRIVATE/);
 const wrongOrigin=await req(adminPort,'/api/restart',{method:'POST',
  headers:{...authHeaders,Origin:'https://attacker.invalid'},body:'{}'});
 assert.equal(wrongOrigin.status,403);assert.equal(executed,0);
 const action=await req(adminPort,'/api/restart',{method:'POST',
  headers:{...authHeaders,Origin:ORIGIN,'Sec-Fetch-Site':'same-origin'},body:'{}'});
 assert.equal(action.status,200);assert.equal(executed,1);
 assert.equal((await req(viewPort,'/api/restart',{method:'POST',body:'{}'})).status,405);
});
test('Google mode configured without credentials fails closed, never exposes PC control', {timeout:20000},async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'phonebox-google-missing-'));
 const admin=await port(),view=await port(),agent=await port();
 await fs.writeFile(path.join(dir,'auth.json'),JSON.stringify({
   salt:'11'.repeat(24),hash:'22'.repeat(32),sessionSecret:'33'.repeat(48)
 }));
 const child=spawn(process.execPath,['apps/phonebox-web/server.mjs'],{
  env:{...process.env,PB_GOOGLE_AUTH:'1',PB_VIEW_PORT:String(view),PB_ADMIN_PORT:String(admin),
    PB_AGENT_PORT:String(agent),PB_AUTH_FILE:path.join(dir,'auth.json'),PB_GOOGLE_CONFIG_FILE:'',
    PB_GOOGLE_CLIENT_ID:'invalid-client'},
  stdio:['ignore','pipe','pipe']
 });
 t.after(async()=>{child.kill();await fs.rm(dir,{recursive:true,force:true})});
 let ready=false;for(let i=0;i<70;i++){try{if((await fetch('http://127.0.0.1:'+admin+'/healthz')).status===200){ready=true;break}}catch{}await sleep(80)}
 assert.equal(ready,true);
 const root=await fetch('http://127.0.0.1:'+admin+'/');assert.equal(root.status,503);
 const restart=await fetch('http://127.0.0.1:'+admin+'/api/restart',{method:'POST'});assert.equal(restart.status,503);
});
