import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { WORKER_IDS, type WorkerId } from './model.js';

export interface WorkerSafetySnapshot {
  pausedWorkers:WorkerId[];
  manualCloseSuppressedWorkers:WorkerId[];
}

interface WorkerSafetyFile extends WorkerSafetySnapshot {
  schemaVersion:'tigeriq.chrome-controller.worker-safety.v1';
  updatedAt:string;
}

function normalizeList(value:unknown):WorkerId[]{
  if(!Array.isArray(value))throw new Error('WORKER_SAFETY_LIST_INVALID');
  const result:WorkerId[]=[];
  for(const item of value){
    if(typeof item!=='string'||!WORKER_IDS.includes(item as WorkerId))throw new Error('WORKER_SAFETY_WORKER_INVALID');
    if(!result.includes(item as WorkerId))result.push(item as WorkerId);
  }
  return result;
}

function parseSafety(text:string):WorkerSafetySnapshot{
  const value=JSON.parse(text) as Partial<WorkerSafetyFile>;
  if(value.schemaVersion!=='tigeriq.chrome-controller.worker-safety.v1')throw new Error('WORKER_SAFETY_SCHEMA_INVALID');
  return{
    pausedWorkers:normalizeList(value.pausedWorkers),
    manualCloseSuppressedWorkers:normalizeList(value.manualCloseSuppressedWorkers),
  };
}

export function readWorkerSafetyState(path:string):WorkerSafetySnapshot {
  const candidates=[path,`${path}.bak`];
  let sawFile=false;
  for(const candidate of candidates){
    if(!existsSync(candidate))continue;
    sawFile=true;
    try{return parseSafety(readFileSync(candidate,'utf8'));}
    catch{}
  }
  if(sawFile)throw new Error('WORKER_SAFETY_STATE_CORRUPT');
  return{pausedWorkers:[],manualCloseSuppressedWorkers:[]};
}

export function writeWorkerSafetyState(path:string,state:WorkerSafetySnapshot,now=new Date()):void {
  const temp=`${path}.tmp`;
  const backup=`${path}.bak`;
  const value:WorkerSafetyFile={
    schemaVersion:'tigeriq.chrome-controller.worker-safety.v1',
    pausedWorkers:[...new Set(state.pausedWorkers)],
    manualCloseSuppressedWorkers:[...new Set(state.manualCloseSuppressedWorkers)],
    updatedAt:now.toISOString(),
  };
  writeFileSync(temp,`${JSON.stringify(value,null,2)}\n`,'utf8');
  let movedCurrent=false;
  try{
    if(existsSync(path)){
      rmSync(backup,{force:true});
      renameSync(path,backup);
      movedCurrent=true;
    }
    renameSync(temp,path);
    rmSync(backup,{force:true});
  }catch(error){
    rmSync(temp,{force:true});
    if(movedCurrent&&!existsSync(path)&&existsSync(backup)){
      try{renameSync(backup,path);}catch{}
    }
    throw error;
  }
}

export function workerStartGate(workerId:WorkerId,input:{globalPaused:boolean;utilityPaused:boolean;manualCloseSuppressed:boolean}):string|null {
  if(input.globalPaused)return 'OWNER_INTERACTION_READ_ONLY';
  if(input.utilityPaused)return `UTILITY_WORKER_PAUSED:${workerId}`;
  if(input.manualCloseSuppressed)return `MANUAL_CLOSE_SUPPRESSED:${workerId}`;
  return null;
}
