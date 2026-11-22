import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
  const port = server.address().port;
  await new Promise(resolve=>server.close(resolve));
  return port;
}
test('full local PhoneBox UI and all API methods work via private tailnet only; public routes remain restricted', {timeout:30000}, async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'phonebox-tailnet-'));
  const auth=path.join(dir,'auth.json');
  await fs.writeFile(auth,JSON.stringify({
    salt:crypto.randomBytes(24).toString('hex'),
    hash:crypto.randomBytes(32).toString('hex'),
    sessionSecret:crypto.randomBytes(48).toString('hex')
  }));
  const upstreamPort=await freePort(), view=await freePort(), admin=await freePort(), privatePort=await freePort();
  const tailnetOrigin='https://pc01.tail35d2f3.ts.net:8767';
  let writes=0;
  let restartCommands=0;
  const source=http.createServer(async(req,res)=>{
    if(req.headers.host !== '127.0.0.1:'+upstreamPort){
      res.writeHead(403);return res.end('WRONG_UPSTREAM_HOST');
    }
    if(req.headers.origin && req.headers.origin!=='http://127.0.0.1:'+upstreamPort){
      res.writeHead(403);return res.end('WRONG_UPSTREAM_ORIGIN');
    }
    if(req.url==='/api/settings' && req.method==='GET'){
      res.setHeader('Content-Type','application/json');
      res.setHeader('X-Config-Version','1234');
      return res.end(JSON.stringify({pages:[{id:'home',widgets:[{type:'clock'}]}],
        lan:{token:'SECRET_PRIVATE_WIFI_KEY'},shortcuts:[{cmd:'PRIVATE_RUN_COMMAND'}]}));
    }
    if(req.url==='/api/settings' && req.method==='PUT'){
      const chunks=[];for await (const chunk of req) chunks.push(chunk);
      const config=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      assert.equal(config.lan.token,'SECRET_PRIVATE_WIFI_KEY');
      writes++;
      res.setHeader('Content-Type','application/json');
      return res.end(JSON.stringify({version:'1235'}));
    }
    if(req.url==='/api/restart' && req.method==='POST'){
      restartCommands++;
      res.writeHead(200);return res.end('LOCAL_COMMAND_SIMULATED');
    }
    if(req.url==='/'){
      res.setHeader('Content-Type','text/html');
      return res.end('<html><body><h1>ORIGINAL_PHONEBOX_SETTINGS</h1></body></html>');
    }
    if(req.url==='/panel/') {
      res.setHeader('Content-Type','text/html');
      return res.end('<html><body>ORIGINAL_PHONEBOX_PANEL</body></html>');
    }
    if(req.url==='/api/config'){
      res.setHeader('Content-Type','application/json');
      return res.end(JSON.stringify({version:'1234',config:{pages:[]}}));
    }
    if(req.url==='/api/state'){
      res.setHeader('Content-Type','application/json');
      return res.end(JSON.stringify({pc:{cpu:9,ramUsedGb:12,ramTotalGb:32}}));
    }
    res.writeHead(404);res.end('NOT_FOUND');
  });
  await new Promise(resolve=>source.listen(upstreamPort,'127.0.0.1',resolve));
  const child=spawn(process.execPath,['apps/phonebox-web/server.mjs'],{
    env:{...process.env,PB_VIEW_PORT:String(view),PB_ADMIN_PORT:String(admin),
      PB_AGENT_PORT:String(upstreamPort),PB_PRIVATE_TAILNET_PORT:String(privatePort),
      PB_TAILNET_HOST:'pc01.tail35d2f3.ts.net',PB_TAILNET_HTTPS_PORT:'8767',
      PB_PUBLIC_READONLY:'1',PB_AUTH_FILE:auth},
    stdio:['ignore','pipe','pipe']
  });
  let err='';
  child.stderr.on('data',data=>{err+=String(data).slice(0,2000)});
  t.after(async()=>{child.kill();await new Promise(resolve=>source.close(resolve));await fs.rm(dir,{recursive:true,force:true})});
  const request=(port,pathname,init={})=>fetch('http://127.0.0.1:'+port+pathname,{redirect:'manual',...init});
  const privateHeaders={Host:'pc01.tail35d2f3.ts.net:8767','Sec-Fetch-Site':'same-origin'};
  let online=false;
  for(let i=0;i<90;i++){
    try {if((await request(privatePort,'/healthz',{headers:privateHeaders})).status===200){online=true;break}} catch {}
    await delay(80);
  }
  assert.equal(online,true,'private listener failed: '+err);
  const root=await request(privatePort,'/',{headers:privateHeaders});
  assert.equal(root.status,200);
  assert.match(await root.text(),/ORIGINAL_PHONEBOX_SETTINGS/);
  const full=await request(privatePort,'/api/settings',{headers:{...privateHeaders,'Sec-Fetch-Mode':'cors','Sec-Fetch-Dest':'empty'}});
  assert.equal(full.status,200);
  assert.equal(full.headers.get('X-Config-Version'),'1234');
  const original=await full.json();
  assert.equal(original.lan.token,'SECRET_PRIVATE_WIFI_KEY');
  assert.equal(original.shortcuts[0].cmd,'PRIVATE_RUN_COMMAND');
  const blockedWrongHost=await request(privatePort,'/',{headers:{Host:'phonebox.tigeriq.io.vn'}});
  assert.equal(blockedWrongHost.status,403);
  const blockedCrossSite=await request(privatePort,'/api/settings',{headers:{...privateHeaders,'Sec-Fetch-Site':'cross-site'}});
  assert.equal(blockedCrossSite.status,403);
  const blockedBadOrigin=await request(privatePort,'/api/settings',{
    method:'PUT',body:JSON.stringify(original),headers:{
      ...privateHeaders,Origin:'https://untrusted.example','Content-Type':'application/json'
    }
  });
  assert.equal(blockedBadOrigin.status,403);
  const save=await request(privatePort,'/api/settings',{
    method:'PUT',body:JSON.stringify(original),headers:{
      ...privateHeaders,Origin:tailnetOrigin,'Content-Type':'application/json','X-Config-Version':'1234'
    }
  });
  assert.equal(save.status,200);
  assert.equal(writes,1);
  const restart=await request(privatePort,'/api/restart',{
    method:'POST',body:'{}',headers:{
      ...privateHeaders,Origin:tailnetOrigin,'Content-Type':'application/json'
    }
  });
  assert.equal(restart.status,200);
  assert.equal(restartCommands,1);
  const publicRestart=await request(admin,'/api/restart',{
    method:'POST',headers:{Origin:'https://phonebox.tigeriq.io.vn'},body:'{}'
  });
  assert.equal(publicRestart.status,405);
  const publicSettings=await request(admin,'/api/settings');
  assert.equal(publicSettings.status,200);
  assert.doesNotMatch(await publicSettings.text(),/SECRET_PRIVATE_WIFI_KEY|PRIVATE_RUN_COMMAND/);
  const publicPanelWrite=await request(view,'/api/restart',{
    method:'POST',headers:{Origin:'https://pc01.tigeriq.io.vn'},body:'{}'
  });
  assert.equal(publicPanelWrite.status,405);
  assert.equal(restartCommands,1);
});
