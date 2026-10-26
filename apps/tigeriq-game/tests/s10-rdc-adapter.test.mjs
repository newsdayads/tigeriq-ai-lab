import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {claimAtomicFence,createS10RdcAdapter,nodeCenter,parseUiNodes} from '../scripts/s10-rdc-adapter.mjs';
const sha='a'.repeat(40),serial='R3CM400AKRX',ownerId='NV02_RDC_OWNER';
const scope='TIGERIQ_GAME_G06_S10_E2E_HARNESS';

test('atomic fence accepts one owner and refuses second writer',async()=>{const root=await mkdtemp(join(tmpdir(),'g06-'));const a=await claimAtomicFence({stateRoot:root,ownerId,deviceSerial:serial,sourceSha:sha});const b=await claimAtomicFence({stateRoot:root,ownerId:'NV06_OTHER',deviceSerial:serial,sourceSha:sha});assert.equal(a.accepted,true);assert.equal(b.accepted,false);assert.equal(b.code,'DEVICE_ALREADY_FENCED');assert.equal(b.existing.ownerId,ownerId);assert.equal('fencingToken' in b.existing,false);});
test('foreign expired fence is never silently stolen',async()=>{let t=1000;const root=await mkdtemp(join(tmpdir(),'g06-'));const a=await claimAtomicFence({stateRoot:root,ownerId,deviceSerial:serial,sourceSha:sha,ttlMs:1,now:()=>t});t=5000;const b=await claimAtomicFence({stateRoot:root,ownerId:'NV06_OTHER',deviceSerial:serial,sourceSha:sha,now:()=>t});assert.equal(a.accepted,true);assert.equal(b.accepted,false);});
test('UI parser returns deterministic tap center',()=>{const xml='<hierarchy><node text="CHẠY" clickable="true" bounds="[10,20][110,220]"/></hierarchy>';const n=parseUiNodes(xml)[0];assert.equal(n.text,'CHẠY');assert.deepEqual(nodeCenter(n),{x:60,y:120});});
test('adapter invokes adb executable with shell=false',async()=>{const calls=[];const fake=async(file,args,opts)=>{calls.push({file,args,opts});return {stdout:'',stderr:''}};const a=createS10RdcAdapter({execFile:fake,stateRoot:await mkdtemp(join(tmpdir(),'g06-'))});await a.adb(['devices','-l']);assert.equal(calls[0].file,'D:\\TigerIQ\\Tools\\platform-tools\\adb.exe');assert.equal(calls[0].opts.shell,false);});
test('inspectDevice reads identity and preexisting battery override without mutation',async()=>{const calls=[];const fake=async(file,args)=>{calls.push(args);const s=args.join(' ');if(s==='devices -l')return {stdout:'List of devices attached\nR3CM400AKRX device product:beyondxks model:SM_G977N\n',stderr:''};if(s.includes('getprop'))return {stdout:'SM-G977N\n',stderr:''};if(s.includes('dumpsys'))return {stdout:'UPDATES STOPPED -- use reset to restart\n level: 100\n status: 2\n',stderr:''};throw Error('unexpected')};const a=createS10RdcAdapter({execFile:fake,stateRoot:await mkdtemp(join(tmpdir(),'g06-'))});const r=await a.inspectDevice(serial);assert.equal(r.deviceState,'device');assert.equal(r.deviceModel,'SM-G977N');assert.equal(r.batteryLevel,100);assert.equal(r.batteryOverrideDetected,true);assert.equal(calls.some(x=>x.includes('set')),false);assert.equal(calls.some(x=>x.includes('reset')),false);});
test('verifyFence requires exact owner lease and token',async()=>{const root=await mkdtemp(join(tmpdir(),'g06-'));const c=await claimAtomicFence({stateRoot:root,ownerId,deviceSerial:serial,sourceSha:sha});const a=createS10RdcAdapter({stateRoot:root,execFile:async()=>({stdout:'',stderr:''})});assert.equal((await a.verifyFence({intent:c.intent})).accepted,true);assert.equal((await a.verifyFence({intent:{...c.intent,fencingToken:'FOREIGN_TOKEN_123'}})).accepted,false);});
test('claim file contains active scope and exact source sha',async()=>{const root=await mkdtemp(join(tmpdir(),'g06-'));const c=await claimAtomicFence({stateRoot:root,ownerId,deviceSerial:serial,sourceSha:sha});const raw=JSON.parse(await readFile(c.path,'utf8'));assert.equal(raw.resourceScope,scope);assert.equal(raw.sourceSha,sha);assert.equal(raw.leaseState,'active');});

