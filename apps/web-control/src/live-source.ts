import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseBacklog,type PlannerRuntimeState,type RuntimeTaskStage } from '../../autonomous-planner/src/core.js';
import { parseAndValidateRegistries } from '../../ai-gateway/src/registry.js';
import type { WorkTask,TaskStage } from '../../ai-gateway/src/core.js';
import type { ContinuousRuntimeState } from '../../continuous-operations/src/core.js';
import type { MissionRuntimeState } from '../../mission-orchestrator/src/core.js';
import { buildWebControlSnapshot,type WebControlSnapshot,type WorkerView } from './core.js';
import { defaultWebControlSnapshotPath,writeWebControlSnapshot } from './file-source.js';

export interface LiveWebControlPaths {
  continuousState:string;
  plannerBacklog:string;
  plannerState:string;
  missionState:string;
  providers:string;
  models:string;
  employees:string;
  snapshot:string;
}

export function defaultLiveWebControlPaths(workspace=(process.env.TIGERIQ_WORKSPACE??'F:\\TigerIQ\\Workspace\\tigeriq-ai-lab').trim()):LiveWebControlPaths{
  return {
    continuousState:(process.env.TIGERIQ_CONTINUOUS_STATE??'F:\\TigerIQ\\Runtime\\continuous-operations-v1\\state.json').trim(),
    plannerBacklog:(process.env.TIGERIQ_AUTONOMY_BACKLOG??'F:\\TigerIQ\\Runtime\\autonomous-planner-v1\\backlog.json').trim(),
    plannerState:(process.env.TIGERIQ_AUTONOMY_STATE??'F:\\TigerIQ\\Runtime\\autonomous-planner-v1\\planner-state.json').trim(),
    missionState:(process.env.TIGERIQ_MISSION_STATE??'F:\\TigerIQ\\Runtime\\mission-orchestrator-v1\\mission-state.json').trim(),
    providers:(process.env.TIGERIQ_AI_PROVIDERS??path.join(workspace,'config','ai','providers.template.json')).trim(),
    models:(process.env.TIGERIQ_AI_MODELS??path.join(workspace,'config','ai','models.template.json')).trim(),
    employees:(process.env.TIGERIQ_AI_EMPLOYEES??path.join(workspace,'config','ai','employees.template.json')).trim(),
    snapshot:(process.env.TIGERIQ_WEB_CONTROL_SNAPSHOT??defaultWebControlSnapshotPath).trim()
  };
}

async function readJson(file:string):Promise<unknown>{return JSON.parse((await readFile(file,'utf8')).replace(/^\uFEFF/,''));}
function record(value:unknown,name:string):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`INVALID_LIVE_${name.toUpperCase()}`);return value as Record<string,unknown>;}
function timestamp(value:unknown,name:string):string|undefined{if(value===undefined)return undefined;if(typeof value!=='string'||Number.isNaN(Date.parse(value)))throw new Error(`INVALID_LIVE_${name.toUpperCase()}`);return value;}

function parseContinuousState(raw:unknown):ContinuousRuntimeState{
  const root=record(raw,'continuous_state');if(root.version!==1)throw new Error('INVALID_LIVE_CONTINUOUS_VERSION');const goals=record(root.goals,'continuous_goals');
  for(const [goalId,value] of Object.entries(goals)){if(!goalId.trim())throw new Error('INVALID_LIVE_GOAL_ID');const row=record(value,'continuous_goal');if(typeof row.stage!=='string'||typeof row.missionId!=='string'||!row.missionId.trim())throw new Error('INVALID_LIVE_GOAL_ROW');timestamp(row.updatedAt,'goal_updated_at');}
  timestamp(root.lastCycleAt,'continuous_last_cycle');
  return raw as ContinuousRuntimeState;
}
function parsePlannerState(raw:unknown):PlannerRuntimeState{
  const root=record(raw,'planner_state');if(root.version!==1)throw new Error('INVALID_LIVE_PLANNER_VERSION');const tasks=record(root.tasks,'planner_tasks');
  for(const value of Object.values(tasks)){const row=record(value,'planner_task');if(typeof row.stage!=='string'||!['ready','held_authorization','waiting_dependency','dispatched','done','failed'].includes(row.stage))throw new Error('INVALID_LIVE_PLANNER_STAGE');timestamp(row.updatedAt,'planner_updated_at');}
  timestamp(root.lastCycleAt,'planner_last_cycle');
  return raw as PlannerRuntimeState;
}
function parseMissionState(raw:unknown):MissionRuntimeState{
  const root=record(raw,'mission_state');if(root.version!==1)throw new Error('INVALID_LIVE_MISSION_VERSION');const missions=record(root.missions,'missions');
  for(const value of Object.values(missions)){const row=record(value,'mission');if(typeof row.stage!=='string'||!Array.isArray(row.childTaskIds))throw new Error('INVALID_LIVE_MISSION_ROW');timestamp(row.updatedAt,'mission_updated_at');}
  timestamp(root.lastCycleAt,'mission_last_cycle');
  return raw as MissionRuntimeState;
}

