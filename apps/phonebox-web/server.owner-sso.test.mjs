import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import net from 'node:net';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {setTimeout as sleep} from 'node:timers/promises';
async function port(){const s=net.createServer();await new Promise(ok=>s.listen(0,'127.0.0.1',ok));const p=s.address().port;await new Promise(ok=>s.close(ok));return p}
test('PC01 Google-view session can issue single-use full PhoneBox owner grant; anonymous and replay denied', {timeout:30000}, async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'phonebox-owner-sso-'));
 const authfile=path.join(dir,'auth.json');
 const secret='a5'.repeat(48);
 await fs.writeFile(authfile,JSON.stringify({salt:'11'.repeat(24),hash:'22'.repeat(32),sessionSecret:secret}));
 const view=await port(),admin=await port(),upPort=await port();
 let restart=0;
 const upstream=http.createServer((req,res)=>{
   if(req.url==='/')return res.end('<!doctype html><h1>NATIVE_PHONEBOX_SETTINGS</h1>');
   if(req.url==='/api/restart'&&req.method==='POST'){restart++;return res.end('restart');}
   if(req.url==='/api/config'){res.setHeader('content-type','application/json');return res.end('{"version":"123","config":{"pages":[]}}');}
   res.writeHead(404);res.end('');
 });
 await new Promise(ok=>upstream.listen(upPort,'127.0.0.1',ok));
 const p=spawn(process.execPath,['apps/phonebox-web/server.mjs'],{
  env:{...process.env,PB_GOOGLE_AUTH:'1',PB_VIEW_PORT:String(view),
    PB_ADMIN_PORT:String(admin),PB_AGENT_PORT:String(upPort),PB_PRIVATE_TAILNET_PORT:'0',
    PB_AUTH_FILE:authfile},stdio:['ignore','pipe','pipe']
 });
 let errors='';p.stderr.on('data',b=>errors+=String(b));
 t.after(async()=>{p.kill();await new Promise(ok=>upstream.close(ok));await fs.rm(dir,{recursive:true,force:true})});
 const request=(port,route,init={})=>fetch('http://127.0.0.1:'+port+route,{redirect:'manual',...init});
 let ready=false;for(let i=0;i<90;i++){try{if((await request(view,'/healthz')).status===200){ready=true;break}}catch{}await sleep(75)}
 assert.equal(ready,true,errors);
 const anon=await request(view,'/__auth/sso/issue');assert.equal(anon.status,303);
 assert.equal(anon.headers.get('location'),'https://phonebox.tigeriq.io.vn/__auth/google');
 const route=await request(admin,'/');assert.equal(route.status,303);
 assert.equal(route.headers.get('location'),'/__auth/sso');
 const hop=await request(admin,'/__auth/sso');assert.equal(hop.status,303);
 assert.equal(hop.headers.get('location'),'https://pc01.tigeriq.io.vn/__auth/sso/issue');
 const fake=await request(admin,'/__auth/sso/complete?ticket=forged.signature');assert.equal(fake.status,403);
 const payload=Buffer.from(JSON.stringify({role:'google-view',email:'newsdayads@gmail.com',exp:Date.now()+3600000,id:'view-test'})).toString('base64url');
 const sig=crypto.createHmac('sha256',Buffer.from(secret,'hex')).update('phonebox-gis-view-session.'+payload).digest('base64url');
 const viewCookie='__Host-pbgoogle-view='+payload+'.'+sig;
 const approved=await request(view,'/__auth/sso/issue',{headers:{Cookie:viewCookie}});
 assert.equal(approved.status,303);
 const grantUrl=new URL(approved.headers.get('location'));
 assert.equal(grantUrl.host,'phonebox.tigeriq.io.vn');
 assert.equal(grantUrl.pathname,'/__auth/sso/complete');
 const ticket=grantUrl.searchParams.get('ticket');
 assert.ok(ticket&&ticket.length>40);
 const accepted=await request(admin,grantUrl.pathname+grantUrl.search);
 assert.equal(accepted.status,303);
 assert.equal(accepted.headers.get('location'),'/#pages');
 const adminCookie=accepted.headers.get('set-cookie').split(';')[0];
 assert.match(adminCookie,/^__Host-pbgoogle-admin=/);
 const replay=await request(admin,grantUrl.pathname+grantUrl.search);
 assert.equal(replay.status,403);
 const authenticated=await request(admin,'/',{headers:{Cookie:adminCookie}});
 assert.equal(authenticated.status,200);
 assert.match(await authenticated.text(),/NATIVE_PHONEBOX_SETTINGS/);
 const badView=await request(view,'/api/restart',{method:'POST',headers:{Cookie:viewCookie,Origin:'https://pc01.tigeriq.io.vn'},body:'{}'});
 assert.equal(badView.status,405);
 assert.equal(restart,0);
 const wrongMethod=await request(view,'/__auth/sso/issue',{method:'POST',headers:{Cookie:viewCookie}});
 assert.equal(wrongMethod.status,405);
});
