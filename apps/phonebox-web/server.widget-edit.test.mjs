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
  const s = net.createServer();
  await new Promise((ok, bad) => s.once('error',bad).listen(0,'127.0.0.1',ok));
  const port = s.address().port;
  await new Promise(ok => s.close(ok));
  return port;
}
test('public no-login widget edits save only UI layout; never overwrite PC01 secrets, rules, shortcuts or private pages', { timeout: 30000 }, async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'phonebox-widget-edit-'));
  const auth = path.join(dir,'auth.json');
  await fs.writeFile(auth,JSON.stringify({
    salt:crypto.randomBytes(24).toString('hex'),
    hash:crypto.randomBytes(32).toString('hex'),
    sessionSecret:crypto.randomBytes(48).toString('hex')
  }));
  let version = 1001;
  let saves = 0;
  let privateSettingsReads = 0;
  let config = {
    lan:{enabled:true,port:8766,token:'PRIVATE_LAN_TOKEN'},
    shortcuts:[{kind:'run',command:'PRIVATE_COMMAND'}],
    rules:[{id:'private-rule',enabled:true}],
    pages:[
      {id:'home',title:'Private-name',enabled:true,widgets:[
        {id:'real-clock',type:'clock',x:0,y:0,w:6,h:2,options:{showDate:true}},
        {id:'real-stat',type:'stat',x:6,y:0,w:3,h:2,options:{metric:'cpu',privateToken:'NOT_PUBLIC'}},
        {id:'real-shortcut',type:'shortcuts',x:0,y:2,w:3,h:2,options:{target:'private-control'}}
      ]},
      {id:'secret',title:'PRIVATE_PROJECT',enabled:true,widgets:[{id:'secret-note',type:'note',x:0,y:0,w:6,h:3,options:{text:'SECRET_CONTENT'}}]}
    ]
  };
  const upstreamPort = await freePort(), view = await freePort(), admin = await freePort();
  const upstream = http.createServer(async (req,res) => {
    if(req.url === '/api/config' && req.method==='GET') {
      res.setHeader('Content-Type','application/json');
      const publicConfig = structuredClone(config);
      // Mimic PhoneBox AgentConfig.ToPublic(): deliberately omits PC secrets and command details.
      delete publicConfig.lan.token;
      publicConfig.shortcuts = publicConfig.shortcuts.map(s => ({ kind: s.kind }));
      return res.end(JSON.stringify({version:String(version),config:publicConfig}));
    }
    if(req.url === '/api/settings' && req.method==='GET') {
      if(req.headers['sec-fetch-site'] !== 'same-origin' ||
         req.headers['sec-fetch-mode'] !== 'cors' ||
         req.headers['sec-fetch-dest'] !== 'empty') {
        res.writeHead(403);return res.end('Forbidden');
      }
      privateSettingsReads++;
      res.setHeader('Content-Type','application/json');
      res.setHeader('X-Config-Version',String(version));
      return res.end(JSON.stringify(config));
    }
    if(req.url === '/api/settings' && req.method==='PUT') {
      const parts=[];for await(const c of req)parts.push(c);
      if(req.headers['x-config-version'] !== String(version)) {res.writeHead(409);return res.end('{}');}
      const proposed=JSON.parse(Buffer.concat(parts).toString('utf8'));
      if(proposed.lan?.token !== config.lan.token || proposed.shortcuts?.[0]?.command !== config.shortcuts?.[0]?.command) {
        res.writeHead(400);return res.end('{"error":"PRIVATE_FIELDS_LOST"}');
      }
      config=proposed;
      saves++;
      version++;
      res.setHeader('Content-Type','application/json');
      return res.end(JSON.stringify({version:String(version)}));
    }
    if(req.url === '/api/state') {
      res.setHeader('Content-Type','application/json');
      return res.end(JSON.stringify({pc:{cpu:20,gpu:{util:10},ramUsedGb:15,ramTotalGb:32}}));
    }
    if(req.url === '/') {
      res.setHeader('Content-Type','text/html');
      return res.end('<!doctype html><html><head><title>PhoneBox Settings</title></head><body><button id="save">Lưu</button><div id="pageTabs"></div></body></html>');
    }
    res.writeHead(404);res.end('not found');
  });
  await new Promise(ok=>upstream.listen(upstreamPort,'127.0.0.1',ok));
  const child=spawn(process.execPath,['apps/phonebox-web/server.mjs'],{
    env:{...process.env, PB_PUBLIC_READONLY:'1',PB_PUBLIC_WIDGET_EDIT:'1',
      PB_VIEW_PORT:String(view),PB_ADMIN_PORT:String(admin),
      PB_AGENT_PORT:String(upstreamPort),PB_AUTH_FILE:auth},
    stdio:['ignore','pipe','pipe']
  });
  let error='';
  child.stderr.on('data',b=>{error+=String(b).slice(0,600)});
  t.after(async()=>{child.kill();await new Promise(ok=>upstream.close(ok));await fs.rm(dir,{recursive:true,force:true})});
  const request=(p,u,init={})=>fetch('http://127.0.0.1:'+p+u,{redirect:'manual',...init});
  let ready=false;
  for(let i=0;i<70;i++){
    try {if((await request(admin,'/healthz')).status===200){ready=true;break}} catch {}
    await delay(100);
  }
  assert.equal(ready,true,error);
  const home=await request(admin,'/');
  const html=await home.text();
  assert.equal(home.status,200);
  assert.match(html,/id="save"/);
  assert.match(html,/Sửa và lưu bố cục widget trực tiếp/);
  assert.doesNotMatch(html,/#save,#revert/);
  const getSettings=()=>request(admin,'/api/settings');
  const editRes=await getSettings();
  assert.equal(editRes.status,200);
  assert.equal(editRes.headers.get('x-config-version'),'1001');
  const editor=await editRes.json();
  assert.equal(editor.pages.length,1);
  assert.deepEqual(editor.pages[0].widgets.map(w=>w.id),[
    'readonly-home-0','readonly-home-1','readonly-home-2'
  ]);
  assert.equal(editor.lan.token,'');
  editor.pages[0].widgets[0].x=1;
  editor.pages[0].widgets[1].x=7;
  editor.pages[0].widgets[1].options={metric:'ram',privateToken:'MALICIOUS_NOT_ACCEPTED'};
  editor.pages[0].widgets.push({id:'',type:'clock',x:9,y:3,w:3,h:3,options:{showDate:true}});
  editor.lan.token='ATTACKER_IGNORED';
  editor.shortcuts=[{kind:'run',command:'MALICIOUS_COMMAND'}];
  editor.rules=[];
  const body=JSON.stringify(editor);
  const headers={'Content-Type':'application/json','X-Config-Version':'1001',
    Origin:'https://phonebox.tigeriq.io.vn','Sec-Fetch-Site':'same-origin'};
  const wrongOrigin=await request(admin,'/api/settings',{
    method:'PUT',headers:{...headers,Origin:'https://evil.invalid'},body
  });
  assert.equal(wrongOrigin.status,403);
  assert.equal(saves,0);
  const wrongVersion=await request(admin,'/api/settings',{
    method:'PUT',headers:{...headers,'X-Config-Version':'999'},body
  });
  assert.equal(wrongVersion.status,409);
  assert.equal(saves,0);
  const save=await request(admin,'/api/settings',{method:'PUT',headers,body});
  assert.equal(save.status,200,await save.text());
  assert.equal(saves,1);
  assert.equal(privateSettingsReads >= 1,true,'the gateway must read private local settings before writing');
  assert.equal(config.lan.token,'PRIVATE_LAN_TOKEN');
  assert.deepEqual(config.shortcuts,[{kind:'run',command:'PRIVATE_COMMAND'}]);
  assert.deepEqual(config.rules,[{id:'private-rule',enabled:true}]);
  assert.equal(config.pages.length,2);
  assert.equal(config.pages[1].title,'PRIVATE_PROJECT');
  assert.equal(config.pages[1].widgets[0].options.text,'SECRET_CONTENT');
  assert.equal(config.pages[0].widgets[0].id,'real-clock');
  assert.equal(config.pages[0].widgets[0].x,1);
  assert.equal(config.pages[0].widgets[1].options.metric,'ram');
  assert.equal(config.pages[0].widgets[1].options.privateToken,'NOT_PUBLIC');
  assert.equal(config.pages[0].widgets[2].options.target,'private-control');
  assert.equal(config.pages[0].widgets.at(-1).type,'clock');
  assert.equal(config.pages[0].widgets.at(-1).options.showDate,true);
  const after=await getSettings();
  assert.equal(after.headers.get('x-config-version'),'1002');
  assert.equal((await after.json()).pages[0].widgets.length,4);
  assert.equal((await request(view,'/api/settings',{method:'PUT',headers,body})).status,405);
  assert.equal((await request(admin,'/api/restart',{method:'POST',body:'{}'})).status,405);
  assert.equal((await request(admin,'/api/settings/shortcut-icon',{method:'DELETE'})).status,405);
});