const plannerStage:Record<RuntimeTaskStage,TaskStage>={ready:'queued',held_authorization:'authorization',waiting_dependency:'waiting_dependency',dispatched:'running',done:'done',failed:'failed'};
function goalForTask(taskId:string,continuous:ContinuousRuntimeState):string{
  const match=Object.entries(continuous.goals).filter(([,row])=>taskId===row.missionId||taskId.startsWith(`${row.missionId}-`)).sort((a,b)=>b[1].missionId.length-a[1].missionId.length)[0];
  return match?.[0]??'unscoped';
}
function tasksFromRuntime(continuous:ContinuousRuntimeState,backlog:ReturnType<typeof parseBacklog>,planner:PlannerRuntimeState):WorkTask[]{
  return backlog.tasks.map(task=>{
    const runtime=planner.tasks[task.taskId];
    const stage:TaskStage=runtime?plannerStage[runtime.stage]:(task.status==='done'?'done':task.status==='blocked'?'blocked':'queued');
    return {taskId:task.taskId,goalId:goalForTask(task.taskId,continuous),stage,dependencies:[...task.dependencies],requiredCapabilities:task.requiredCapabilities.filter((value):value is WorkTask['requiredCapabilities'][number]=>['reasoning','coding','research','vision','review','judge','fast','long-context'].includes(value)),priority:task.priority,attempts:runtime?.controllerJobId?1:0};
  });
}
function recent(lastSeenAt:string|undefined,nowMs:number,maxAgeMs:number):boolean{return Boolean(lastSeenAt)&&nowMs-Date.parse(lastSeenAt as string)<=maxAgeMs;}
function runtimeWorkers(continuous:ContinuousRuntimeState,planner:PlannerRuntimeState,mission:MissionRuntimeState,nowMs:number,maxAgeMs:number):WorkerView[]{
  const runningGoal=Object.entries(continuous.goals).find(([,row])=>row.stage==='injected'||row.stage==='running');
  const runningTask=Object.entries(planner.tasks).find(([,row])=>row.stage==='dispatched');
  const heldTask=Object.entries(planner.tasks).find(([,row])=>row.stage==='held_authorization'||row.stage==='waiting_dependency');
  const runningMission=Object.entries(mission.missions).find(([,row])=>row.stage==='planning'||row.stage==='running');
  const continuousSeen=continuous.lastCycleAt;
  const plannerSeen=planner.lastCycleAt;
  const missionSeen=mission.lastCycleAt;
  return [
    {workerId:'runtime.continuous-operations',status:recent(continuousSeen,nowMs,maxAgeMs)?(runningGoal?'busy':'online'):'offline',currentTaskId:runningGoal?.[0],lastSeenAt:continuousSeen},
    {workerId:'runtime.autonomous-planner',status:recent(plannerSeen,nowMs,maxAgeMs)?(runningTask?'busy':heldTask?'waiting':'online'):'offline',currentTaskId:runningTask?.[0]??heldTask?.[0],lastSeenAt:plannerSeen},
    {workerId:'runtime.mission-orchestrator',status:recent(missionSeen,nowMs,maxAgeMs)?(runningMission?'busy':'online'):'offline',currentTaskId:runningMission?.[0],lastSeenAt:missionSeen,modelId:runningMission?.[1].model}
  ];
}

export async function buildLiveWebControlSnapshot(paths:LiveWebControlPaths=defaultLiveWebControlPaths(),now=new Date(),freshnessMs=60_000):Promise<WebControlSnapshot>{
  if(freshnessMs<5_000||freshnessMs>10*60_000)throw new Error('INVALID_LIVE_FRESHNESS');
  const [continuousRaw,backlogRaw,plannerRaw,missionRaw,providersRaw,modelsRaw,employeesRaw]=await Promise.all([readJson(paths.continuousState),readJson(paths.plannerBacklog),readJson(paths.plannerState),readJson(paths.missionState),readJson(paths.providers),readJson(paths.models),readJson(paths.employees)]);
  const continuous=parseContinuousState(continuousRaw),backlog=parseBacklog(backlogRaw),planner=parsePlannerState(plannerRaw),mission=parseMissionState(missionRaw);
  const registries=parseAndValidateRegistries({providers:providersRaw,models:modelsRaw,employees:employeesRaw});
  return buildWebControlSnapshot({continuous,tasks:tasksFromRuntime(continuous,backlog,planner),workers:runtimeWorkers(continuous,planner,mission,now.getTime(),freshnessMs),providers:registries.providers,employees:registries.employees,evidence:[],now:now.toISOString()});
}

export async function refreshLiveWebControlSnapshot(paths:LiveWebControlPaths=defaultLiveWebControlPaths(),now=new Date(),freshnessMs=60_000):Promise<WebControlSnapshot>{
  const snapshot=await buildLiveWebControlSnapshot(paths,now,freshnessMs);await writeWebControlSnapshot(snapshot,paths.snapshot);return snapshot;
}
