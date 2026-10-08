import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  managerAcceptancePausePlan,
  managerAcceptanceWakePlan,
} from '../apps/tigeriq-core/manager-cycle-policy.mjs';

const pending={allow:false,reason:'live_acceptance_pending'};

test('GitHub live acceptance stops repeating manager decisions for the same source revision',()=>{
  const plan=managerAcceptancePausePlan({source:'github',sourceRevision:'rev4569',gate:pending});
  assert.deepEqual(plan,{park:true,revision:'rev4569',reason:'live_acceptance_pending'});
  assert.deepEqual(managerAcceptanceWakePlan({
    awaitingRevision:plan.revision,sourceRevision:'rev4569',acceptanceAllowed:false,
  }),{wake:false,reason:'awaiting_evidence'});
  assert.deepEqual(managerAcceptanceWakePlan({
    awaitingRevision:plan.revision,sourceRevision:'rev4569',acceptanceAllowed:true,
  }),{wake:true,reason:'acceptance_satisfied'});
});

test('GitHub source changes resume the existing objective exactly when its revision changes',()=>{
  assert.deepEqual(managerAcceptanceWakePlan({
    awaitingRevision:'rev4569',sourceRevision:'rev4569-new',acceptanceAllowed:false,
  }),{wake:true,reason:'source_revision_changed'});
  assert.equal(managerAcceptanceWakePlan({
    awaitingRevision:'rev4569',sourceRevision:'rev4569',acceptanceAllowed:false,
  }).wake,false);
  assert.equal(managerAcceptanceWakePlan({
    awaitingRevision:'',sourceRevision:'rev4569-new',acceptanceAllowed:true,
  }).wake,false);
  assert.equal(managerAcceptanceWakePlan({
    awaitingRevision:'rev4569',sourceRevision:'',acceptanceAllowed:false,
  }).wake,false);
  assert.deepEqual(managerAcceptanceWakePlan({
    awaitingRevision:'rev4569',sourceRevision:'',acceptanceAllowed:true,
  }),{wake:false,reason:'awaiting_evidence'});
});

test('final review and declared dependency gates park; unknown/unwatched sources do not park forever',()=>{
  for(const reason of ['live_acceptance_pending','final_review_pending','dependency_pending']){
    assert.equal(managerAcceptancePausePlan({
      source:'github',sourceRevision:'rev4569',gate:{allow:false,reason},
    }).park,true);
  }
  for(const input of [
    {source:'api',sourceRevision:'rev4569',gate:pending},
    {source:'github',sourceRevision:'',gate:pending},
    {source:'github',sourceRevision:'rev4569',gate:{allow:true,reason:'acceptance_satisfied'}},
    {source:'github',sourceRevision:'rev4569',gate:{allow:false,reason:'unknown'}},
  ])assert.equal(managerAcceptancePausePlan(input).park,false);
});

test('Core and GitHub intake wire evidence parking and atomic active-only wakeup',()=>{
  const core=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
  const intake=readFileSync(new URL('../apps/tigeriq-core/github-intake.mjs',import.meta.url),'utf8');
  assert.match(core,/managerAcceptancePausePlan\(/);
  assert.match(core,/next_check_at='infinity'::timestamptz/);
  assert.match(core,/managerAwaitingAcceptanceRevision/);
  assert.match(core,/OBJECTIVE_COMPLETION_WAITING_EVIDENCE/);
  assert.match(intake,/managerAcceptanceWakePlan\(/);
  assert.match(intake,/if\(row\.status==='active'&&wake\.wake\)/);
  assert.match(intake,/metadata=coalesce\(metadata,'\{\}'::jsonb\)-'managerAwaitingAcceptanceRevision'/);
  assert.match(intake,/where id=\$1 and status='active'/);
  assert.match(intake,/OBJECTIVE_COMPLETION_EVIDENCE_RESUMED/);
});

test('a parked objective clears exhausted manager cycle budget without losing its acceptance fence',()=>{
  const core=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
  const fence="manager_cycles=0,summary=$2,next_check_at='infinity'::timestamptz";
  assert.ok(core.includes(fence));
  assert.ok(core.includes("'{managerAwaitingAcceptanceRevision}'"));
  assert.ok(core.includes("manager_cycles=manager_cycles+1,summary=$2,next_check_at=now()+interval '1 minute'"));
  assert.deepEqual(managerAcceptanceWakePlan({
    awaitingRevision:'rev4569',sourceRevision:'rev4569',acceptanceAllowed:false,
  }),{wake:false,reason:'awaiting_evidence'});
  assert.deepEqual(managerAcceptanceWakePlan({
    awaitingRevision:'rev4569',sourceRevision:'rev4569',acceptanceAllowed:true,
  }),{wake:true,reason:'acceptance_satisfied'});
});
