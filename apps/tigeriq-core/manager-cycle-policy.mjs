export const MANAGER_STALL_CYCLE_LIMIT=30;

function timestampMs(value){
  // PostgreSQL timestamp fields arrive as Date objects; String(Date) drops
  // fractional seconds, hiding distinct DONE jobs within the same second.
  const parsed=value instanceof Date?value.getTime():value?Date.parse(String(value)):NaN;
  return Number.isFinite(parsed)?parsed:NaN;
}

export function managerProgressSinceLastCycle({latestTerminalAt,objectiveUpdatedAt}={}){
  const progressMs=timestampMs(latestTerminalAt);
  if(!Number.isFinite(progressMs))return false;
  const boundaryMs=timestampMs(objectiveUpdatedAt);
  return !Number.isFinite(boundaryMs)||progressMs>boundaryMs;
}

export function managerCycleGuard({managerCycles=0,progressed=false,maxCycles=MANAGER_STALL_CYCLE_LIMIT}={}){
  const currentCycles=Math.max(0,Math.trunc(Number(managerCycles)||0));
  const boundedMaxCycles=Math.max(1,Math.trunc(Number(maxCycles)||MANAGER_STALL_CYCLE_LIMIT));
  const didProgress=progressed===true;
  const effectiveCycles=didProgress?0:currentCycles;
  return {
    currentCycles,
    effectiveCycles,
    maxCycles:boundedMaxCycles,
    progressed:didProgress,
    reset:didProgress&&currentCycles>0,
    blocked:effectiveCycles>=boundedMaxCycles,
  };
}

/**
 * Observe terminal-job progress using its own durable watermark, not objective
 * updated_at: GitHub reconciliation legitimately refreshes that timestamp on
 * every scan, even when a manager's just-finished job is the only real progress.
 * For pre-watermark active objectives with a nonzero retry budget, grant exactly
 * one migration reset when a completed job exists, then persist the watermark.
 */
export function managerTerminalProgressPlan({latestTerminalAt,observedTerminalAt,managerCycles=0}={}){
  const latest=timestampMs(latestTerminalAt);
  const observed=timestampMs(observedTerminalAt);
  if(!Number.isFinite(latest))return {progressed:false,checkpoint:false,observedAt:null};
  const newCompletion=Number.isFinite(observed)&&latest>observed;
  const firstObservation=!Number.isFinite(observed);
  return {
    progressed:newCompletion||(firstObservation&&Number(managerCycles)>0),
    checkpoint:firstObservation||newCompletion,
    observedAt:new Date(latest).toISOString(),
  };
}

/**
 * GitHub acceptance/review gates are evidence-driven, not model-driven.
 * Park the manager only where GitHub intake can watch for accepted evidence
 * or a new source revision. Other objectives keep a bounded retry budget.
 */
export function managerAcceptancePausePlan({source='',sourceRevision='',gate={}}={}){
  const revision=String(sourceRevision||'').trim();
  const reason=String(gate?.reason||'');
  const park=source==='github'&&Boolean(revision)&&gate?.allow===false
    &&['live_acceptance_pending','final_review_pending','dependency_pending'].includes(reason);
  return {park,revision:park?revision:null,reason};
}

/** Reconcile any parked GitHub objective when its source revision changes,
 * including a source edit that removes the last declared dependency gate.
 * Blocked objectives remain fenced and cannot be rearmed by this watcher.
 */
export function managerAcceptanceRevisionRefresh({sourceLiveRequired=false,sourceFinalReviewRequired=false,dependencyGateRequired=false,awaitingRevision='',revisionChanged=false,status='active'}={}){
  const parked=Boolean(String(awaitingRevision||'').trim());
  return Boolean(revisionChanged&&status!=='blocked'&&(sourceLiveRequired||sourceFinalReviewRequired||dependencyGateRequired||parked));
}

export function managerAcceptanceWakePlan({awaitingRevision='',sourceRevision='',acceptanceAllowed=false}={}){
  const pending=String(awaitingRevision||'').trim();
  const current=String(sourceRevision||'').trim();
  const gateSatisfied=acceptanceAllowed===true&&Boolean(current);
  const revisionChanged=Boolean(pending&&current&&current!==pending);
  return {
    wake:Boolean(pending&&current&&(gateSatisfied||revisionChanged)),
    reason:gateSatisfied?'acceptance_satisfied':revisionChanged?'source_revision_changed':'awaiting_evidence',
  };
}
