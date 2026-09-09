import type { ServerTelemetry, WorkforceEmployeeTelemetry, WorkforceTaskTelemetry } from './server.js';

type Rec=Record<string,unknown>;
const rec=(value:unknown):Rec|null=>value&&typeof value==='object'&&!Array.isArray(value)?value as Rec:null;
const text=(value:unknown,max=512):string|null=>typeof value==='string'&&value.length<=max?value:null;
const num=(value:unknown):number|null=>typeof value==='number'&&Number.isFinite(value)?value:null;
const rows=(value:unknown):Rec[]=>Array.isArray(value)?value.map(rec).filter((row):row is Rec=>Boolean(row)):[];

function emptyTelemetry():ServerTelemetry{return {available:false,server:'PC01',generatedAt:new Date().toISOString(),cpu:null,memory:null,uptimeSeconds:null,disk:null,worker:null,controller:null,workforce:null,postgresql:null,ollama:null,tailscale:null,gpu:null,truthSource:null,staleAfterMs:null,jobStages:{},providers:[]};}

function stageCounts(value:unknown):Record<string,number>{const root=rec(value);if(!root)return {};return Object.fromEntries(Object.entries(root).flatMap(([key,value])=>{const parsed=num(value);return parsed===null?[]:[[key,parsed]];}));}

function activeStage(stage:string|null):boolean{return stage==='leased'||stage==='reviewing'||stage==='judging';}

export function normalizeControllerRuntimeTruth(raw:unknown,baseUrl='http://127.0.0.1:8790'):ServerTelemetry{
  const root=rec(raw);if(!root||root.ok!==true||root.protocol!=='runtime-truth-v1')return emptyTelemetry();
  const pc01=rec(root.pc01),metadata=rec(pc01?.metadata),resources=rec(metadata?.resources),ollama=rec(metadata?.ollama),queue=rec(root.queue);
  const employees=rows(root.employees),jobs=rows(root.jobs),leases=rows(root.leases),counts=stageCounts(queue?.stageCounts);
  const leaseByJob=new Map(leases.map(row=>[text(row.jobId,160)??'',row]));
  const taskList:WorkforceTaskTelemetry[]=jobs.map(row=>({taskId:text(row.jobId,160)??'UNKNOWN',objective:text(row.objective,512)??text(row.title,512)??'Runtime job',stage:text(row.stage,32)??'unknown',priority:text(row.priority,16)??'P1',assignedEmployeeId:text(leaseByJob.get(text(row.jobId,160)??'')?.employeeId,160)??text(row.targetEmployeeId,160)}));
  const roster:WorkforceEmployeeTelemetry[]=employees.map(row=>{
    const employeeId=text(row.employeeId,160)??'UNKNOWN';
    const current=taskList.filter(task=>task.assignedEmployeeId===employeeId&&activeStage(task.stage)).map(task=>task.taskId);
    const online=row.online===true,health=text(row.health,32)??'unknown';
    const roles=Array.isArray(row.roles)?row.roles.filter((value):value is string=>typeof value==='string'):[];
    return {employeeId,displayName:text(row.displayName,160)??employeeId,department:'Runtime',role:roles[0]??'worker',nodeId:text(row.deviceId,160)??'unbound',provider:null,model:null,availability:!online?'offline':health==='degraded'?'degraded':current.length?'busy':'idle',healthScore:online?100:0,concurrencyLimit:Math.max(1,num(row.concurrencyLimit)??1),activeTaskCount:current.length,currentTaskIds:current};
  });
  const total=num(resources?.totalRamBytes),free=num(resources?.freeRamBytes),used=total!==null&&free!==null?Math.max(0,total-free):null;
  const model=text(metadata?.model,128)??text(ollama?.model,128),providerRows=rows(root.providers);
  const providerTruth=providerRows.map(row=>({providerId:text(row.providerId,160)??'UNKNOWN',provider:text(row.provider,160)??'unknown',model:text(row.model,160)??'unknown',state:text(row.state,32)??'unknown',lastHeartbeatAt:text(row.lastHeartbeatAt,64),stale:row.stale===true}));
  const activeLeases=num(queue?.activeLeases)??leases.length,queued=num(queue?.queued)??counts.queued??0;
  return {
    available:Boolean(pc01&&pc01.online===true),server:'PC01',generatedAt:text(root.generatedAt,64)??new Date().toISOString(),
    cpu:resources?{utilizationPercent:num(resources.cpuPercent)}:null,
    memory:total!==null&&used!==null?{usedBytes:used,totalBytes:total,utilizationPercent:total>0?used/total*100:null}:null,
    uptimeSeconds:num(metadata?.processUptimeSeconds),disk:null,
    worker:pc01?{online:pc01.online===true,pid:num(metadata?.pid),instances:pc01.online===true?1:0}:null,
    controller:{online:true,ip:new URL(baseUrl).hostname,port:Number(new URL(baseUrl).port||8790),protocol:text(root.protocol,64),queuedJobs:queued,activeLeases,pc01:{employeeId:text(pc01?.employeeId,160),deviceId:text(pc01?.deviceId,160),health:text(pc01?.health,32),lastHeartbeatAt:text(pc01?.heartbeatAt,64),online:pc01?.online===true}},
    workforce:{employeesTotal:roster.length,idle:roster.filter(row=>row.availability==='idle').length,busy:roster.filter(row=>row.availability==='busy').length,offline:roster.filter(row=>row.availability==='offline').length,degraded:roster.filter(row=>row.availability==='degraded').length,activeTasks:activeLeases,tasksActive:queued+(counts.leased??0)+(counts.reviewing??0)+(counts.judging??0),tasksFailed:counts.failed??0,roster,taskList},
    postgresql:{online:root.postgres===true,service:'controller-runtime-truth',port:5432},ollama:ollama?{online:ollama.ok===true,models:model?[model]:[]}:null,tailscale:null,gpu:null,
    truthSource:text(root.source,128)??'workforce-controller-v1',staleAfterMs:num(root.staleAfterMs),jobStages:counts,providers:providerTruth,
  };
}

export async function collectControllerRuntimeTruth(baseUrl:string,ingressToken:string):Promise<ServerTelemetry>{
  if(!baseUrl||ingressToken.trim().length<32)return emptyTelemetry();
  try{const response=await fetch(new URL('/api/v1/runtime-truth',baseUrl),{headers:{authorization:`Bearer ${ingressToken}`},cache:'no-store'});if(!response.ok)return emptyTelemetry();return normalizeControllerRuntimeTruth(await response.json(),baseUrl);}catch{return emptyTelemetry();}
}
