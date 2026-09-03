import type { ContinuousRuntimeState } from '../../continuous-operations/src/core.js';
import type { EmployeeDefinition,ProviderDefinition,WorkTask } from '../../ai-gateway/src/core.js';
import type { EvidenceBundle } from '../../evidence-engine/src/core.js';

export interface WorkerView {workerId:string;employeeId?:string;modelId?:string;providerId?:string;status:'online'|'busy'|'waiting'|'offline'|'failed';currentTaskId?:string;lastSeenAt?:string;}
export interface WebControlSnapshot {
  version:1;
  generatedAt:string;
  goals:{queued:number;running:number;waitingAuthorization:number;blocked:number;done:number;failed:number};
  goalRows:Array<{goalId:string;stage:string;missionId:string;reason?:string}>;
  tasks:{queued:number;running:number;review:number;authorization:number;blocked:number;done:number;failed:number};
  taskRows:Array<{taskId:string;goalId:string;stage:string;priority:string;dependencies:string[];modelId?:string;attempts:number}>;
  workers:{total:number;busy:number;online:number;waiting:number;offline:number;failed:number};
  workerRows:WorkerView[];
  providers:Array<{providerId:string;enabled:boolean;healthy:boolean;kind:string;costClass:string;maxConcurrency:number;remainingQuota?:number;latencyMs?:number}>;
  employees:Array<{employeeId:string;role:string;enabled:boolean}>;
  authorization:{goalIds:string[];taskIds:string[]};
  evidence:{subjects:number;judgePass:number;judgePending:number};
}

function countBy<T extends string>(items:T[]):Record<T,number>{return items.reduce((acc,item)=>{acc[item]=(acc[item]??0)+1;return acc;},{} as Record<T,number>);}

export function buildWebControlSnapshot(input:{continuous:ContinuousRuntimeState;tasks:WorkTask[];workers:WorkerView[];providers:ProviderDefinition[];employees:EmployeeDefinition[];evidence:EvidenceBundle[];now?:string}):WebControlSnapshot{
  const goalStages=countBy(Object.values(input.continuous.goals).map(row=>row.stage));
  const taskStages=countBy(input.tasks.map(task=>task.stage));
  const workerStages=countBy(input.workers.map(worker=>worker.status));
  const authorizationGoalIds=Object.entries(input.continuous.goals).filter(([,row])=>row.stage==='waiting_authorization').map(([id])=>id).sort();
  const authorizationTaskIds=input.tasks.filter(task=>task.stage==='authorization').map(task=>task.taskId).sort();
  const judgePass=input.evidence.filter(bundle=>bundle.judge?.decision==='pass').length;
  return {
    version:1,
    generatedAt:input.now??new Date().toISOString(),
    goals:{
      queued:goalStages.queued??0,
      running:(goalStages.injected??0)+(goalStages.running??0),
      waitingAuthorization:goalStages.waiting_authorization??0,
      blocked:(goalStages.blocked_dependency??0)+(goalStages.blocked_plan??0),
      done:goalStages.done??0,
      failed:goalStages.failed??0
    },
    goalRows:Object.entries(input.continuous.goals).map(([goalId,row])=>({goalId,stage:row.stage,missionId:row.missionId,reason:row.reason})).sort((a,b)=>a.goalId.localeCompare(b.goalId)),
    tasks:{
      queued:taskStages.queued??0,
      running:taskStages.running??0,
      review:taskStages.review??0,
      authorization:taskStages.authorization??0,
      blocked:taskStages.blocked??0,
      done:taskStages.done??0,
      failed:taskStages.failed??0
    },
    taskRows:input.tasks.map(task=>({taskId:task.taskId,goalId:task.goalId,stage:task.stage,priority:task.priority,dependencies:[...task.dependencies],modelId:task.assignedModelId??task.authorModelId,attempts:task.attempts})).sort((a,b)=>a.taskId.localeCompare(b.taskId)),
    workers:{
      total:input.workers.length,
      busy:workerStages.busy??0,
      online:workerStages.online??0,
      waiting:workerStages.waiting??0,
      offline:workerStages.offline??0,
      failed:workerStages.failed??0
    },
    workerRows:input.workers.map(worker=>({...worker})).sort((a,b)=>a.workerId.localeCompare(b.workerId)),
    providers:input.providers.map(provider=>({providerId:provider.providerId,enabled:provider.enabled,healthy:provider.healthy,kind:provider.kind,costClass:provider.costClass,maxConcurrency:provider.maxConcurrency,remainingQuota:provider.remainingQuota,latencyMs:provider.latencyMs})).sort((a,b)=>a.providerId.localeCompare(b.providerId)),
    employees:input.employees.map(employee=>({employeeId:employee.employeeId,role:employee.role,enabled:employee.enabled})).sort((a,b)=>a.employeeId.localeCompare(b.employeeId)),
    authorization:{goalIds:authorizationGoalIds,taskIds:authorizationTaskIds},
    evidence:{subjects:input.evidence.length,judgePass,judgePending:input.evidence.length-judgePass}
  };
}
