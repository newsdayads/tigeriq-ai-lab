import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  managerAcceptancePausePlan,
  managerAcceptanceRevisionRefresh,
  managerAcceptanceWakePlan,
  managerTerminalProgressPlan,
  managerCycleGuard,
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

test('GitHub scan time cannot hide actual manager job completion',()=>{
  const latest='2026-10-10T12:01:00.000Z';
  const old='2026-10-10T11:59:00.000Z';
  const res=managerTerminalProgressPlan({
    latestTerminalAt:latest,observedTerminalAt:old,managerCycles:29,
    // Objective updated_at may already be 12:10 after a GitHub scan;
    // it must not appear in this progress determination.
  });
  assert.deepEqual(res,{progressed:true,checkpoint:true,observedAt:latest});
  assert.equal(managerCycleGuard({managerCycles:29,progressed:res.progressed}).effectiveCycles,0);
  // Repeated reconciliation with no new DONE job must not claim progress again.
  const repeated=managerTerminalProgressPlan({
    latestTerminalAt:latest,observedTerminalAt:res.observedAt,managerCycles:29,
  });
  assert.deepEqual(repeated,{progressed:false,checkpoint:false,observedAt:latest});
  assert.equal(managerCycleGuard({managerCycles:30,progressed:repeated.progressed}).blocked,true);
});

test('PostgreSQL Date timestamps retain subsecond terminal-job progress',()=>{
  // pg returns completed_at as Date, not an ISO string. Date.toString()
  // omits milliseconds: two DONE jobs in the same second must not collapse.
  const first=new Date('2026-10-10T12:01:00.103Z');
  const second=new Date('2026-10-10T12:01:00.437Z');
  const baseline=managerTerminalProgressPlan({latestTerminalAt:first,managerCycles:0});
  assert.deepEqual(baseline,{progressed:false,checkpoint:true,observedAt:first.toISOString()});
  const advanced=managerTerminalProgressPlan({
    latestTerminalAt:second,observedTerminalAt:baseline.observedAt,managerCycles:29,
  });
  assert.deepEqual(advanced,{progressed:true,checkpoint:true,observedAt:second.toISOString()});
  assert.equal(managerCycleGuard({managerCycles:29,progressed:advanced.progressed}).effectiveCycles,0);
  const repeat=managerTerminalProgressPlan({
    latestTerminalAt:second,observedTerminalAt:advanced.observedAt,managerCycles:29,
  });
  assert.deepEqual(repeat,{progressed:false,checkpoint:false,observedAt:second.toISOString()});
  assert.equal(managerTerminalProgressPlan({latestTerminalAt:new Date(NaN),managerCycles:29}).checkpoint,false);
});

test('legacy manager job progress watermark migrates only once, then requires new evidence',()=>{
  const latest=new Date('2026-10-10T12:01:00.000Z');
  const bootstrap=managerTerminalProgressPlan({latestTerminalAt:latest,managerCycles:12});
  assert.deepEqual(bootstrap,{progressed:true,checkpoint:true,observedAt:latest.toISOString()});
  const after=managerTerminalProgressPlan({
    latestTerminalAt:latest,observedTerminalAt:bootstrap.observedAt,managerCycles:12,
  });
  assert.deepEqual(after,{progressed:false,checkpoint:false,observedAt:latest.toISOString()});
  const initialZero=managerTerminalProgressPlan({latestTerminalAt:latest,managerCycles:0});
  assert.equal(initialZero.progressed,false);
  assert.equal(initialZero.checkpoint,true);
  const noJob=managerTerminalProgressPlan({managerCycles:24});
  assert.deepEqual(noJob,{progressed:false,checkpoint:false,observedAt:null});
  const badJob=managerTerminalProgressPlan({
    latestTerminalAt:'invalid',observedTerminalAt:bootstrap.observedAt,managerCycles:24,
  });
  assert.deepEqual(badJob,{progressed:false,checkpoint:false,observedAt:null});
  const olderJob=managerTerminalProgressPlan({
    latestTerminalAt:'2026-10-10T11:58:00.000Z',observedTerminalAt:bootstrap.observedAt,
    managerCycles:24,
  });
  assert.equal(olderJob.progressed,false);
  assert.equal(olderJob.checkpoint,false);
});

test('Core persists terminal progress without mutating the GitHub fairness cursor',()=>{
  const core=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
  const intake=readFileSync(new URL('../apps/tigeriq-core/github-intake.mjs',import.meta.url),'utf8');
  assert.match(core,/managerTerminalProgressPlan\(/);
  assert.match(core,/observedTerminalAt:o\.metadata\?\.managerLastObservedTerminalAt/);
  assert.match(core,/metadata=jsonb_set\(coalesce\(metadata,'\{\}'::jsonb\),'\{managerLastObservedTerminalAt\}'/);
  assert.match(core,/managerGuard=managerCycleGuard\(\{managerCycles:o\.manager_cycles,progressed:terminalProgress\.progressed/);
  // The previous two-statement implementation could checkpoint DONE job
  // progress and crash before resetting manager_cycles. Those mutations must
  // be one SQL UPDATE guarded by the exact previously observed watermark.
  assert.match(core,/manager_cycles=case when \$4::boolean then 0 else manager_cycles end/);
  assert.match(core,/updated_at=case when \$4::boolean then now\(\) else updated_at end/);
  assert.match(core,/where id=\$1 and status='active' and \(metadata->>'managerLastObservedTerminalAt'\) is not distinct from \$3::text/);
  assert.match(core,/\[o\.id,terminalProgress\.observedAt,o\.metadata\?\.managerLastObservedTerminalAt\?\?null,terminalProgress\.progressed\]/);
  assert.match(core,/if\(saved\.rowCount!==1\)return;/);
  assert.ok(!core.includes('update tigeriq_objectives set manager_cycles=0,updated_at=now() where id=$1'));

  assert.match(intake,/order by updated_at asc, case when status='active' then 0 else 1 end/);
  assert.ok(!core.includes('managerProgressSinceLastCycle({latestTerminalAt:latestManagerProgress,objectiveUpdatedAt:o.updated_at})'));
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
