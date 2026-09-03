import { mkdir,readFile,rename,writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { WebControlSnapshot } from './core.js';

export const defaultWebControlSnapshotPath='F:\\TigerIQ\\Runtime\\web-control-v1\\snapshot.json';

function record(value:unknown,name:string):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`INVALID_WEB_CONTROL_${name.toUpperCase()}`);return value as Record<string,unknown>;}
function integer(value:unknown,name:string):number{if(typeof value!=='number'||!Number.isInteger(value)||value<0)throw new Error(`INVALID_WEB_CONTROL_${name.toUpperCase()}`);return value;}
function text(value:unknown,name:string,max=256):string{if(typeof value!=='string'||!value.trim()||value.length>max)throw new Error(`INVALID_WEB_CONTROL_${name.toUpperCase()}`);return value;}
function optionalText(value:unknown,name:string,max=256):string|undefined{if(value===undefined)return undefined;return text(value,name,max);}
function bool(value:unknown,name:string):boolean{if(typeof value!=='boolean')throw new Error(`INVALID_WEB_CONTROL_${name.toUpperCase()}`);return value;}

export function parseWebControlSnapshot(raw:unknown):WebControlSnapshot{
  const root=record(raw,'snapshot');
  if(root.version!==1)throw new Error('INVALID_WEB_CONTROL_VERSION');
  const generatedAt=text(root.generatedAt,'generated_at');
  if(Number.isNaN(Date.parse(generatedAt)))throw new Error('INVALID_WEB_CONTROL_GENERATED_AT');
  const goals=record(root.goals,'goals');
  const tasks=record(root.tasks,'tasks');
  const workers=record(root.workers,'workers');
  const authorization=record(root.authorization,'authorization');
  const evidence=record(root.evidence,'evidence');
  if(!Array.isArray(root.goalRows)||!Array.isArray(root.taskRows)||!Array.isArray(root.workerRows)||!Array.isArray(root.providers)||!Array.isArray(root.employees))throw new Error('INVALID_WEB_CONTROL_ROWS');
  if(!Array.isArray(authorization.goalIds)||!Array.isArray(authorization.taskIds))throw new Error('INVALID_WEB_CONTROL_AUTHORIZATION');

  const goalRows=root.goalRows.slice(0,256).map((value,index)=>{const row=record(value,`goal_${index}`);return {goalId:text(row.goalId,'goal_id'),stage:text(row.stage,'goal_stage'),missionId:text(row.missionId,'mission_id'),reason:optionalText(row.reason,'goal_reason',1000)};});
  const taskRows=root.taskRows.slice(0,2048).map((value,index)=>{const row=record(value,`task_${index}`);if(!Array.isArray(row.dependencies))throw new Error('INVALID_WEB_CONTROL_TASK_DEPENDENCIES');return {taskId:text(row.taskId,'task_id'),goalId:text(row.goalId,'task_goal_id'),stage:text(row.stage,'task_stage'),priority:text(row.priority,'task_priority',8),dependencies:row.dependencies.slice(0,64).map((dependency,i)=>text(dependency,`task_dependency_${i}`)),modelId:optionalText(row.modelId,'task_model_id'),attempts:integer(row.attempts,'task_attempts')};});
  const workerRows=root.workerRows.slice(0,1024).map((value,index)=>{const row=record(value,`worker_${index}`);const status=text(row.status,'worker_status') as 'online'|'busy'|'waiting'|'offline'|'failed';if(!['online','busy','waiting','offline','failed'].includes(status))throw new Error('INVALID_WEB_CONTROL_WORKER_STATUS');return {workerId:text(row.workerId,'worker_id'),employeeId:optionalText(row.employeeId,'employee_id'),modelId:optionalText(row.modelId,'worker_model_id'),providerId:optionalText(row.providerId,'worker_provider_id'),status,currentTaskId:optionalText(row.currentTaskId,'worker_task_id'),lastSeenAt:optionalText(row.lastSeenAt,'worker_last_seen')};});
  const providers=root.providers.slice(0,128).map((value,index)=>{const row=record(value,`provider_${index}`);const remainingQuota=row.remainingQuota===undefined?undefined:integer(row.remainingQuota,'provider_quota');const latencyMs=row.latencyMs===undefined?undefined:integer(row.latencyMs,'provider_latency');return {providerId:text(row.providerId,'provider_id'),enabled:bool(row.enabled,'provider_enabled'),healthy:bool(row.healthy,'provider_healthy'),kind:text(row.kind,'provider_kind'),costClass:text(row.costClass,'provider_cost_class'),maxConcurrency:integer(row.maxConcurrency,'provider_max_concurrency'),remainingQuota,latencyMs};});
  const employees=root.employees.slice(0,2048).map((value,index)=>{const row=record(value,`employee_${index}`);return {employeeId:text(row.employeeId,'employee_id'),role:text(row.role,'employee_role'),enabled:bool(row.enabled,'employee_enabled')};});
  const ids=(value:unknown,name:string)=>{if(!Array.isArray(value))throw new Error(`INVALID_WEB_CONTROL_${name.toUpperCase()}`);return value.slice(0,2048).map((item,index)=>text(item,`${name}_${index}`));};

  return {
    version:1,
    generatedAt,
    goals:{queued:integer(goals.queued,'goals_queued'),running:integer(goals.running,'goals_running'),waitingAuthorization:integer(goals.waitingAuthorization,'goals_waiting_authorization'),blocked:integer(goals.blocked,'goals_blocked'),done:integer(goals.done,'goals_done'),failed:integer(goals.failed,'goals_failed')},
    goalRows,
    tasks:{queued:integer(tasks.queued,'tasks_queued'),running:integer(tasks.running,'tasks_running'),review:integer(tasks.review,'tasks_review'),authorization:integer(tasks.authorization,'tasks_authorization'),blocked:integer(tasks.blocked,'tasks_blocked'),done:integer(tasks.done,'tasks_done'),failed:integer(tasks.failed,'tasks_failed')},
    taskRows,
    workers:{total:integer(workers.total,'workers_total'),busy:integer(workers.busy,'workers_busy'),online:integer(workers.online,'workers_online'),waiting:integer(workers.waiting,'workers_waiting'),offline:integer(workers.offline,'workers_offline'),failed:integer(workers.failed,'workers_failed')},
    workerRows,
    providers,
    employees,
    authorization:{goalIds:ids(authorization.goalIds,'authorization_goal_ids'),taskIds:ids(authorization.taskIds,'authorization_task_ids')},
    evidence:{subjects:integer(evidence.subjects,'evidence_subjects'),judgePass:integer(evidence.judgePass,'evidence_judge_pass'),judgePending:integer(evidence.judgePending,'evidence_judge_pending')}
  };
}

export async function readWebControlSnapshot(file=defaultWebControlSnapshotPath):Promise<WebControlSnapshot|null>{
  try{return parseWebControlSnapshot(JSON.parse((await readFile(file,'utf8')).replace(/^\uFEFF/,'')));}
  catch(error){if(error instanceof Error&&'code' in error&&(error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
}

export async function writeWebControlSnapshot(snapshot:WebControlSnapshot,file=defaultWebControlSnapshotPath):Promise<void>{
  const validated=parseWebControlSnapshot(snapshot);
  await mkdir(path.dirname(file),{recursive:true});
  const temporary=`${file}.${process.pid}.tmp`;
  await writeFile(temporary,JSON.stringify(validated,null,2),'utf8');
  await rename(temporary,file);
}
