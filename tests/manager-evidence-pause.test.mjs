import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  managerAcceptancePausePlan,
  managerAcceptanceRevisionRefresh,
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

test('dependency-only paused GitHub objectives wake when source body revision changes',()=>{
  const refresh=managerAcceptanceRevisionRefresh({
    dependencyGateRequired:true,revisionChanged:true,status:'active',
  });
  assert.equal(refresh,true);
  assert.deepEqual(managerAcceptanceWakePlan({
    awaitingRevision:'old-dependency-body',sourceRevision:'new-dependency-body',acceptanceAllowed:false,
  }),{wake:true,reason:'source_revision_changed'});
  for(const input of [
    {dependencyGateRequired:true,revisionChanged:false,status:'active'},
    {dependencyGateRequired:true,revisionChanged:true,status:'blocked'},
    {dependencyGateRequired:false,revisionChanged:true,status:'active'},
  ])assert.equal(managerAcceptanceRevisionRefresh(input),false);
  assert.equal(managerAcceptanceRevisionRefresh({
    sourceLiveRequired:true,revisionChanged:true,status:'active',
  }),true);
  assert.equal(managerAcceptanceRevisionRefresh({
    sourceFinalReviewRequired:true,revisionChanged:true,status:'active',
  }),true);
});

test('removing the last dependency gate refreshes a parked GitHub objective without bypassing blocked fences',()=>{
  // An old dependency-only objective remains parked after source removes DEPENDS_ON.
  // Even with no currently declared gates, the persisted parked marker is a watcher.
  const refreshed=managerAcceptanceRevisionRefresh({
    awaitingRevision:'old-dependency-source-revision',
    dependencyGateRequired:false,
    sourceLiveRequired:false,
    sourceFinalReviewRequired:false,
    revisionChanged:true,
    status:'active',
  });
  assert.equal(refreshed,true);
  assert.deepEqual(managerAcceptanceWakePlan({
    awaitingRevision:'old-dependency-source-revision',
    sourceRevision:'new-dependency-source-revision',
    acceptanceAllowed:true,
  }),{wake:true,reason:'acceptance_satisfied'});
  for(const input of [
    {awaitingRevision:'old-dependency-source-revision',revisionChanged:false,status:'active'},
    {awaitingRevision:'old-dependency-source-revision',revisionChanged:true,status:'blocked'},
    {awaitingRevision:'',revisionChanged:true,status:'active'},
    {awaitingRevision:null,revisionChanged:true,status:'active'},
  ])assert.equal(managerAcceptanceRevisionRefresh(input),false);
  assert.equal(managerAcceptanceRevisionRefresh({
    awaitingRevision:'old-dependency-source-revision',revisionChanged:true,status:'active',
  }),true);
});

test('Core and GitHub intake wire evidence parking and atomic active-only wakeup',()=>{
  const core=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
  const intake=readFileSync(new URL('../apps/tigeriq-core/github-intake.mjs',import.meta.url),'utf8');
  assert.match(core,/managerAcceptancePausePlan\(/);
  assert.match(core,/next_check_at='infinity'::timestamptz/);
  assert.match(core,/managerAwaitingAcceptanceRevision/);
  assert.match(core,/OBJECTIVE_COMPLETION_WAITING_EVIDENCE/);
  assert.match(intake,/managerAcceptanceRevisionRefresh\(/);
  assert.match(intake,/dependencyGateRequired:dependencyGate\.required/);
  assert.match(intake,/awaitingRevision:row\.metadata\?\.managerAwaitingAcceptanceRevision/);
  assert.match(intake,/managerAcceptanceWakePlan\(/);
  assert.match(intake,/if\(row\.status==='active'&&wake\.wake\)/);
  assert.match(intake,/metadata=coalesce\(metadata,'\{\}'::jsonb\)-'managerAwaitingAcceptanceRevision'/);
  assert.match(intake,/where id=\$1 and status='active' and metadata->>'managerAwaitingAcceptanceRevision'=\$3 and metadata->>'sourceRevision'=\$4/);
  assert.match(intake,/\[row\.id,summary,row\.metadata\.managerAwaitingAcceptanceRevision,row\.metadata\.sourceRevision\]/);
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
