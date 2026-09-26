import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { WORKER_IDS, type WorkerId } from './model.js';

export interface WorkerSafetySnapshot {
  pausedWorkers:WorkerId[];
  manualCloseSuppressedWorkers:WorkerId[];
  modelProfile?: { model: string; profile: string; restoredAt: string };
}
export interface WorkerSafetyRestoreResult {
  state:WorkerSafetySnapshot;
  failClosed:boolean;
  error?:unknown;
}
export interface WorkerSafetyPersistResult extends WorkerSafetyRestoreResult {}

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
  let modelProfile: { model: string; profile: string; restoredAt: string } | undefined;
  if (value.modelProfile && typeof value.modelProfile === 'object') {
    const m = String(value.modelProfile.model ?? '');
    const p = String(value.modelProfile.profile ?? '');
    const r = String(value.modelProfile.restoredAt ?? '');
    if (m && p) modelProfile = { model: m, profile: p, restoredAt: r || new Date().toISOString() };
  }
  return{
    pausedWorkers:normalizeList(value.pausedWorkers),
    manualCloseSuppressedWorkers:normalizeList(value.manualCloseSuppressedWorkers),
    ...(modelProfile ? { modelProfile } : {}),
  };
}

export function failClosedWorkerSafetyState():WorkerSafetySnapshot {
  return{
    pausedWorkers:[...WORKER_IDS],
    manualCloseSuppressedWorkers:[...WORKER_IDS],
    modelProfile: { model: 'GPT-5.6 Sol', profile: 'High', restoredAt: new Date().toISOString() },
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

export function restoreWorkerSafetyState(
  path:string,
  reader:(path:string)=>WorkerSafetySnapshot=readWorkerSafetyState,
):WorkerSafetyRestoreResult {
  try{return{state:reader(path),failClosed:false};}
  catch(error){return{state:failClosedWorkerSafetyState(),failClosed:true,error};}
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

export function persistWorkerSafetyStateOrFailClosed(
  path:string,
  state:WorkerSafetySnapshot,
  writer:(path:string,state:WorkerSafetySnapshot)=>void=writeWorkerSafetyState,
):WorkerSafetyPersistResult {
  try{
    writer(path,state);
    return{state:{pausedWorkers:[...state.pausedWorkers],manualCloseSuppressedWorkers:[...state.manualCloseSuppressedWorkers]},failClosed:false};
  }catch(error){
    return{state:failClosedWorkerSafetyState(),failClosed:true,error};
  }
}

export function probeWorkerSafetyHealth(path:string): { healthy: boolean; error?: unknown; restartCount?: number } {
  try {
    const snapshot = readWorkerSafetyState(path);
    const healthy = Boolean(snapshot && Array.isArray(snapshot.pausedWorkers));
    return { healthy, restartCount: 0 };
  } catch (error) {
    return { healthy: false, error };
  }
}

export function workerStartGate(workerId:WorkerId,input:{globalPaused:boolean;utilityPaused:boolean;manualCloseSuppressed:boolean}):string|null {
  if(input.globalPaused)return 'OWNER_INTERACTION_READ_ONLY';
  if(input.utilityPaused)return `UTILITY_WORKER_PAUSED:${workerId}`;
  if(input.manualCloseSuppressed)return `MANUAL_CLOSE_SUPPRESSED:${workerId}`;
  return null;
}
