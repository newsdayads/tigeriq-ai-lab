import {test} from 'vitest';
import assert from 'node:assert/strict';
import {effectiveBacklogPriority} from '../apps/tigeriq-core/github-backlog-policy.mjs';
import {activeRoleClaim,classifyWorkOrder,roleCanPull} from '../apps/tigeriq-core/work-routing-policy.mjs';

test('P0 is always Owner-only regardless of stale delegation markers',()=>{
  for(const body of [
    'PRIORITY=P0',
    'PRIORITY=P0\nOWNER_DIRECT=true',
    'PRIORITY=P0\nASSIGNED_EXECUTOR=NV03',
    'PRIORITY=P0\nPRIMARY_EMPLOYEE=NV06',
    'PRIORITY=P0\nOWNER_POLICY=AUTO\nTIGERIQ_EXECUTABLE=true',
  ]){
    const priority=effectiveBacklogPriority(body);
    assert.equal(priority.priority,'P0');assert.equal(priority.ownerControlled,true);assert.equal(priority.legacyP0Autonomous,false);
    const spec=classifyWorkOrder(body+'\nCAPABILITY=general');
    assert.equal(spec.route,'HOLD_OWNER');assert.equal(spec.workerId,null);assert.equal(spec.autonomous,false);assert.equal(spec.assignedExecutor,'');
  }
});

test('P1-P5 remain autonomous and keep their priority',()=>{
  for(const p of ['P1','P2','P3','P4','P5']){
    const spec=classifyWorkOrder('PRIORITY='+p+'\nCAPABILITY=reasoning');
    assert.equal(spec.priority,p);assert.equal(spec.route,'CORE_REASONING');assert.equal(spec.autonomous,true);
  }
});

test('specialist routing keeps NV02 external and Core-routes NV03/NV04 roles',()=>{
  let s=classifyWorkOrder('PRIORITY=P2\nCAPABILITY=general');assert.equal(s.route,'CORE_REASONING');assert.equal(s.workerId,null);
  s=classifyWorkOrder('PRIORITY=P2\nCAPABILITY=review');assert.equal(s.route,'UI');assert.equal(s.workerId,'NV03');assert.equal(s.autonomous,true);
  s=classifyWorkOrder('PRIORITY=P2\nCAPABILITY=research');assert.equal(s.route,'UI');assert.equal(s.workerId,'NV04');assert.equal(s.autonomous,true);
  s=classifyWorkOrder('PRIORITY=P2\nCAPABILITY=deep_research');assert.equal(s.route,'UI');assert.equal(s.workerId,'NV04');assert.equal(s.autonomous,true);
  s=classifyWorkOrder('PRIORITY=P2\nCAPABILITY=pc_operator');assert.equal(s.route,'OPENCLAW');assert.equal(s.workerId,'NV06');
  s=classifyWorkOrder('PRIORITY=P2\nEXECUTION_SURFACE=CODING\nAUTONOMOUS_CODE=true');assert.equal(s.route,'CODING');
});

test('explicit mobile_worker capability or surface routes only to the mobile lane',()=>{
  let s=classifyWorkOrder('PRIORITY=P1\nCAPABILITY=mobile_worker');
  assert.equal(s.route,'MOBILE_WORKER');assert.equal(s.capability,'mobile_worker');assert.equal(s.surface,'MOBILE_WORKER');assert.equal(s.workerId,null);assert.equal(s.autonomous,true);
  s=classifyWorkOrder('PRIORITY=P2\nCAPABILITY=general\nEXECUTION_SURFACE=MOBILE_WORKER');
  assert.equal(s.route,'MOBILE_WORKER');assert.equal(s.capability,'mobile_worker');assert.equal(s.surface,'MOBILE_WORKER');assert.equal(s.workerId,null);
  s=classifyWorkOrder('PRIORITY=P1\nCAPABILITY=mobile_worker\nASSIGNED_EXECUTOR=NV06');
  assert.equal(s.route,'MOBILE_WORKER');assert.equal(s.workerId,null);assert.equal(s.assignedExecutor,'');
});

test('explicit UI preference routes NV03/NV04 autonomously while NV02 stays external',()=>{
  let s=classifyWorkOrder('PRIORITY=P1\nCAPABILITY=review\nPREFERRED_REVIEWER=NV03\nEXECUTION_SURFACE=CORE_READ_ONLY');
  assert.equal(s.route,'UI');assert.equal(s.workerId,'NV03');assert.equal(s.autonomous,true);
  s=classifyWorkOrder('PRIORITY=P1\nCAPABILITY=research\nPREFERRED_REVIEWER=NV04');
  assert.equal(s.route,'UI');assert.equal(s.workerId,'NV04');assert.equal(s.autonomous,true);
  s=classifyWorkOrder('PRIORITY=P1\nCAPABILITY=review\nPREFERRED_REVIEWER=NV02');
  assert.equal(s.route,'UI');assert.equal(s.workerId,'NV02');assert.equal(s.autonomous,false);
  s=classifyWorkOrder('PRIORITY=P1\nCAPABILITY=review\nPREFERRED_REVIEWER=NV17\nEXECUTION_SURFACE=CORE_READ_ONLY');
  assert.equal(s.route,'UI');assert.equal(s.workerId,'NV03');assert.equal(s.surface,'CORE_UI_REVIEW');assert.equal(s.reviewRoutingReason,'NV03_PRIMARY_GENERIC_REVIEW');
});

