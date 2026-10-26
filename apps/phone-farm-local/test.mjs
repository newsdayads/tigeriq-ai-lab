import test from 'node:test';
import fs from 'node:fs';
import { Script } from 'node:vm';
import os from 'node:os';
import { safeFilename, safePackage, validBatch, fileInDrop } from './farm-ops.mjs';
import { validMacro, executeMacro, MacroRuns } from './macro-engine.mjs';
import { LocalScheduler } from './schedule-engine.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import assert from 'node:assert/strict';
import { parseDevices, safeSerial, validInput, privateWifiAddress, server } from './app.mjs';

test('ADB inventory parses connected, offline, unauthorized devices', () => {
  const devices=parseDevices('List of devices attached\nR3CM400AKRX device product:beyondxks model:SM_G977N transport_id:1\n192.168.0.9:5555 offline\nABCD unauthorized\n');
  assert.equal(devices.length,3);
  assert.deepEqual(devices[0],{serial:'R3CM400AKRX',state:'device',model:'SM_G977N',product:'beyondxks'});
  assert.equal(devices[1].state,'offline');
  assert.equal(devices[2].state,'unauthorized');
});
test('serial cannot inject shell flags, path or operators', () => {
  for(const s of ['R3CM400AKRX','192.168.1.8:5555','emulator-5554']) assert.equal(safeSerial(s),true);
  for(const s of ['--help','../../a','x;del','a b','']) assert.equal(safeSerial(s),false);
});
test('bounded group inputs and supported actions', () => {
  assert.equal(validInput({serials:['ABC'],action:'tap',x:12,y:99}),true);
  assert.equal(validInput({serials:['ABC','DEF'],action:'key',key:'HOME'}),true);
  assert.equal(validInput({serials:['ABC'],action:'swipe',x:10,y:10,toX:20,toY:40,ms:300}),true);
  assert.equal(validInput({serials:['ABC'],action:'text',text:'hello world'}),true);
  assert.equal(validInput({serials:['ABC'],action:'text',text:'a\u0000b'}),false);
  assert.equal(validInput({serials:['ABC'],action:'shell',cmd:'rm -rf /'}),false);
  assert.equal(validInput({serials:['ABC','ABC'],action:'key',key:'HOME'}),false);
  assert.equal(validInput({serials:['ABC'],action:'tap',x:-1,y:3}),false);
  assert.equal(validInput({serials:['ABC'],action:'swipe',x:1,y:3,toX:4,toY:4,ms:1}),false);
  assert.equal(validInput({serials:['ABC'],action:'key',key:'FACTORY_RESET'}),false);
});
test('server module imports without listening or side effects', () => {
  assert.equal(server.listening,false);
});

test('browser controller parses under strict CSP external-script policy', () => {
  const dir=path.dirname(fileURLToPath(import.meta.url));
  const html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
  assert.match(html,/<script src="\/ui\.js" type="module"><\/script>/);
  assert.doesNotMatch(html,/<script type="module">/);
  assert.doesNotThrow(()=>new Script(fs.readFileSync(path.join(dir,'ui.js'),'utf8')));
});

test('Windows host monitors and recovers a dead local backend', () => {
  const dir=path.dirname(fileURLToPath(import.meta.url));
  const source=fs.readFileSync(path.join(dir,'windows','Program.cs'),'utf8');
  assert.match(source,/healthTimer\.Tick \+= async \(_, _\) => await RecoverBackendAsync\(\)/);
  assert.match(source,/if \(await HealthyAsync\(client\)\) return;/);
  assert.match(source,/ShutdownOwnedHost\(\);\s*StartBackend\(\);/);
  assert.match(source,/if \(viewer\.CoreWebView2 is not null\) viewer\.CoreWebView2\.Reload\(\)/);
  assert.match(source,/healthTimer\.Stop\(\);\s*ShutdownOwnedHost\(\);/);
});

test('batch controls validate package, files, duplicate serial and actions', () => {
  assert.equal(safePackage('com.example.demo'), true);
  assert.equal(safePackage('com.example;cmd'), false);
  assert.equal(safePackage('settings'), false);
  assert.equal(safeFilename('my-app.apk'), true);
  assert.equal(safeFilename('sample.csv'), true);
  for (const s of ['../sample.apk', 'CON.txt', 'one..two.apk', '.hidden.apk', 'a.exe']) assert.equal(safeFilename(s), false);
  assert.equal(validBatch({action:'install',serials:['A1','B2'],file:'my-app.apk'}),true);
  assert.equal(validBatch({action:'install',serials:['A1'],file:'sample.csv'}),false);
  assert.equal(validBatch({action:'upload',serials:['A1'],file:'sample.csv'}),true);
  assert.equal(validBatch({action:'launch',serials:['A1'],package:'com.example.demo'}),true);
  assert.equal(validBatch({action:'shell',serials:['A1'],cmd:'unsafe'}),false);
  assert.equal(validBatch({action:'forceStop',serials:['A1','A1'],package:'com.example.demo'}),false);
});

