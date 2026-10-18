import test from 'node:test';
import assert from 'node:assert/strict';
import {sandboxBaseUrl,doctorAndSelectWork,safeEvidenceDir,driveWorkCard} from '../scripts/verify-core-ui-sandbox.mjs';

const baseUrl='http://127.0.0.1:4315/',now=Date.parse('2026-10-18T09:10:00.000Z');
const row={number:2054,title:'Paperclip R01',status:'BỊ CHẶN',url:'https://github.com/newsdayads/tigeriq-ai-lab/issues/2054'};
const ok=data=>({ok:true,headers:{get:()=> 'application/json; charset=utf-8'},json:async()=>data});
const fixture=({stale=false,rows=[row]}={})=>({
 '/api/status':{ok:true,core:{time:new Date(now).toISOString()}},
 '/api/health-live-work':{ok:true,projection:{generatedAt:new Date(stale?now-600000:now).toISOString(),stale:false,openWork:rows}}
});
const transport=(routes,calls=[])=>async(url,init)=>{
  const path=new URL(url).pathname;calls.push({url,init});
  assert.equal(init.method,'GET');assert.equal(init.redirect,'error');
  return ok(routes[path]);
};
test('sandbox target must be isolated loopback; live/main ports forbidden',()=>{
  assert.equal(sandboxBaseUrl(baseUrl),'http://127.0.0.1:4315');
  for(const url of ['https://127.0.0.1:4315/','http://localhost:4315/','http://10.0.0.1:4315/',
      'http://127.0.0.1:3150/','http://127.0.0.1:3210/','http://127.0.0.1:4315/path',
      'http://a:b@127.0.0.1:4315/'])assert.throws(()=>sandboxBaseUrl(url));
});
test('read-only doctor binds one fresh source Issue from two endpoints',async()=>{
  const calls=[];
  const result=await doctorAndSelectWork({baseUrl,issueNumber:2054,fetchImpl:transport(fixture(),calls),now});
  assert.equal(result.work.number,2054);
  assert.equal(result.proofScope,'SANDBOX_DIAGNOSTIC_NOT_LIVE_ACCEPTANCE');
  assert.deepEqual(calls.map(x=>new URL(x.url).pathname),['/api/status','/api/health-live-work']);
});
test('T03: work source URL must match canonical GitHub Issue before Doctor or UI trust',async()=>{
  const correct='https://github.com/newsdayads/tigeriq-ai-lab/issues/2054';
  assert.equal(row.url,correct);
  for(const bad of ['',
    'https://attacker.invalid/newsdayads/tigeriq-ai-lab/issues/2054',
    'https://github.com/newsdayads/tigeriq-ai-lab/issues/2055',
    'https://github.com/newsdayads/tigeriq-ai-lab/pull/2054']){
    const evil={...row,url:bad};
    await assert.rejects(doctorAndSelectWork({baseUrl,issueNumber:2054,
      fetchImpl:transport(fixture({rows:[evil]})),now}),{code:'WORK_SOURCE_URL_INVALID'});
  }
  let opened=0;
  await assert.rejects(driveWorkCard({diagnostic:{origin:'http://127.0.0.1:4315',
    issueNumber:2054,work:{...row,url:''}},browserFactory:async()=>{opened++;throw Error('BROWSER_NOT_AUTHORIZED');}}),
    {code:'WORK_SOURCE_URL_INVALID'});
  assert.equal(opened,0,'invalid source evidence must fail before browser creation');
});
test('stale, absent, duplicate and malformed projection fail closed',async()=>{
  for(const [data,code] of [
    [fixture({stale:true}),'WORK_PROJECTION_STALE'],
    [fixture({rows:[]}),'ISSUE_NOT_UNIQUELY_VISIBLE'],
    [fixture({rows:[row,row]}),'ISSUE_NOT_UNIQUELY_VISIBLE'],
    [{...fixture(),'/api/status':{ok:true}},'CORE_HEALTH_NOT_VERIFIED'],
    [{...fixture(),'/api/health-live-work':{ok:false}},'WORK_PROJECTION_UNAVAILABLE']
  ])await assert.rejects(doctorAndSelectWork({baseUrl,issueNumber:2054,fetchImpl:transport(data),now}),{code});
});
test('evidence output cannot escape scoped artifacts directory',()=>{
  assert.equal(safeEvidenceDir('artifacts/pstack-verification/run1','/tmp/repo'),'/tmp/repo/artifacts/pstack-verification/run1');
  for(const value of ['../outside','artifacts/pstack-verification','artifacts/other','/tmp/outside'])
    assert.throws(()=>safeEvidenceDir(value,'/tmp/repo'),{code:'EVIDENCE_SCOPE_INVALID'});
});
test('browser reads real UI selectors, opens modal and releases owned session',async()=>{
  const trace=[];let closed=false;
  const target={count:async()=>1,isVisible:async()=>true,innerText:async()=> '#2054 Paperclip',click:async()=>trace.push('click')};
  const backdrop={count:async()=>1,getAttribute:async()=> 'modal open'};
  const detail={innerText:async()=> 'Paperclip R01'},github={getAttribute:async()=>row.url};
  const page={goto:async(url)=>trace.push(url),url:()=> 'http://127.0.0.1:4315/',locator:sel=>({
    '.work-row[data-work-number="2054"]':target,'#workDetailBackdrop':backdrop,'#workDetailModal':detail,'#workDetailGithub':github
  })[sel]};
  const browserFactory=async()=>({newContext:async()=>({route:async()=>{},routeWebSocket:async()=>{},newPage:async()=>page}),close:async()=>{closed=true}});
  const result=await driveWorkCard({diagnostic:{origin:'http://127.0.0.1:4315',issueNumber:2054,work:row},browserFactory});
  assert.deepEqual(trace,['http://127.0.0.1:4315/','click']);
  assert.equal(result.githubHref,row.url);assert.equal(closed,true);
});
test('failed UI card check cannot pass; browser is still closed',async()=>{
  let closed=false;
  const browserFactory=async()=>({newContext:async()=>({newPage:async()=>({
    goto:async()=>{},url:()=> 'http://127.0.0.1:4315/',locator:()=>({count:async()=>0})
  }),route:async()=>{},routeWebSocket:async()=>{}}),close:async()=>{closed=true}});
  await assert.rejects(driveWorkCard({diagnostic:{origin:'http://127.0.0.1:4315',issueNumber:2054,work:row},browserFactory}),{code:'UI_WORK_CARD_NOT_VISIBLE'});
  assert.equal(closed,true);
});
