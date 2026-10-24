import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {evaluateG06Preflight,parseAdbDevices,parseBattery} from '../scripts/s10-preflight.mjs';
import {runG06E2E} from '../scripts/s10-e2e.mjs';
const sha='1'.repeat(40);
const evidence={mcpBindingVerified:true,attestedReadOnlySource:true,
  adbExecutableVerified:true,devices:[{serial:'R58M123456A',state:'device'}],
  deviceSerial:'R58M123456A',deviceModel:'SM-G977N',batteryLevel:100,
  batteryOverrideDetected:false,previewUrl:'http://127.0.0.1:4173/',
  previewReachable:true,previewSsoRequired:false,buildSha:sha};
const intent={workOrder:'GH-5284',resourceScope:'TIGERIQ_GAME_G06_S10_E2E_HARNESS'};
const fence=()=>({accepted:true,scope:intent.resourceScope,deviceSerial:evidence.deviceSerial,expiresAtMs:Date.now()+60000});

test('parse only native adb devices; never treat unauthorized/offline as usable',()=>{
  const devices=parseAdbDevices('List of devices attached\nR58M123456A device\nXYZ unauthorized\nXYY offline\n');
  assert.deepEqual(devices,[{serial:'R58M123456A',state:'device'},
    {serial:'XYZ',state:'unauthorized'},{serial:'XYY',state:'offline'}]);
  assert.deepEqual(parseBattery('level: 100\nstatus: 2'),{level:100,status:2});
  assert.equal(parseBattery('level: 120'),null);
});
test('refuse device listing without genuine ADB header',()=>{
  assert.deepEqual(parseAdbDevices('R58M123456A device\n'),[]);
  assert.deepEqual(parseAdbDevices('unrelated log\nR58M123456A device\n'),[]);
});
test('missing battery override state and missing SSO decision fail closed',()=>{
  const unknownBattery={...evidence};
  delete unknownBattery.batteryOverrideDetected;
  assert.equal(evaluateG06Preflight(unknownBattery).code,'WAIT_BATTERY_OVERRIDE_OWNER');
  const unknownSSO={...evidence};
  delete unknownSSO.previewSsoRequired;
  assert.equal(evaluateG06Preflight(unknownSSO).code,'WAIT_PREVIEW_ACCESS');
  assert.equal(evaluateG06Preflight({...evidence,batteryOverrideDetected:false,
    previewSsoRequired:false}).code,'READY_FOR_DEVICE_OWNER_CLAIM');
});
test('no live binding, no fake PASS and no device call in dry-run',()=>{
  assert.equal(evaluateG06Preflight().code,'WAIT_RUNTIME_MCP_BINDING');
  const r=spawnSync(process.execPath,['scripts/s10-preflight.mjs','--dry-run'],
    {cwd:new URL('..',import.meta.url),encoding:'utf8'});
  assert.equal(r.status,0);
  assert.equal(JSON.parse(r.stdout).deviceMutation,false);
  assert.equal(JSON.parse(r.stdout).ready,false);
});
test('untrusted --input JSON cannot forge a native runtime READY receipt',async()=>{
  const {mkdtemp,writeFile,rm}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');
  const {join}=await import('node:path');
  const dir=await mkdtemp(join(tmpdir(),'gh5284-'));
  try{
    const input=join(dir,'fake-native-proof.json');
    await writeFile(input,JSON.stringify(evidence));
    const r=spawnSync(process.execPath,['scripts/s10-preflight.mjs','--input',input],
      {cwd:new URL('..',import.meta.url),encoding:'utf8'});
    assert.equal(r.status,0);
    const parsed=JSON.parse(r.stdout);
    assert.equal(parsed.code,'WAIT_RUNTIME_MCP_BINDING');
    assert.equal(parsed.ready,false);
    assert.equal(parsed.deviceMutation,false);
    assert.equal(parsed.reason,'INPUT_JSON_CANNOT_ATTEST_NATIVE_RUNTIME');
  } finally {await rm(dir,{recursive:true,force:true});}
});
test('invalid serial/model and unavailable ADB fail closed',()=>{
  assert.equal(evaluateG06Preflight({...evidence,deviceModel:'SM-G991B'}).code,'WAIT_ADB_UNAVAILABLE');
  assert.equal(evaluateG06Preflight({...evidence,adbExecutableVerified:false}).code,'WAIT_ADB_UNAVAILABLE');
  assert.equal(evaluateG06Preflight({...evidence,deviceSerial:'FOREIGN'}).code,'WAIT_ADB_UNAVAILABLE');
});
test('owner of existing battery override is required',()=>{
  assert.equal(evaluateG06Preflight({...evidence,batteryOverrideDetected:true}).code,'WAIT_BATTERY_OVERRIDE_OWNER');
  assert.equal(evaluateG06Preflight({...evidence,batteryOverrideDetected:true,
    batteryOverrideOwnerVerified:true}).code,'READY_FOR_DEVICE_OWNER_CLAIM');
});
test('reject SSO, external HTTP and preview lacking pinned SHA',()=>{
  for(const e of [{previewSsoRequired:true},{previewReachable:false},
    {previewUrl:'http://evil.example/'},{previewUrl:'https://u:p@valid.test/'},
    {previewUrl:'http://127.0.0.1:4173/?token=abc'},{buildSha:'unverified'}])
    assert.equal(evaluateG06Preflight({...evidence,...e}).code,'WAIT_PREVIEW_ACCESS');
});
test('ready state explicitly requires separate live device lease',()=>{
  const r=evaluateG06Preflight(evidence);
  assert.equal(r.code,'READY_FOR_DEVICE_OWNER_CLAIM');
  assert.equal(r.coreNativeLease,'NOT_VERIFIED');
  assert.equal(r.productG06Done,false);
  assert.equal(r.deviceMutation,false);
});
test('no adapter, no intent, or failed fencing forbids device mutation',async()=>{
  assert.equal((await runG06E2E({evidence})).code,'WAIT_RUNTIME_MCP_BINDING');
  let called=0;
  const adapter={verifyFence:async()=>({accepted:false}),beginOnce:async()=>{called++},runLevel:async()=>{called++},cleanupOwned:async()=>{called++}};
  assert.equal((await runG06E2E({evidence,ownerIntent:intent,adapter})).code,'WAIT_DEVICE_EXCLUSIVE_FENCING');
  assert.equal(called,0);
});
test('verified adapter executes exact five levels, then own-scope cleanup',async()=>{
  const calls=[];
  const adapter={verifyFence:async()=>fence(),
    beginOnce:async()=>({accepted:true,fresh:true,sessionId:'S10SESSION_12345'}),
    runLevel:async({level})=>{calls.push(level);return {level,pass:true,evidenceRef:'https://evidence.example/'+level}},
    cleanupOwned:async()=>{calls.push('cleanup');return {cleaned:true,sessionId:'S10SESSION_12345'}}};
  const r=await runG06E2E({evidence,ownerIntent:intent,adapter});
  assert.equal(r.code,'PASS_WITH_EVIDENCE');
  assert.equal(r.productG06Done,false);
  assert.deepEqual(calls,['L01','L02','L03','L04','L05','cleanup']);
});
test('revoked token stops at next level; only owner scope may cleanup',async()=>{
  let n=0,steps=0,cleanups=0;
  const adapter={verifyFence:async()=>{n++;return n<3?fence():{accepted:false}},
    beginOnce:async()=>({accepted:true,fresh:true,sessionId:'S10SESSION_12345'}),
    runLevel:async({level})=>{steps++;return {level,pass:true,evidenceRef:'https://evidence.example/L01'}},
    cleanupOwned:async()=>{cleanups++}};
  const r=await runG06E2E({evidence,ownerIntent:intent,adapter});
  assert.equal(r.code,'WAIT_DEVICE_EXCLUSIVE_FENCING');
  assert.equal(steps,1);assert.equal(cleanups,0);
});

test('replayed native session is blocked before any level action',async()=>{
  let levels=0;const adapter={verifyFence:async()=>fence(),
    beginOnce:async()=>({accepted:true,fresh:false,sessionId:'S10SESSION_12345'}),
    runLevel:async()=>{levels++},cleanupOwned:async()=>{levels++}};
  const r=await runG06E2E({adapter,evidence,ownerIntent:intent});
  assert.equal(r.code,'WAIT_DEVICE_EXCLUSIVE_FENCING');assert.equal(levels,0);
});
test('five levels PASS cannot be reported when scoped cleanup is unverified',async()=>{
  let count=0;const adapter={verifyFence:async()=>fence(),
    beginOnce:async()=>({accepted:true,fresh:true,sessionId:'S10SESSION_12345'}),
    runLevel:async({level})=>{count++;return {level,pass:true,evidenceRef:'https://evidence.example/'+level}},
    cleanupOwned:async()=>({cleaned:false})};
  const r=await runG06E2E({adapter,evidence,ownerIntent:intent});
  assert.equal(count,5);assert.equal(r.status,'WAIT');assert.equal(r.reason,'CLEANUP_NOT_ATTESTED');
});
