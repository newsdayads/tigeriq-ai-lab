import test from 'node:test';
import assert from 'node:assert/strict';
import {Buffer} from 'node:buffer';
import {
  NV04_IDLE_AUDIT_PATHS,nv04IdleAuditGate,nv04IdleSourcePacket,
  buildNv04IdleAuditPrompt,parseNv04IdleAuditResult,nv04IdleAuditSlot,
} from '../apps/tigeriq-core/nv04-idle-audit.mjs';

const now=Date.parse('2026-10-15T12:00:00Z');
const ready=()=>({
  id:'NV04',status:'READY',uiPhase:'READY',uiBusy:false,blocked:false,
  heartbeatAt:new Date(now).toISOString(),url:'https://gemini.google.com/app',
  securityBlock:null,windowState:'OPEN',composerReady:true,
});
const sha='0000000000000000000000000000000000000000';
const source='export function testRoute(){return 12345678;}\nexport const VERSION=2026;\n';
const response=(obj,status=200)=>({ok:status===200,status,json:async()=>obj});
function fixtureFetch(calls=[]){
  return async url=>{
    calls.push(url);
    if(url.endsWith('/commits/main'))return response({sha});
    if(url.includes('/contents/'))return response({encoding:'base64',sha:'file-sha',content:Buffer.from(source).toString('base64')});
    throw Error('UNEXPECTED_FETCH '+url);
  };
}

test('NV04 idle audit fail-closed gate requires enabled fresh truly idle Gemini; real Core assignment wins',()=>{
  const valid=ready();
  assert.deepEqual(nv04IdleAuditGate({enabled:true,worker:valid,now}),{eligible:true,reason:'NV04_IDLE_READY'});
  assert.equal(nv04IdleAuditGate({enabled:false,worker:valid,now}).reason,'IDLE_AUDIT_DISABLED');
  assert.equal(nv04IdleAuditGate({enabled:true,worker:null,now}).reason,'NV04_HEARTBEAT_MISSING');
  assert.equal(nv04IdleAuditGate({enabled:true,worker:{...valid,heartbeatAt:new Date(now-91_000).toISOString()},now}).reason,'NV04_HEARTBEAT_STALE');
  assert.equal(nv04IdleAuditGate({enabled:true,worker:valid,normalJobPending:true,now}).reason,'NORMAL_WORK_PRIORITY');
  assert.equal(nv04IdleAuditGate({enabled:true,worker:valid,coreAvailable:false,now}).reason,'CORE_UNAVAILABLE');
  for(const partial of [{status:'WORKING'},{uiBusy:true},{blocked:true},{securityBlock:'BLOCKED_CAPTCHA'},{windowState:'CLOSED'},{composerReady:false},{url:'https://chatgpt.com/'},{uiPhase:'STALLED'}]){
    assert.equal(nv04IdleAuditGate({enabled:true,worker:{...valid,...partial},now}).eligible,false);
  }
});

test('only bounded, allowlisted source files are fetched and pinned to exact main SHA',async()=>{
  const calls=[],packet=await nv04IdleSourcePacket({fetchImpl:fixtureFetch(calls),slot:'20261015T00'});
  assert.equal(packet.sha,sha);
  assert.equal(packet.files.length,2);
  assert.deepEqual(packet.files.map(x=>x.path),NV04_IDLE_AUDIT_PATHS.slice(0,2));
  assert.ok(calls.every(x=>x.includes('api.github.com/repos/newsdayads/tigeriq-ai-lab')));
  assert.ok(calls.slice(1).every(x=>x.endsWith('?ref='+sha)));
  const pinned=[];
  await nv04IdleSourcePacket({fetchImpl:fixtureFetch(pinned),refSha:sha,slot:'20261015T00'});
  assert.ok(!pinned.some(x=>x.includes('/commits/main')));
  assert.match(buildNv04IdleAuditPrompt(packet),/PHAM_VI=Chỉ hai file/);
  assert.match(buildNv04IdleAuditPrompt(packet),/KHONG_SUA_CODE/);
  assert.match(buildNv04IdleAuditPrompt(packet),new RegExp('SOURCE_SHA='+sha));
  const later=await nv04IdleSourcePacket({fetchImpl:fixtureFetch(),slot:'20261015T06'});
  assert.notDeepEqual(later.files.map(x=>x.path),packet.files.map(x=>x.path));
  assert.equal(nv04IdleAuditSlot(Date.UTC(2026,9,15,23)), '20261015T18');
});

test('NV04 audit results require exact source SHA, allowlisted file, true quoted line and reproducibility',async()=>{
  const packet=await nv04IdleSourcePacket({fetchImpl:fixtureFetch(),slot:'20261015T00'});
  const finding={path:packet.files[0].path,line:1,quote:'export function testRoute()',description:'Hàm định tuyến có thể sai khi kiểm tra điều kiện biên',repro:'Viết unit test cho đầu vào null và dạng không hợp lệ',severity:'P2'};
  const envelope=f=>['NV04_IDLE_AUDIT_RESULT_V1','SOURCE_SHA='+sha,'AUDIT_SLOT='+packet.slot,'FINDINGS_JSON='+JSON.stringify(f)].join('\n');
  const ok=parseNv04IdleAuditResult(envelope([finding]),packet);
  assert.equal(ok.accepted,true);
  assert.equal(ok.findings[0].verification,'SOURCE_LINE_CONFIRMED_LOGIC_UNVERIFIED');
  assert.equal(ok.findings[0].signature.length,20);
  assert.equal(parseNv04IdleAuditResult(envelope([]),packet).accepted,true);
  assert.equal(parseNv04IdleAuditResult(envelope([{...finding,quote:'UNRELATED_SOURCE_LINE'}]),packet).reason,'AUDIT_FINDING_SOURCE_UNVERIFIED');
  assert.equal(parseNv04IdleAuditResult(envelope([{...finding,path:'../../.env'}]),packet).reason,'AUDIT_FINDING_CONTRACT_INVALID');
  assert.equal(parseNv04IdleAuditResult(envelope([{...finding,line:99999}]),packet).accepted,false);
  assert.equal(parseNv04IdleAuditResult(envelope(Array.from({length:6},()=>finding)),packet).reason,'AUDIT_FINDINGS_LIMIT');
  assert.equal(parseNv04IdleAuditResult(envelope([finding]).replace(sha,'f'.repeat(40)),packet).reason,'AUDIT_SOURCE_SHA_MISMATCH');
  assert.equal(parseNv04IdleAuditResult(envelope([finding]).replace('AUDIT_SLOT='+packet.slot,'AUDIT_SLOT=20261015T06'),packet).reason,'AUDIT_SLOT_MISMATCH');
  assert.equal(parseNv04IdleAuditResult('DONE',packet).accepted,false);
});

test('missing source proof must fail closed',async()=>{
  await assert.rejects(()=>nv04IdleSourcePacket({fetchImpl:async()=>response({sha:'bad'})}),/NV04_IDLE_MAIN_SHA_UNVERIFIED/);
  await assert.rejects(()=>nv04IdleSourcePacket({fetchImpl:async url=>response(url.endsWith('/commits/main')?{sha}:{encoding:'unknown',content:''})}),/NV04_IDLE_SOURCE_CONTENT_UNVERIFIED/);
  await assert.rejects(()=>nv04IdleSourcePacket({fetchImpl:fixtureFetch(),paths:['.env']}),/NV04_IDLE_SOURCE_ALLOWLIST_EMPTY/);
});
