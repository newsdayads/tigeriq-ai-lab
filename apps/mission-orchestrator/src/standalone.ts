import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseBacklog, type PlannerRuntimeState } from '../../autonomous-planner/src/core.js';
import { acceptancePlan, decompositionPrompt, deriveMissionStage, mergePlan, parseAiPlan, parseMissionInbox, type MissionPlan, type MissionRuntimeState } from './core.js';

const runtimeDir=(process.env.TIGERIQ_MISSION_RUNTIME??'F:\\TigerIQ\\Runtime\\mission-orchestrator-v1').trim();
const inboxPath=(process.env.TIGERIQ_MISSION_INBOX??path.join(runtimeDir,'mission-inbox.json')).trim();
const statePath=(process.env.TIGERIQ_MISSION_STATE??path.join(runtimeDir,'mission-state.json')).trim();
const backlogPath=(process.env.TIGERIQ_AUTONOMY_BACKLOG??'F:\\TigerIQ\\Runtime\\autonomous-planner-v1\\backlog.json').trim();
const plannerStatePath=(process.env.TIGERIQ_AUTONOMY_STATE??'F:\\TigerIQ\\Runtime\\autonomous-planner-v1\\planner-state.json').trim();
const ollamaUrl=(process.env.TIGERIQ_OLLAMA_URL??'http://127.0.0.1:11434').replace(/\/$/,'');
const model=(process.env.TIGERIQ_MISSION_MODEL??'qwen3:8b').trim();
const intervalMs=Math.max(15_000,Number(process.env.TIGERIQ_MISSION_INTERVAL_MS??30_000));
let stopped=false;

async function readJson(file:string):Promise<unknown>{const raw=await readFile(file,'utf8');return JSON.parse(raw.replace(/^\uFEFF/,''));}
async function atomicJson(file:string,value:unknown):Promise<void>{await mkdir(path.dirname(file),{recursive:true});const tmp=`${file}.${process.pid}.tmp`;await writeFile(tmp,JSON.stringify(value,null,2),'utf8');await rename(tmp,file);}
async function loadMissionState():Promise<MissionRuntimeState>{try{const raw=await readJson(statePath) as MissionRuntimeState;if(raw?.version===1&&raw.missions&&typeof raw.missions==='object')return raw;}catch{}return {version:1,missions:{}};}
async function loadPlannerState():Promise<PlannerRuntimeState>{try{const raw=await readJson(plannerStatePath) as PlannerRuntimeState;if(raw?.version===1&&raw.tasks)return raw;}catch{}return {version:1,tasks:{}};}
async function ensureFiles():Promise<void>{await mkdir(runtimeDir,{recursive:true});try{await readFile(inboxPath);}catch{await atomicJson(inboxPath,{version:1,missions:[]});}try{await readFile(backlogPath);}catch{await atomicJson(backlogPath,{version:1,tasks:[]});}}
async function ollamaPlan(prompt:string):Promise<unknown>{const response=await fetch(`${ollamaUrl}/api/generate`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model,prompt,stream:false,think:false,format:'json',options:{num_ctx:4096,temperature:0.1}})});if(!response.ok)throw new Error(`OLLAMA_${response.status}`);const body=await response.json() as any;const text=String(body?.response??'').trim();if(!text)throw new Error('OLLAMA_EMPTY_PLAN');return JSON.parse(text);}

export async function missionCycle():Promise<void>{
  await ensureFiles();const inbox=parseMissionInbox(await readJson(inboxPath));let state=await loadMissionState();let backlog=parseBacklog(await readJson(backlogPath));const planner=await loadPlannerState();const now=new Date().toISOString();
  for(const mission of inbox.missions){
    if(!mission.enabled||mission.status!=='pending')continue;
    const current=state.missions[mission.missionId];let plan:MissionPlan|undefined;
    if(current?.childTaskIds?.length){const childSet=new Set(current.childTaskIds);const tasks=backlog.tasks.filter(t=>childSet.has(t.taskId));if(tasks.length===current.childTaskIds.length)plan={missionId:mission.missionId,summary:current.summary??mission.goal,model:current.model,tasks};}
    if(!plan){
      state.missions[mission.missionId]={stage:'planning',updatedAt:now,childTaskIds:[]};await atomicJson(statePath,state);
      try{plan=mission.mode==='acceptance'?acceptancePlan(mission):parseAiPlan(mission,await ollamaPlan(decompositionPrompt(mission)),model);backlog=mergePlan(backlog,plan);await atomicJson(backlogPath,backlog);state.missions[mission.missionId]={stage:'running',updatedAt:new Date().toISOString(),childTaskIds:plan.tasks.map(t=>t.taskId),summary:plan.summary,model:plan.model};console.log(JSON.stringify({event:'MISSION_DECOMPOSED',missionId:mission.missionId,mode:mission.mode,children:plan.tasks.map(t=>t.taskId),model:plan.model}));}
      catch(error){state.missions[mission.missionId]={stage:'blocked_plan',updatedAt:new Date().toISOString(),childTaskIds:[],reason:String(error).slice(0,1024),model};console.error(JSON.stringify({event:'MISSION_PLAN_BLOCKED',missionId:mission.missionId,message:String(error)}));continue;}
    }
    const stage=deriveMissionStage(plan,planner);const prior=state.missions[mission.missionId];state.missions[mission.missionId]={...prior,stage,updatedAt:new Date().toISOString(),childTaskIds:plan.tasks.map(t=>t.taskId),summary:plan.summary,model:plan.model};
  }
  state.lastCycleAt=new Date().toISOString();await atomicJson(statePath,state);console.log(JSON.stringify({event:'MISSION_CYCLE',missions:Object.fromEntries(Object.entries(state.missions).map(([id,v])=>[id,v.stage]))}));
}

export async function startMissionOrchestrator():Promise<void>{await ensureFiles();console.log(JSON.stringify({event:'MISSION_ORCHESTRATOR_V1_START',intervalMs,inboxPath,statePath,model}));while(!stopped){try{await missionCycle();}catch(error){console.error(JSON.stringify({event:'MISSION_CYCLE_FATAL',message:String(error)}));}for(let elapsed=0;elapsed<intervalMs&&!stopped;elapsed+=1000)await new Promise(r=>setTimeout(r,Math.min(1000,intervalMs-elapsed)));}}
function stop(signal:string){stopped=true;console.log(JSON.stringify({event:'MISSION_ORCHESTRATOR_V1_STOP',signal}));}
process.once('SIGINT',()=>stop('SIGINT'));process.once('SIGTERM',()=>stop('SIGTERM'));
const invokedAsMain=Boolean(process.argv[1])&&import.meta.url===pathToFileURL(process.argv[1]).href;if(invokedAsMain)startMissionOrchestrator().catch(error=>{console.error(JSON.stringify({event:'MISSION_ORCHESTRATOR_V1_FATAL',message:error instanceof Error?error.message:String(error)}));process.exit(1);});