test('batch file lookup is confined to approved drop directory', () => {
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'tigeriq-batch-'));
  try {
    const file=path.join(folder,'sample.txt');
    fs.writeFileSync(file,'safe');
    assert.equal(fileInDrop(folder,'sample.txt'),file);
    assert.throws(()=>fileInDrop(folder,'../secrets.csv'));
    assert.throws(()=>fileInDrop(folder,'not-present.apk'));
  } finally { fs.rmSync(folder,{recursive:true,force:true}) }
});

test('macros reject arbitrary shell, unbounded waits and destructive keys', () => {
  assert.equal(validMacro([{action:'key',key:'HOME'},{action:'wait',ms:200},{action:'tap',x:15,y:40}]),true);
  assert.equal(validMacro([{action:'shell',command:'rm -rf /'}]),false);
  assert.equal(validMacro([{action:'key',key:'FACTORY_RESET'}]),false);
  assert.equal(validMacro([{action:'wait',ms:60000}]),false);
  assert.equal(validMacro([{action:'text',text:'A\u0000'}]),false);
  assert.equal(validMacro(Array.from({length:51},()=>({action:'key',key:'HOME'}))),false);
});

test('macros execute bounded group steps and report progress', async () => {
  const actions=[], progresses=[];
  const steps=[{action:'key',key:'HOME'},{action:'wait',ms:50},{action:'key',key:'BACK'}];
  const result=await executeMacro(steps,['PHONE_A','PHONE_B'],async (s,b)=>actions.push(s+':'+b.key),undefined,n=>progresses.push(n));
  assert.deepEqual(actions,['PHONE_A:HOME','PHONE_B:HOME','PHONE_A:BACK','PHONE_B:BACK']);
  assert.deepEqual(progresses,[1,2,3]);
  assert.deepEqual(result,{completed:3,total:3});
});

test('macro run ids, device locking and stop guard', async () => {
  const runs=new MacroRuns();
  const id=runs.start([{action:'wait',ms:1000}],['PHONE_A'],async()=>{});
  assert.ok(runs.status(id));
  assert.throws(()=>runs.start([{action:'key',key:'HOME'}],['PHONE_A'],async()=>{}));
  assert.equal(runs.stop(id),true);
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(runs.status(id).state,'cancelled');
});

test('local scheduler survives restart and executes a bounded due macro once', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tigeriq-schedule-'));
  const filename=path.join(dir,'schedules.json');
  let now=Date.parse('2026-10-24T00:00:00.000Z');
  const invoked=[];
  try {
    const scheduler=new LocalScheduler(filename,async(steps,serials)=>{
      invoked.push({steps,serials});return 'local-run-id';
    },()=>now);
    const saved=scheduler.add({name:'Safe Home',serials:['PHONE_A'],
      steps:[{action:'key',key:'HOME'}],runAt:new Date(now+120000).toISOString(),repeatMinutes:1});
    assert.ok(saved.id);
    assert.equal(scheduler.list().length,1);
    await scheduler.tick();assert.equal(invoked.length,0);
    now+=120001;
    await scheduler.tick();
    assert.equal(invoked.length,1);
    assert.equal(scheduler.list()[0].lastRunId,'local-run-id');
    assert.ok(scheduler.list()[0].nextAt>now);
    const restarted=new LocalScheduler(filename,async()=>{},()=>now);
    assert.equal(restarted.list().length,1);
    assert.equal(restarted.list()[0].lastRunId,'local-run-id');
    assert.equal(restarted.remove(saved.id),true);
    assert.equal(restarted.list().length,0);
  } finally {fs.rmSync(dir,{recursive:true,force:true})}
});

test('local scheduler skips stale jobs instead of replaying uncontrolled backlog', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tigeriq-schedule-missed-'));
  let now=Date.parse('2026-10-24T00:00:00.000Z'),invocations=0;
  try{
    const scheduler=new LocalScheduler(path.join(dir,'schedules.json'),async()=>{invocations++;},()=>now);
    scheduler.add({name:'One time',serials:['PHONE_A'],steps:[{action:'key',key:'HOME'}],
      runAt:new Date(now+5000).toISOString(),repeatMinutes:0});
    now+=7200000;
    await scheduler.tick();
    assert.equal(invocations,0);
    assert.equal(scheduler.list()[0].enabled,false);
    assert.match(scheduler.list()[0].lastError,/Missed window/);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test('wireless ADB address limited to valid private LAN IP and nonprivileged port', () => {
  for(const value of ['192.168.100.24:5555','10.2.3.5:45555','172.16.0.9:5555','172.31.255.2:5555'])
    assert.equal(privateWifiAddress(value),true);
  for(const value of ['8.8.8.8:5555','127.0.0.1:5555','192.169.1.2:5555','172.32.0.1:5555','192.168.1.999:5555','192.168.1.2:0','10.1.2.3:80','10.1.2.3:5555 & whoami','localhost:5555'])
    assert.equal(privateWifiAddress(value),false);
});