test('assigned P0 remains Owner-only and never binds an employee',()=>{
  for(const body of ['ASSIGNED_EXECUTOR=NV03\nCAPABILITY=review','ASSIGNED_EXECUTOR=NV06\nCAPABILITY=pc_operator']){
    const s=classifyWorkOrder('PRIORITY=P0\n'+body);
    assert.equal(s.priority,'P0');assert.equal(s.ownerControlled,true);assert.equal(s.route,'HOLD_OWNER');assert.equal(s.workerId,null);assert.equal(s.assignedExecutor,'');
  }
});

test('NV02 NV03 NV04 never self-pull through Core routing',()=>{
  for(const worker of ['NV02','NV03','NV04']){
    for(const body of ['PRIORITY=P1\nCAPABILITY=general','PRIORITY=P2\nCAPABILITY=review','PRIORITY=P3\nCAPABILITY=research','PRIORITY=P0\nCAPABILITY=general']){
      assert.equal(roleCanPull(worker,classifyWorkOrder(body)),false);
    }
  }
});

test('explicit Core assignment can delegate only NV03/NV04 autonomously',()=>{
  let s=classifyWorkOrder('PRIORITY=P2\nASSIGNED_EXECUTOR=NV02\nCAPABILITY=general');
  assert.equal(s.route,'UI');assert.equal(s.workerId,'NV02');assert.equal(s.autonomous,false);
  for(const worker of ['NV03','NV04']){
    s=classifyWorkOrder('PRIORITY=P2\nASSIGNED_EXECUTOR='+worker+'\nCAPABILITY='+(worker==='NV03'?'review':'research'));
    assert.equal(s.route,'UI');assert.equal(s.workerId,worker);assert.equal(s.autonomous,true);
  }
});

test('TARGET_EMPLOYEE has assignment precedence and routes explicit NV03/NV04 work to UI',()=>{
  let s=classifyWorkOrder('PRIORITY=P1\nTARGET_EMPLOYEE=NV03\nASSIGNED_EXECUTOR=NV11\nPRIMARY_EMPLOYEE=NV12\nCAPABILITY=review');
  assert.equal(s.route,'UI');assert.equal(s.workerId,'NV03');assert.equal(s.assignedExecutor,'NV03');assert.equal(s.autonomous,true);
  s=classifyWorkOrder('PRIORITY=P1\nTARGET_EMPLOYEE=NV04\nASSIGNED_EXECUTOR=NV11\nPRIMARY_EMPLOYEE=NV12\nCAPABILITY=deep_research');
  assert.equal(s.route,'UI');assert.equal(s.workerId,'NV04');assert.equal(s.assignedExecutor,'NV04');assert.equal(s.autonomous,true);
});

test('external role claim lease expires and release clears it',()=>{
  const now=Date.parse('2026-09-25T00:00:00Z');
  const comments=[{id:1,created_at:'2026-09-24T23:59:00Z',body:'[TIGERIQ_ROLE_CLAIM_V1]\nWORKER=NV02\nRESOURCE_SCOPE=ABC\nLEASE_UNTIL=2026-09-25T00:20:00Z'}];
  assert.equal(activeRoleClaim(comments,now)?.workerId,'NV02');
  assert.equal(activeRoleClaim(comments,Date.parse('2026-09-25T00:21:00Z')),null);
  const released=[...comments,{id:2,created_at:'2026-09-25T00:01:00Z',body:'[TIGERIQ_ROLE_RELEASE_V1]\nWORKER=NV02\nRESOURCE_SCOPE=ABC'}];
  assert.equal(activeRoleClaim(released,now+120000),null);
});


test('generic review ignores stale NV10 target and routes to NV03 primary',()=>{
  const body=[
    'PRIORITY=P1',
    'CAPABILITY=review',
    'EXECUTION_SURFACE=CORE_REASONING',
    'TARGET_EMPLOYEE=NV10',
    'ASSIGNED_EXECUTOR=NV10',
    'PREFERRED_REVIEWER=NV10',
  ].join('\n');
  const s=classifyWorkOrder(body);
  assert.equal(s.route,'UI');
  assert.equal(s.workerId,'NV03');
  assert.equal(s.surface,'CORE_UI_REVIEW');
  assert.equal(s.requestedReviewer,'NV10');
  assert.equal(s.reviewRoutingReason,'NV03_PRIMARY_GENERIC_REVIEW');
});