test('owned fence may set 100% baseline and resets only its own override',async()=>{
  const root=await mkdtemp(join(tmpdir(),'g06-'));
  const preview=join(root,'preview.html');
  await (await import('node:fs/promises')).writeFile(preview,'<!doctype html><title>x</title>');
  let level=86,override=false;const calls=[];
  const fake=async(file,args)=>{
    calls.push(args.join(' '));const s=args.join(' ');
    if(s.includes('dumpsys battery set level 100')){level=100;override=true;return {stdout:'',stderr:''};}
    if(s.includes('dumpsys battery reset')){level=86;override=false;return {stdout:'',stderr:''};}
    if(s.includes('dumpsys battery'))return {stdout:(override?'UPDATES STOPPED -- use reset to restart\n':'')+' level: '+level+'\n status: 4\n',stderr:''};
    if(s.includes('pm path com.android.chrome'))return {stdout:'package:/data/app/chrome/base.apk\n',stderr:''};
    return {stdout:'',stderr:''};
  };
  const claim=await claimAtomicFence({stateRoot:root,ownerId,deviceSerial:serial,sourceSha:sha});
  const adapter=createS10RdcAdapter({stateRoot:root,previewHtmlPath:preview,execFile:fake});
  const session=await adapter.beginOnce({intent:claim.intent,deviceSerial:serial,sourceSha:sha});
  assert.equal(session.accepted,true);assert.equal(level,100);assert.equal(override,true);
  const clean=await adapter.cleanupOwned({intent:claim.intent,sessionId:session.sessionId});
  assert.equal(clean.cleaned,true);assert.equal(clean.batteryReset,true);assert.equal(level,86);assert.equal(override,false);
  assert.equal(calls.filter(x=>x.includes('set level 100')).length,1);
  assert.equal(calls.filter(x=>x.includes('battery reset')).length,1);
  assert.ok(calls.some(x=>x.includes('am start -a android.intent.action.VIEW -p com.android.chrome -d http://127.0.0.1:4173/')));
});

test('startup failure rolls back owned battery override and fence',async()=>{
  const root=await mkdtemp(join(tmpdir(),'g06-'));
  const preview=join(root,'preview.html');
  await (await import('node:fs/promises')).writeFile(preview,'<!doctype html><title>x</title>');
  let level=86,override=false;const calls=[];
  const fake=async(file,args)=>{
    const s=args.join(' ');calls.push(s);
    if(s.includes('dumpsys battery set level 100')){level=100;override=true;return {stdout:'',stderr:''};}
    if(s.includes('dumpsys battery reset')){level=86;override=false;return {stdout:'',stderr:''};}
    if(s.includes('dumpsys battery'))return {stdout:(override?'UPDATES STOPPED -- use reset to restart\n':'')+' level: '+level+'\n status: 4\n',stderr:''};
    if(s.includes('pm path com.android.chrome'))return {stdout:'package:/data/app/chrome/base.apk\n',stderr:''};
    if(s.includes('shell am start'))throw Error('LAUNCH_FAILED');
    return {stdout:'',stderr:''};
  };
  const claim=await claimAtomicFence({stateRoot:root,ownerId,deviceSerial:serial,sourceSha:sha});
  const adapter=createS10RdcAdapter({stateRoot:root,previewHtmlPath:preview,execFile:fake});
  await assert.rejects(()=>adapter.beginOnce({intent:claim.intent,deviceSerial:serial,sourceSha:sha}),/LAUNCH_FAILED/);
  assert.equal(level,86);assert.equal(override,false);
  assert.ok(calls.some(x=>x.includes('reverse --remove tcp:4173')));
  assert.ok(calls.some(x=>x.includes('battery reset')));
  await assert.rejects(()=>readFile(claim.path,'utf8'),e=>e?.code==='ENOENT');
});
