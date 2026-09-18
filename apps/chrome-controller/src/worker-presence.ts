export type WorkerPresence = 'RUNNING' | 'ABSENT' | 'AMBIGUOUS';
export type WorkerProcessProbe = 'PRESENT' | 'ABSENT' | 'UNKNOWN';

export function classifyWorkerPresence(cdpActive:boolean, processProbe:WorkerProcessProbe):WorkerPresence {
  if(cdpActive)return 'RUNNING';
  if(processProbe==='ABSENT')return 'ABSENT';
  return 'AMBIGUOUS';
}
