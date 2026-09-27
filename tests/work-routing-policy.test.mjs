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

test('specialist routing table is deterministic',()=>{
  let s=classifyWorkOrder('PRIORITY=P2\nCAPABILITY=general');assert.equal(s.route,'UI');assert.equal(s.workerId,'NV02');
  s=classifyWorkOrder('PRIORITY=P2\nCAPABILITY=review');assert.equal(s.route,'UI');assert.equal(s.workerId,'NV03');
  s=classifyWorkOrder('PRIORITY=P2\nCAPABILITY=research');assert.equal(s.route,'UI');assert.equal(s.workerId,'NV04');
  s=classifyWorkOrder('PRIORITY=P2\nCAPABILITY=pc_operator');assert.equal(s.route,'OPENCLAW');assert.equal(s.workerId,'NV06');
  s=classifyWorkOrder('PRIORITY=P2\nEXECUTION_SURFACE=CODING\nAUTONOMOUS_CODE=true');assert.equal(s.route,'CODING');
});

test('preferred UI reviewer wins even with stale CORE_READ_ONLY surface; API reviewer stays Core',()=>{
  let s=classifyWorkOrder('PRIORITY=P1\nCAPABILITY=review\nPREFERRED_REVIEWER=NV03\nEXECUTION_SURFACE=CORE_READ_ONLY');
  assert.equal(s.route,'UI');assert.equal(s.workerId,'NV03');
  s=classifyWorkOrder('PRIORITY=P1\nCAPABILITY=review\nPREFERRED_REVIEWER=NV17\nEXECUTION_SURFACE=CORE_READ_ONLY');
  assert.equal(s.route,'CORE_REVIEW');assert.equal(s.workerId,'NV17');
});

test('assigned P0 remains Owner-only and never binds an employee',()=>{
  for(const body of ['ASSIGNED_EXECUTOR=NV03\nCAPABILITY=review','ASSIGNED_EXECUTOR=NV06\nCAPABILITY=pc_operator']){
    const s=classifyWorkOrder('PRIORITY=P0\n'+body);
    assert.equal(s.priority,'P0');assert.equal(s.ownerControlled,true);assert.equal(s.route,'HOLD_OWNER');assert.equal(s.workerId,null);assert.equal(s.assignedExecutor,'');
  }
});

test('employees never self-pull; P1-P5 require system assignment',()=>{
  for(const [worker,body] of [
    ['NV02','PRIORITY=P2\nCAPABILITY=general'],
    ['NV03','PRIORITY=P2\nCAPABILITY=review'],
    ['NV04','PRIORITY=P2\nCAPABILITY=research'],
    ['NV02','PRIORITY=P0\nASSIGNED_EXECUTOR=NV02\nCAPABILITY=general'],
  ])assert.equal(roleCanPull(worker,classifyWorkOrder(body)),false);
});

test('external role claim lease expires and release clears it',()=>{
  const now=Date.parse('2026-09-25T00:00:00Z');
  const comments=[{id:1,created_at:'2026-09-24T23:59:00Z',body:'[TIGERIQ_ROLE_CLAIM_V1]\nWORKER=NV02\nRESOURCE_SCOPE=ABC\nLEASE_UNTIL=2026-09-25T00:20:00Z'}];
  assert.equal(activeRoleClaim(comments,now)?.workerId,'NV02');
  assert.equal(activeRoleClaim(comments,Date.parse('2026-09-25T00:21:00Z')),null);
  const released=[...comments,{id:2,created_at:'2026-09-25T00:01:00Z',body:'[TIGERIQ_ROLE_RELEASE_V1]\nWORKER=NV02\nRESOURCE_SCOPE=ABC'}];
  assert.equal(activeRoleClaim(released,now+120000),null);
});
