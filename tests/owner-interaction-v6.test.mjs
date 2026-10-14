import test from 'node:test';
import assert from 'node:assert/strict';
import {projectOwnerWorkCardV6,publishOwnerWorkCardV6} from '../apps/shared/owner-interaction-v6.mjs';

const source={fresh:true,verified:true,checkedAt:'2026-10-14T04:00:00Z'};
const row={id:'GH-4625',title:'DeXCam Personal',issueUrl:'https://github.com/newsdayads/tigeriq-ai-lab/issues/4625',
  priority:'P1',status:'READY',executable:true,queueIncluded:true,
  progress:{verified:true,completed:4,total:30,evidenceUrl:'https://github.com/newsdayads/tigeriq-ai-lab/issues/4625'}};
const project=(change={},src=source,actions={})=>projectOwnerWorkCardV6({...row,...change},src,actions);
test('shows verified numerator and denominator; 4/30 is 13%',()=>{
 const result=project();
 assert.equal(result.ok,true);
 assert.equal(result.card.progress.percent,13);
 assert.match(result.card.progress.label,/4\/30/);
 assert.equal(result.card.state.color,'warning');
 assert.deepEqual(result.card.buttons.map(x=>x.kind),['OPEN']);
});
test('no evidence means no percent; never generate progress from task age',()=>{
 const r=project({progress:{completed:29,total:30,verified:false,evidenceUrl:row.issueUrl}});
 assert.equal(r.card.progress.percent,null);
 assert.equal(r.card.progress.verified,false);
});
test('no misleading 100% before acceptance',()=>{
 const r=project({status:'DONE',progress:{verified:true,completed:2,total:2,evidenceUrl:row.issueUrl}});
 assert.equal(r.card.progress.percent,null);
 assert.equal(r.card.state.label,'CHỜ');
 assert.match(r.card.progress.label,/CHỜ NGHIỆM THU CUỐI/);
 const done=project({status:'DONE',acceptanceVerified:true,
  progress:{verified:true,completed:2,total:2,evidenceUrl:row.issueUrl}});
 assert.equal(done.card.progress.percent,100);
 assert.equal(done.card.state.color,'success');
});
test('unverified status and stale source never imply live work',()=>{
 const r=project({status:'WORKING'}, {...source,verified:false});
 assert.equal(r.card.state.label,'CHƯA XÁC MINH');
 const w=project({status:'WORKING'},source);
 assert.equal(w.card.state.label,'CHƯA XÁC MINH');
});
test('working requires verified lease, receipt and fresh heartbeat',()=>{
 const runtime={leaseVerified:true,receiptVerified:true,
   receiptUrl:row.issueUrl,heartbeatAt:'2026-10-14T03:59:05Z'};
 assert.equal(project({status:'WORKING',runtime}).card.state.color,'info');
 assert.equal(project({status:'WORKING',runtime:{...runtime,heartbeatAt:'2026-10-14T03:54:00Z'}}).card.state.label,'CHƯA XÁC MINH');
 assert.equal(project({status:'WORKING',runtime:{...runtime,leaseVerified:false}}).card.state.label,'CHƯA XÁC MINH');
});
test('P0, hold, occupied lease, stale snapshot, missing binding all hide CONTINUE',()=>{
 const execution={authorized:true,boundToExistingCore:true,readbackRequired:true,
  idempotencyKey:'v6-4625-0001',scope:'DEXCAM_PERSONAL_GH4625_SOURCE',onExecute:()=>{}};
 const buttons=(change={},src=source,ex=execution)=>project(change,src,{execution:ex}).card.buttons.map(x=>x.kind);
 assert.ok(buttons().includes('CONTINUE'));
 for(const x of [{priority:'P0'},{ownerHold:true},{mutationOwnerActive:true},
  {dependencyBlocked:true},{queueIncluded:false},{executable:false},{status:'BLOCKED'}])
  assert.ok(!buttons(x).includes('CONTINUE'));
 assert.ok(!buttons({}, {...source,fresh:false}).includes('CONTINUE'));
 assert.ok(!buttons({},source,{...execution,boundToExistingCore:false}).includes('CONTINUE'));
});
test('action is click-only: never dispatch during render',()=>{
 const called=[];
 const execution={authorized:true,boundToExistingCore:true,readbackRequired:true,
  idempotencyKey:'v6-4625-0001',scope:'DEXCAM_PERSONAL_GH4625_SOURCE',
  onExecute:args=>{called.push(args);return 'pending-readback';}};
 const displayed=[];
 const r=publishOwnerWorkCardV6(row,{source,actions:{onRefresh:()=>{},execution},
  emit:card=>displayed.push(card)});
 assert.equal(r.published,true);
 assert.equal(called.length,0);
 assert.deepEqual(displayed[0].buttons.map(x=>x.kind),['OPEN','REFRESH','CONTINUE']);
 displayed[0].buttons.find(x=>x.kind==='CONTINUE').onClick();
 assert.equal(called.length,1);
 assert.equal(called[0].scope,'DEXCAM_PERSONAL_GH4625_SOURCE');
});
test('rejects ungrounded issue or missing title and render callback',()=>{
 assert.equal(project({issueUrl:'javascript:alert(1)'}).ok,false);
 assert.equal(project({title:'  '}).ok,false);
 assert.equal(publishOwnerWorkCardV6(row,{source}).published,false);
});
test('bad ratio, 0 total or untrusted evidence URL never become a percent',()=>{
 for(const progress of [{verified:true,completed:5,total:2,evidenceUrl:row.issueUrl},
   {verified:true,completed:0,total:0,evidenceUrl:row.issueUrl},
   {verified:true,completed:1,total:2,evidenceUrl:'https://example.com/fake'}])
   assert.equal(project({progress}).card.progress.percent,null);
});
