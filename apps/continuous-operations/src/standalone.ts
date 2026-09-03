import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseMissionInbox, type MissionRuntimeState } from '../../mission-orchestrator/src/core.js';
import { goalToMission, parseContinuousControl, parseContinuousGoalQueue, reconcileContinuousState, reconcileMissionInbox, selectNextGoal, upsertMission, type ContinuousRuntimeState } from './core.js';

const runtimeDir=(process.env.TIGERIQ_CONTINUOUS_RUNTIME??'F:\\TigerIQ\\Runtime\\continuous-operations-v1').trim();
const goalsPath=(process.env.TIGERIQ_CONTINUOUS_GOALS??path.join(runtimeDir,'goals.json')).trim();
const controlPath=(process.env.TIGERIQ_CONTINUOUS_CONTROL??path.join(runtimeDir,'control.json')).trim();
const statePath=(process.env.TIGERIQ_CONTINUOUS_STATE??path.join(runtimeDir,'state.json')).trim();
const missionInboxPath=(process.env.TIGERIQ_MISSION_INBOX??'F:\\TigerIQ\\Runtime\\mission-orchestrator-v1\\mission-inbox.json').trim();
const missionStatePath=(process.env.TIGERIQ_MISSION_STATE??'F:\\TigerIQ\\Runtime\\mission-orchestrator-v1\\mission-state.json').trim();
const intervalMs=Math.max(2_000,Number(process.env.TIGERIQ_CONTINUOUS_INTERVAL_MS??5_000));
let stopped=false;

async function readJson(file:string):Promise<unknown>{const raw=await readFile(file,'utf8');return JSON.parse(raw.replace(/^\uFEFF/,''));}
async function atomicJson(file:string,value:unknown):Promise<void>{await mkdir(path.dirname(file),{recursive:true});const tmp=`${file}.${process.pid}.tmp`;await writeFile(tmp,JSON.stringify(value,null,2),'utf8');await rename(tmp,file);}
async function ensureFiles():Promise<void>{
  await mkdir(runtimeDir,{recursive:true});
  try{await readFile(goalsPath);}catch{await atomicJson(goalsPath,{version:1,goals:[]});}
  try{await readFile(controlPath);}catch{await atomicJson(controlPath,{version:1,paused:false});}
  try{await readFile(statePath);}catch{await atomicJson(statePath,{version:1,goals:{},paused:false});}
}
async function loadMissionState():Promise<MissionRuntimeState>{try{const raw=await readJson(missionStatePath) as MissionRuntimeState;if(raw?.version===1&&raw.missions&&typeof raw.missions==='object')return raw;}catch{}return {version:1,missions:{}};}
async function loadState():Promise<ContinuousRuntimeState>{try{const raw=await readJson(statePath) as ContinuousRuntimeState;if(raw?.version===1&&raw.goals&&typeof raw.goals==='object')return raw;}catch{}return {version:1,goals:{}};}

export async function continuousCycle():Promise<void>{
  await ensureFiles();
  const queue=parseContinuousGoalQueue(await readJson(goalsPath));
  const control=parseContinuousControl(await readJson(controlPath));
  const missionState=await loadMissionState();
  let inbox=reconcileMissionInbox(parseMissionInbox(await readJson(missionInboxPath)),missionState);
  let state=reconcileContinuousState(queue,await loadState(),missionState);
  state.paused=control.paused;
  const selected=control.paused?undefined:selectNextGoal(queue,state);
  if(selected){
    const mission=goalToMission(selected);
    inbox=upsertMission(inbox,mission);
    state.goals[selected.goalId]={stage:'injected',updatedAt:new Date().toISOString(),missionId:mission.missionId};
    console.log(JSON.stringify({event:'CONTINUOUS_GOAL_INJECTED',goalId:selected.goalId,missionId:mission.missionId,priority:selected.priority}));
  }
  state.lastCycleAt=new Date().toISOString();
  await atomicJson(missionInboxPath,inbox);
  await atomicJson(statePath,state);
  console.log(JSON.stringify({event:'CONTINUOUS_OPS_CYCLE',paused:control.paused,selected:selected?.goalId??null,goals:Object.fromEntries(Object.entries(state.goals).map(([id,value])=>[id,value.stage]))}));
}

export async function startContinuousOperations():Promise<void>{
  await ensureFiles();
  console.log(JSON.stringify({event:'CONTINUOUS_OPERATIONS_V1_START',intervalMs,goalsPath,controlPath,statePath,missionInboxPath,missionStatePath}));
  while(!stopped){
    try{await continuousCycle();}catch(error){console.error(JSON.stringify({event:'CONTINUOUS_OPS_CYCLE_FATAL',message:error instanceof Error?error.message:String(error)}));}
    for(let elapsed=0;elapsed<intervalMs&&!stopped;elapsed+=1000)await new Promise(resolve=>setTimeout(resolve,Math.min(1000,intervalMs-elapsed)));
  }
}
function stop(signal:string){stopped=true;console.log(JSON.stringify({event:'CONTINUOUS_OPERATIONS_V1_STOP',signal}));}
process.once('SIGINT',()=>stop('SIGINT'));process.once('SIGTERM',()=>stop('SIGTERM'));
const invokedAsMain=Boolean(process.argv[1])&&import.meta.url===pathToFileURL(process.argv[1]).href;
if(invokedAsMain)startContinuousOperations().catch(error=>{console.error(JSON.stringify({event:'CONTINUOUS_OPERATIONS_V1_FATAL',message:error instanceof Error?error.message:String(error)}));process.exit(1);});
