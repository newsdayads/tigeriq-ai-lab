import {test} from 'vitest';
import assert from 'node:assert/strict';
import {effectiveBacklogPriority} from '../apps/tigeriq-core/github-backlog-policy.mjs';
import {activeRoleClaim,classifyWorkOrder,roleCanPull} from '../apps/tigeriq-core/work-routing-policy.mjs';

test('P0 is Owner-controlled only; legacy high-priority P0 becomes autonomous P1',()=>{
  assert.deepEqual(effectiveBacklogPriority('PRIORITY=P0\nOWNER_CONTROLLED=true'),{sourcePriority:'P0',priority:'P0',ownerControlled:true,assignedExecutor:'',legacyP0Autonomous:false});
  assert.deepEqual(effectiveBacklogPriority('PRIORITY=P0\nOWNER_DIRECT=true'),{sourcePriority:'P0',priority:'P1',ownerControlled:false,assignedExecutor:'',legacyP0Autonomous:true});
  assert.equal(classifyWorkOrder('PRIORITY=P0\nOWNER_CONTROLLED=true\nCAPABILITY=general').route,'HOLD_OWNER');
  const legacy=classifyWorkOrder('PRIORITY=P0\nOWNER_DIRECT=true\nCAPABILITY=general');
  assert.equal(legacy.priority,'P1');assert.equal(legacy.workerId,'NV02');assert.equal(legacy.route,'UI');
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

test('explicit P0 assigned executor routes only to that worker',()=>{
  let s=classifyWorkOrder('PRIORITY=P0\nASSIGNED_EXECUTOR=NV03\nCAPABILITY=review');assert.equal(s.priority,'P0');assert.equal(s.route,'UI');assert.equal(s.workerId,'NV03');
  s=classifyWorkOrder('PRIORITY=P0\nASSIGNED_EXECUTOR=NV06\nCAPABILITY=pc_operator');assert.equal(s.route,'OPENCLAW');assert.equal(s.workerId,'NV06');
});

test('fallback role pull is P1-P5 only and role-bounded',()=>{
  assert.equal(roleCanPull('NV02',classifyWorkOrder('PRIORITY=P2\nCAPABILITY=general')),true);
  assert.equal(roleCanPull('NV02',classifyWorkOrder('PRIORITY=P0\nOWNER_CONTROLLED=true\nASSIGNED_EXECUTOR=NV02\nCAPABILITY=general')),false);
  assert.equal(roleCanPull('NV03',classifyWorkOrder('PRIORITY=P2\nCAPABILITY=review')),true);
  assert.equal(roleCanPull('NV04',classifyWorkOrder('PRIORITY=P2\nCAPABILITY=research')),true);
  assert.equal(roleCanPull('NV02',classifyWorkOrder('PRIORITY=P2\nCAPABILITY=pc_operator')),false);
});

test('external role claim lease expires and release clears it',()=>{
  const now=Date.parse('2026-09-25T00:00:00Z');
  const comments=[{id:1,created_at:'2026-09-24T23:59:00Z',body:'[TIGERIQ_ROLE_CLAIM_V1]\nWORKER=NV02\nRESOURCE_SCOPE=ABC\nLEASE_UNTIL=2026-09-25T00:20:00Z'}];
  assert.equal(activeRoleClaim(comments,now)?.workerId,'NV02');
  assert.equal(activeRoleClaim(comments,Date.parse('2026-09-25T00:21:00Z')),null);
  const released=[...comments,{id:2,created_at:'2026-09-25T00:01:00Z',body:'[TIGERIQ_ROLE_RELEASE_V1]\nWORKER=NV02\nRESOURCE_SCOPE=ABC'}];
  assert.equal(activeRoleClaim(released,now+120000),null);
});
