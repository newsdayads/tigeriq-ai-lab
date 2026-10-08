// TigerIQ BCCT: pure, read-only prioritization. Never dispatch from UI sorting.
export const PRIORITY_STATES = Object.freeze({ READY:'READY', WAIT:'WAIT', OWNER:'OWNER', IN_PROGRESS:'IN_PROGRESS' });
const rank = value => { const m=/^P([0-5])$/.exec(String(value??'').toUpperCase()); return m?Number(m[1]):9; };
const state = row => String(row?.status??row?.currentState??'UNKNOWN').toUpperCase();
export function classifyWork(row, sourceFresh=false) {
  const priority=rank(row?.effectivePriority??row?.priority);
  const status=state(row);
  if(priority===0 || row?.ownerHold===true || row?.ownerGate===true || status==='OWNER_GATE')return PRIORITY_STATES.OWNER;
  if(status==='WORKING'||status==='REVIEW'||status==='VERIFY')return PRIORITY_STATES.IN_PROGRESS;
  const blocked = row?.blocked===true || ['BLOCKED','WAITING','UNKNOWN','DONE','SYSTEM','GOAL'].includes(status);
  const eligible=sourceFresh && priority>=1 && priority<=5 && !blocked && ['QUEUED','READY'].includes(status) && row?.workKind==='WORK' && row?.tigeriqExecutable===true && row?.autoQueueIncluded===true && !row?.mutationOwnerActive && !row?.dependencyBlocked && !row?.realGate && !row?.stale;
  return eligible?PRIORITY_STATES.READY:PRIORITY_STATES.WAIT;
}
export function sortWork(rows,{mode='actionable',sourceFresh=false}={}) {
  const order={READY:0,IN_PROGRESS:1,OWNER:2,WAIT:3};
  return [...rows].sort((a,b) => {
    const ca=classifyWork(a,sourceFresh),cb=classifyWork(b,sourceFresh);
    if(mode==='actionable' && order[ca]!==order[cb])return order[ca]-order[cb];
    if(mode==='priority' || mode==='actionable')return rank(a?.effectivePriority??a?.priority)-rank(b?.effectivePriority??b?.priority) || Number(a?.number??0)-Number(b?.number??0);
    return 0;
  });
}
export function canRequestExecution(row,{sourceFresh=false}={}) {
  return classifyWork(row,sourceFresh)===PRIORITY_STATES.READY;
}
// A request is NOT a dispatch receipt. Only Core with verified lease/idempotency
// can move work to RUNNING. Do not use this file for permission authorization.
