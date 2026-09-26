export type WorkerPresence = 'RUNNING' | 'ABSENT' | 'AMBIGUOUS';
export type WorkerProcessProbe = 'PRESENT' | 'ABSENT' | 'UNKNOWN';

export function processProbeFromCount(count:number|undefined, recordedPidAlive:boolean|undefined):WorkerProcessProbe {
  if(Number.isInteger(count))return Number(count)>0?'PRESENT':'ABSENT';
  return recordedPidAlive===true?'PRESENT':'UNKNOWN';
}

export function classifyWorkerPresence(cdpActive:boolean, processProbe:WorkerProcessProbe):WorkerPresence {
  if(cdpActive)return 'RUNNING';
  if(processProbe==='ABSENT')return 'ABSENT';
  return 'AMBIGUOUS';
}