test('NV10 review requires explicit API Doctor or SRE specialty or Owner reviewer marker',()=>{
  let s=classifyWorkOrder('PRIORITY=P1\nCAPABILITY=review\nTARGET_EMPLOYEE=NV10\nREVIEW_SPECIALTY=API_DOCTOR');
  assert.equal(s.route,'CORE_REVIEW');assert.equal(s.workerId,'NV10');assert.equal(s.reviewRoutingReason,'NV10_SPECIALIZED_API_DOCTOR');
  s=classifyWorkOrder('PRIORITY=P1\nCAPABILITY=review\nTARGET_EMPLOYEE=NV10\nREVIEW_SPECIALTY=SRE');
  assert.equal(s.route,'CORE_REVIEW');assert.equal(s.workerId,'NV10');assert.equal(s.reviewRoutingReason,'NV10_SPECIALIZED_SRE');
  s=classifyWorkOrder('PRIORITY=P1\nCAPABILITY=review\nTARGET_EMPLOYEE=NV10\nOWNER_REVIEWER=NV10');
  assert.equal(s.route,'CORE_REVIEW');assert.equal(s.workerId,'NV10');assert.equal(s.reviewRoutingReason,'OWNER_EXPLICIT_REVIEWER');
});

test('API reviewer fallback is explicit and carries an NV03 unavailable reason',()=>{
  let s=classifyWorkOrder('PRIORITY=P1\nCAPABILITY=review\nPREFERRED_REVIEWER=NV17\nREVIEW_FALLBACK_EMPLOYEE=NV17\nREVIEW_FALLBACK_REASON=NV03_UNAVAILABLE');
  assert.equal(s.route,'CORE_REVIEW');assert.equal(s.workerId,'NV17');assert.match(s.reviewRoutingReason,/NV03_UNAVAILABLE_FALLBACK/);
  s=classifyWorkOrder('PRIORITY=P1\nCAPABILITY=review\nPREFERRED_REVIEWER=NV17');
  assert.equal(s.route,'UI');assert.equal(s.workerId,'NV03');assert.equal(s.reviewRoutingReason,'NV03_PRIMARY_GENERIC_REVIEW');
});

test('read-only final review without explicit capability uses NV03 review route',()=>{
  const s=classifyWorkOrder('PRIORITY=P1\nFINAL_REVIEW_REQUIRED=true\nNO_CODE_CHANGE=true');
  assert.equal(s.capability,'review');assert.equal(s.route,'UI');assert.equal(s.workerId,'NV03');assert.equal(s.surface,'CORE_UI_REVIEW');
});


test('P0 stays Owner-held except explicit Vy read-only review dispatch to NV03/NV04',()=>{
  const base=[
    'PRIORITY=P0','CAPABILITY=review','OWNER_DIRECT=true','VY_DIRECT_REVIEW_DISPATCH=true',
    'REVIEW_ONLY=true','NO_CODE_CHANGE=true','NO_PC01_SHELL=true','NO_DIRECT_MAIN=true',
    'NO_PRODUCTION_RELEASE=true','NO_PAID_COST=true','NO_CREDENTIAL_CHANGE=true',
    'NO_SECURITY_BOUNDARY_CHANGE=true','NO_DESTRUCTIVE=true'
  ].join('\n');
  let s=classifyWorkOrder(base+'\nOWNER_REVIEWER=NV03');
  assert.equal(s.route,'UI');assert.equal(s.workerId,'NV03');assert.equal(s.autonomous,true);
  assert.equal(s.reviewRoutingReason,'OWNER_VY_DIRECT_P0_REVIEW');
  s=classifyWorkOrder(base+'\nOWNER_REVIEWER=NV04');
  assert.equal(s.route,'UI');assert.equal(s.workerId,'NV04');assert.equal(s.autonomous,true);
  for(const body of [
    'PRIORITY=P0\nCAPABILITY=review\nOWNER_REVIEWER=NV03',
    base+'\nOWNER_REVIEWER=NV11',
    base.replace('REVIEW_ONLY=true\n','')+'\nOWNER_REVIEWER=NV03',
    base.replace('NO_SECURITY_BOUNDARY_CHANGE=true\n','')+'\nOWNER_REVIEWER=NV03',
    'PRIORITY=P0\nCAPABILITY=coding\nOWNER_DIRECT=true\nVY_DIRECT_REVIEW_DISPATCH=true\nREVIEW_ONLY=true\nNO_CODE_CHANGE=true\nOWNER_REVIEWER=NV03'
  ]){
    const blocked=classifyWorkOrder(body);
    assert.equal(blocked.route,'HOLD_OWNER');
    assert.equal(blocked.autonomous,false);
  }
});


test('second opinion routes to NV04 without changing generic NV03 review primary',()=>{
  let s=classifyWorkOrder('PRIORITY=P2\nCAPABILITY=second_opinion');
  assert.equal(s.route,'UI');assert.equal(s.workerId,'NV04');assert.equal(s.autonomous,true);
  s=classifyWorkOrder('PRIORITY=P2\nCAPABILITY=review\nREVIEW_SPECIALTY=SECOND_OPINION');
  assert.equal(s.route,'UI');assert.equal(s.workerId,'NV04');assert.equal(s.reviewRoutingReason,'NV04_SECOND_OPINION');
  s=classifyWorkOrder('PRIORITY=P2\nCAPABILITY=review');
  assert.equal(s.route,'UI');assert.equal(s.workerId,'NV03');
});