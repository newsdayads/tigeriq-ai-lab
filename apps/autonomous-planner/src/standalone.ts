import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { actionable, parseBacklog, reconcile, toControllerBody, waitingDependencies, type PlannerRuntimeState } from './core.js';
import { parseAuthorizationStore } from './policy.js';

const workspace=(process.env.TIGERIQ_WORKSPACE??'F:\\TigerIQ\\Workspace\\tigeriq-ai-lab').trim();
const controllerUrl=(process.env.TIGERIQ_CONTROLLER_URL??'http://100.97.23.87:8790').replace(/\/$/,'');
const backlogPath=(process.env.TIGERIQ_AUTONOMY_BACKLOG??'F:\\TigerIQ\\Runtime\\autonomous-planner-v1\\backlog.json').trim();
const statePath=(process.env.TIGERIQ_AUTONOMY_STATE??'F:\\TigerIQ\\Runtime\\autonomous-planner-v1\\planner-state.json').trim();
const authorizationPath=(process.env.TIGERIQ_AUTONOMY_AUTHORIZATIONS??'F:\\TigerIQ\\Runtime\\autonomous-planner-v1\\authorizations.json').trim();
const tokenPath=(process.env.TIGERIQ_INGRESS_TOKEN_FILE??'F:\\TigerIQ\\Secrets\\pc01-primary-node.ingress-token').trim();
const intervalMs=Math.max(15_000,Number(process.env.TIGERIQ_AUTONOMY_INTERVAL_MS??60_000));
const dispatchLimit=Math.max(1,Math.min(4,Number(process.env.TIGERIQ_AUTONOMY_DISPATCH_LIMIT??2)));
let stopped=false;

async function readJson(file:string):Promise<unknown>{const raw=await readFile(file,'utf8');return JSON.parse(raw.replace(/^\uFEFF/,''));}
async function writeJson(file:string,value:unknown):Promise<void>{await mkdir(path.dirname(file),{recursive:true});await writeFile(file,JSON.stringify(value,null,2),'utf8');}
async function token():Promise<string>{const value=(await readFile(tokenPath,'utf8')).trim();if(value.length<32)throw new Error('INGRESS_TOKEN_INVALID');return value;}
async function request(method:string,endpoint:string,body?:Record<string,unknown>):Promise<any>{
  const response=await fetch(`${controllerUrl}${endpoint}`,{method,headers:{Authorization:`Bearer ${await token()}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(`CONTROLLER_${response.status}:${JSON.stringify(payload)}`);return payload;
}
async function loadState():Promise<PlannerRuntimeState>{try{const raw=await readJson(statePath) as PlannerRuntimeState;if(raw?.version===1&&raw.tasks&&typeof raw.tasks==='object')return raw;}catch{}return {version:1,tasks:{}};}

async function syncDispatched(state:PlannerRuntimeState):Promise<void>{
  for(const [taskId,item] of Object.entries(state.tasks)){
    if(item.stage!=='dispatched'||!item.controllerJobId)continue;
    try{const current=await request('GET',`/api/v1/work-orders/${encodeURIComponent(item.controllerJobId)}`);const stage=current?.state?.job?.stage;
      if(stage==='done')state.tasks[taskId]={...item,stage:'done',updatedAt:new Date().toISOString()};
      else if(stage==='failed')state.tasks[taskId]={...item,stage:'failed',updatedAt:new Date().toISOString(),reason:current?.state?.job?.lastFailureCode??'job_failed'};
    }catch(error){console.error(JSON.stringify({event:'AUTONOMY_JOB_SYNC_ERROR',taskId,message:String(error)}));}
  }
}

export async function plannerCycle():Promise<void>{
  const backlog=parseBacklog(await readJson(backlogPath)),authorizations=parseAuthorizationStore(await readJson(authorizationPath));let state=reconcile(backlog,await loadState(),authorizations);await syncDispatched(state);
  const now=new Date().toISOString();for(const id of waitingDependencies(backlog,state))state.tasks[id]={...state.tasks[id],stage:'waiting_dependency',updatedAt:now,reason:'dependency_not_done'};
  const selected=actionable(backlog,state,dispatchLimit);
  for(const task of selected){
    try{const created=await request('POST','/api/v1/work-orders',toControllerBody(task));const jobId=String(created?.workOrder?.jobId??'');if(!jobId)throw new Error('CONTROLLER_JOB_ID_MISSING');state.tasks[task.taskId]={...state.tasks[task.taskId],stage:'dispatched',controllerJobId:jobId,updatedAt:new Date().toISOString()};console.log(JSON.stringify({event:'AUTONOMY_DISPATCH',taskId:task.taskId,jobId,priority:task.priority,route:task.route,policy:state.tasks[task.taskId].policy}));}
    catch(error){state.tasks[task.taskId]={...state.tasks[task.taskId],stage:'failed',updatedAt:new Date().toISOString(),reason:String(error).slice(0,1024)};console.error(JSON.stringify({event:'AUTONOMY_DISPATCH_ERROR',taskId:task.taskId,message:String(error)}));}
  }
  state.lastCycleAt=new Date().toISOString();await writeJson(statePath,state);
  const held=Object.entries(state.tasks).filter(([,v])=>v.stage==='held_authorization').map(([id,v])=>({taskId:id,policy:v.policy}));
  console.log(JSON.stringify({event:'AUTONOMY_CYCLE',workspace,selected:selected.map(t=>t.taskId),heldAuthorization:held,statePath,authorizationPath}));
}

export async function startPlanner():Promise<void>{
  if(path.resolve(workspace).toLowerCase()!==path.resolve('F:\\TigerIQ\\Workspace\\tigeriq-ai-lab').toLowerCase())throw new Error('WORKSPACE_MISMATCH');
  console.log(JSON.stringify({event:'AUTONOMOUS_PLANNER_V1_START',intervalMs,dispatchLimit,backlogPath,statePath,authorizationPath}));
  while(!stopped){try{await plannerCycle();}catch(error){console.error(JSON.stringify({event:'AUTONOMY_CYCLE_FATAL',message:String(error)}));}for(let elapsed=0;elapsed<intervalMs&&!stopped;elapsed+=1000)await new Promise(r=>setTimeout(r,Math.min(1000,intervalMs-elapsed)));}
}
function stop(signal:string){stopped=true;console.log(JSON.stringify({event:'AUTONOMOUS_PLANNER_V1_STOP',signal}));}
process.once('SIGINT',()=>stop('SIGINT'));process.once('SIGTERM',()=>stop('SIGTERM'));
const invokedAsMain=Boolean(process.argv[1])&&import.meta.url===pathToFileURL(process.argv[1]).href;
if(invokedAsMain)startPlanner().catch(error=>{console.error(JSON.stringify({event:'AUTONOMOUS_PLANNER_V1_FATAL',message:error instanceof Error?error.message:String(error)}));process.exit(1);});
