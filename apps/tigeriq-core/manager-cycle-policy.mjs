export const MANAGER_STALL_CYCLE_LIMIT=30;

function timestampMs(value){
  const parsed=value?Date.parse(String(value)):NaN;
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
