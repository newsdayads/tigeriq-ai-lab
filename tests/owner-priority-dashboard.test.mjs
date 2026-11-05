import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {eligibleOwnerPriorityIssue,priorityFromIssue,priorityMutation,validateOwnerPriorityInput}
  from '../apps/tigeriq-core/owner-priority.mjs';

const base={number:5602,state:'open',title:'[P1][CAMERA] Test Camera',
 body:'TIGERIQ_JOB_V1\nWORK_ORDER_LIFECYCLE=V2\nPRIORITY=P1\nRESOURCE_SCOPE=CAMERA\nTIGERIQ_EXECUTABLE=true\nAUTO_QUEUE=INCLUDED\nOWNER_POLICY=AUTO\nOWNER_CONTROLLED=false\n'};
test('P0 owner-only changes both fields and does not add new work',()=>{
 assert.equal(eligibleOwnerPriorityIssue(base),true);
 assert.equal(priorityFromIssue(base),'P1');
 const plan=priorityMutation(base,'P0');
 assert.equal(plan.title,'[P0][CAMERA] Test Camera');
 assert.match(plan.body,/^PRIORITY=P0$/m);
 assert.match(plan.body,/^TIGERIQ_EXECUTABLE=false$/m);
 assert.match(plan.body,/^AUTO_QUEUE=EXCLUDED_P0_OWNER_VY_ONLY$/m);
 assert.match(plan.body,/^CORE_AUTO_CLAIM=FORBIDDEN_P0_OWNER_VY$/m);
 assert.match(plan.body,/^OWNER_CONTROLLED=true$/m);
 assert.doesNotMatch(plan.body,/^PRIORITY=P1$/m);
 assert.equal(priorityFromIssue({...base,...plan}),'P0');
});
test('legacy open P0 project work with no TIGERIQ_JOB_V1 is eligible',()=>{
 const legacy={state:'open',title:'[P0][AI HANDOFF] UltraCarHCM V1',
   body:'PROJECT_ID=dexcam-personal\nPRIORITY=P0\nRESOURCE_SCOPE=ULTRACARHCM_V1\n'};
 assert.equal(eligibleOwnerPriorityIssue(legacy),true);
 assert.match(priorityMutation(legacy,'P1').body,/^PRIORITY=P1$/m);
});
test('P0 downgrade cannot silently authorize auto execution',()=>{
 const first=priorityMutation(base,'P0');
 const next=priorityMutation({...base,...first},'P2');
 assert.match(next.body,/^PRIORITY=P2$/m);
 assert.match(next.body,/^TIGERIQ_EXECUTABLE=false$/m);
 assert.match(next.body,/^AUTO_QUEUE=EXCLUDED_OWNER_DIRECT_PENDING_EXPLICIT_DELEGATION$/m);
 assert.doesNotMatch(next.body,/^CORE_AUTO_CLAIM=/m);
 assert.doesNotMatch(next.body,/^P0_CONTROL=/m);
 assert.equal(next.title,'[P2][CAMERA] Test Camera');
});
test('invalid or stale input rejected, no write for same value',()=>{
 assert.equal(priorityMutation(base,'P1').changed,false);
 assert.throws(()=>validateOwnerPriorityInput({issueNumber:5602,priority:'P6',expectedPriority:'P1',expectedUpdatedAt:'2026-11-03T01:00:00Z'}),/PRIORITY_INVALID/);
 assert.throws(()=>priorityMutation({...base,pull_request:{}},'P0'),/NOT_ELIGIBLE/);
 assert.throws(()=>priorityMutation({...base,state:'closed'},'P0'),/NOT_ELIGIBLE/);
 assert.throws(()=>priorityMutation({...base,body:'anything'},'P0'),/NOT_ELIGIBLE/);
});
test('dashboard control is link to owner-authorized route, no direct github mutation',()=>{
 const h=readFileSync(new URL('../apps/tigeriq-core/dashboard.html',import.meta.url),'utf8');
 const c=readFileSync(new URL('../api/control.mjs',import.meta.url),'utf8');
 const page=readFileSync(new URL('../public/owner-priority.html',import.meta.url),'utf8');
 assert.match(h,/id="workDetailPrioritySelect"/);
 assert.match(h,/id="workDetailPriorityApply"/);
 assert.match(h,/owner-priority\?issue=/);
 assert.match(c,/operation === 'owner-priority'/);
 assert.match(c,/isOwnerAuthorized\(req\)/);
 assert.match(c,/sameOriginWrite\(req\)/);
 assert.match(c,/GITHUB_WRITE_READBACK_NOT_VERIFIED/);
 assert.match(page,/id="save"/);
});
