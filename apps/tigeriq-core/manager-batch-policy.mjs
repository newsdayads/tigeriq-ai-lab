export const MANAGER_PENDING_JOB_STATUSES=Object.freeze([
  'queued',
  'waiting_resource',
  'dispatching',
  'running',
  'ui_assigned',
  'ui_running',
]);

export function managerHasPendingBatch(jobs=[]){
  return (Array.isArray(jobs)?jobs:[]).some(job=>MANAGER_PENDING_JOB_STATUSES.includes(String(job?.status||'')));
}

export function managerMayDecideNext(jobs=[]){
  return !managerHasPendingBatch(jobs);
}
