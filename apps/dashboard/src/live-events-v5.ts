import { createHash } from 'node:crypto';
import type { ExecutiveDashboardV4, ExecutiveSystemV4, ExecutiveWorkV4 } from './executive-data-v4.js';
import { latestControllerRuntimeTruth } from './runtime-truth-client.js';
import type { ServerTelemetry, WorkforceTaskTelemetry } from './server.js';

export type LiveEventTypeV5 =
  | 'work.queued' | 'work.claimed' | 'work.started' | 'work.step' | 'work.heartbeat' | 'work.blocked' | 'work.failed' | 'work.completed'
  | 'system.health' | 'system.error' | 'system.recovered';

export interface LiveEventV5 {
  event_id: string;
  event_type: LiveEventTypeV5;
  timestamp: string;
  entity_type: 'work' | 'system';
  entity_id: string;
  work_id?: string;
  owner_id?: string;
  worker_id?: string;
  phase?: string;
  step?: string;
  message: string;
  evidence_ref?: string;
  correlation_key: string;
  idempotency_key?: string;
  last_activity_at?: string;
  last_activity_age_ms?: number;
  stale?: boolean;
  severity: 'info' | 'warning' | 'error';
  state: string;
  source_version: string;
}

type ProjectionState = { signature: string; tone: string; sourceVersion: string };
type RuntimeState = { stage:string; leaseId:string|null; heartbeatAt:string|null; stale:boolean; started:boolean };
type RuntimeTask = WorkforceTaskTelemetry&{
  createdAt?:string|null;updatedAt?:string|null;attempts?:number;maxAttempts?:number;lastFailureCode?:string|null;
  leaseId?:string|null;leaseEmployeeId?:string|null;leaseDeviceId?:string|null;leaseWorkerKind?:string|null;leaseAttempt?:number|null;leasedAt?:string|null;leaseExpiresAt?:string|null;
  workerHeartbeatAt?:string|null;workerOnline?:boolean;workerStale?:boolean;sourceRef?:string;
};

function stableId(parts: string[]): string { return `evt-${createHash('sha256').update(parts.join('\u001f')).digest('hex').slice(0, 24)}`; }
function iso(value:string|null|undefined,fallback:string):string { const n=Date.parse(value??''); return Number.isFinite(n)?new Date(n).toISOString():fallback; }
function ageMs(value:string|null|undefined,nowMs:number):number|null { const n=Date.parse(value??''); return Number.isFinite(n)?Math.max(0,nowMs-n):null; }
function activeStage(stage:string):boolean { return stage==='leased'||stage==='reviewing'||stage==='judging'; }
function eventRank(type:LiveEventTypeV5):number { return ({'work.queued':0,'work.claimed':1,'work.started':2,'work.step':3,'work.heartbeat':4,'work.blocked':5,'work.failed':6,'work.completed':7,'system.health':8,'system.error':9,'system.recovered':10} as Record<LiveEventTypeV5,number>)[type]; }

function workSourceVersion(work: ExecutiveWorkV4): string { return `${work.updated}|${work.status}|${work.tone}|${work.ownerCode ?? ''}|${work.next}`; }
function workType(work: ExecutiveWorkV4, previous?: ProjectionState): LiveEventTypeV5 {
  if (work.tone === 'done') return 'work.completed';
  if (work.tone === 'blocked' || work.tone === 'paused' || work.tone === 'stale') return 'work.blocked';
  if (work.tone === 'active') return previous?.tone === 'active' ? 'work.heartbeat' : 'work.started';
  return 'work.queued';
}
function workEvent(work: ExecutiveWorkV4, timestamp: string, previous?: ProjectionState): LiveEventV5 {
  const entityId = work.number ? String(work.number) : `title:${work.title}`;
  const sourceVersion = workSourceVersion(work),eventType=workType(work,previous);
  return {event_id:stableId(['work',entityId,eventType,sourceVersion]),event_type:eventType,timestamp,entity_type:'work',entity_id:entityId,work_id:work.number?`GH-${work.number}`:entityId,owner_id:work.ownerCode??undefined,phase:work.status,step:work.next,message:`${work.title} · ${work.status}`,evidence_ref:work.number?`github-issue:${work.number}`:undefined,correlation_key:work.number?`GH-${work.number}`:entityId,severity:work.tone==='blocked'?'error':['paused','stale'].includes(work.tone)?'warning':'info',state:work.tone,source_version:sourceVersion};
}
function systemSourceVersion(system: ExecutiveSystemV4): string { return `${system.status}|${system.tone}|${system.note}`; }
function systemEvent(system: ExecutiveSystemV4, timestamp: string, previous?: ProjectionState): LiveEventV5 {
  const sourceVersion=systemSourceVersion(system),recovered=previous&&['blocked','waiting','unknown'].includes(previous.tone)&&['active','done'].includes(system.tone);
  const eventType:LiveEventTypeV5=recovered?'system.recovered':system.tone==='blocked'?'system.error':'system.health';
  return {event_id:stableId(['system',system.key,eventType,sourceVersion]),event_type:eventType,timestamp,entity_type:'system',entity_id:system.key,message:`${system.name} · ${system.status}`,correlation_key:`system:${system.key}`,evidence_ref:`runtime-truth-v1:system:${system.key}`,severity:system.tone==='blocked'?'error':['waiting','unknown'].includes(system.tone)?'warning':'info',state:system.tone,source_version:sourceVersion};
}

export class LiveEventProjectionV5 {
  readonly #state = new Map<string, ProjectionState>();
  ingest(snapshot: ExecutiveDashboardV4): LiveEventV5[] {
    const events:LiveEventV5[]=[];
    for(const work of snapshot.works){const id=`work:${work.number??work.title}`,sourceVersion=workSourceVersion(work),previous=this.#state.get(id),signature=`${work.tone}|${sourceVersion}`;if(!previous||previous.signature!==signature)events.push(workEvent(work,snapshot.generatedAt,previous));this.#state.set(id,{signature,tone:work.tone,sourceVersion});}
    for(const system of snapshot.systems){const id=`system:${system.key}`,sourceVersion=systemSourceVersion(system),previous=this.#state.get(id),signature=`${system.tone}|${sourceVersion}`;if(!previous||previous.signature!==signature)events.push(systemEvent(system,snapshot.generatedAt,previous));this.#state.set(id,{signature,tone:system.tone,sourceVersion});}
    return events;
  }
}

function runtimeEvent(task:RuntimeTask,type:LiveEventTypeV5,at:string,nowMs:number,stale:boolean,message:string):LiveEventV5{
  const worker=task.leaseEmployeeId??task.assignedEmployeeId??undefined,last=task.workerHeartbeatAt??task.updatedAt??task.leasedAt??task.createdAt??at;
  const sourceVersion=[task.stage,task.leaseId??'',task.leasedAt??'',task.workerHeartbeatAt??'',task.updatedAt??'',task.lastFailureCode??'',String(stale)].join('|');
  return {event_id:stableId(['runtime-work',task.taskId,type,sourceVersion]),event_type:type,timestamp:at,entity_type:'work',entity_id:task.taskId,work_id:task.taskId,owner_id:worker,worker_id:worker,phase:task.stage,step:task.stage,message:`${task.taskId} · ${message}`,evidence_ref:task.sourceRef??`runtime-truth-v1:job:${task.taskId}`,correlation_key:task.taskId,last_activity_at:last,last_activity_age_ms:ageMs(last,nowMs)??undefined,stale,severity:type==='work.failed'?'error':type==='work.blocked'?'warning':'info',state:task.stage,source_version:sourceVersion};
}

export class RuntimeLiveEventProjectionV5 {
  readonly #work=new Map<string,RuntimeState>();
  readonly #systems=new Map<string,ProjectionState>();
  constructor(readonly truth:()=>ServerTelemetry|null=latestControllerRuntimeTruth){}
  ingest(snapshot:ExecutiveDashboardV4,nowMs=Date.now()):LiveEventV5[]{
    const events:LiveEventV5[]=[],telemetry=this.truth(),fallback=new Date(nowMs).toISOString(),staleAfter=Math.max(5_000,telemetry?.staleAfterMs??45_000);
    const tasks=(telemetry?.workforce?.taskList??[]) as RuntimeTask[];
    for(const task of tasks){
      const stage=String(task.stage||'unknown'),previous=this.#work.get(task.taskId),leaseId=task.leaseId??null,heartbeat=task.workerHeartbeatAt??null;
      const heartbeatAge=ageMs(heartbeat,nowMs),freshWorker=task.workerOnline===true&&task.workerStale!==true&&heartbeatAge!==null&&heartbeatAge<=staleAfter;
      const stale=activeStage(stage)&&Boolean(leaseId)&&!freshWorker;
      const leasedAt=iso(task.leasedAt,iso(task.updatedAt,fallback)),updatedAt=iso(task.updatedAt,fallback),heartbeatAt=iso(heartbeat,updatedAt);
      if(stage==='queued'&&(!previous||previous.stage!=='queued'))events.push(runtimeEvent(task,'work.queued',updatedAt,nowMs,false,'Đang chờ trong queue'));
      if(leaseId&&previous?.leaseId!==leaseId)events.push(runtimeEvent(task,'work.claimed',leasedAt,nowMs,stale,'Đã được worker nhận'));
      const shouldStart=activeStage(stage)&&Boolean(leaseId)&&freshWorker;
      if(shouldStart&&(!previous?.started||previous.leaseId!==leaseId))events.push(runtimeEvent(task,'work.started',heartbeatAt,nowMs,false,'Bắt đầu thực thi có lease + heartbeat'));
      if(previous&&previous.stage!==stage&&!['queued','done','failed','cancelled'].includes(stage))events.push(runtimeEvent(task,'work.step',updatedAt,nowMs,stale,`Chuyển bước ${previous.stage} → ${stage}`));
      if(shouldStart&&previous?.started&&previous.heartbeatAt!==heartbeat&&previous.leaseId===leaseId)events.push(runtimeEvent(task,'work.heartbeat',heartbeatAt,nowMs,false,'Nhịp sống worker mới'));
      if(stale&&previous?.stale!==true)events.push(runtimeEvent(task,'work.blocked',fallback,nowMs,true,'Lease còn nhưng heartbeat đã stale'));
      if(stage==='failed'&&previous?.stage!=='failed')events.push(runtimeEvent(task,'work.failed',updatedAt,nowMs,false,task.lastFailureCode?`Thất bại · ${task.lastFailureCode}`:'Thất bại'));
      if(stage==='done'&&previous?.stage!=='done')events.push(runtimeEvent(task,'work.completed',updatedAt,nowMs,false,'Hoàn tất có runtime truth'));
      this.#work.set(task.taskId,{stage,leaseId,heartbeatAt:heartbeat,stale,started:shouldStart||Boolean(previous?.started&&previous.leaseId===leaseId&&!['queued','done','failed','cancelled'].includes(stage))});
    }
    for(const system of snapshot.systems){const id=`system:${system.key}`,sourceVersion=systemSourceVersion(system),previous=this.#systems.get(id),signature=`${system.tone}|${sourceVersion}`;if(!previous||previous.signature!==signature)events.push(systemEvent(system,snapshot.generatedAt||fallback,previous));this.#systems.set(id,{signature,tone:system.tone,sourceVersion});}
    return events.sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp)||eventRank(a.event_type)-eventRank(b.event_type)||a.event_id.localeCompare(b.event_id));
  }
}

let recentGlobal:LiveEventV5[]=[];
export function recentRuntimeLiveEventsV5(limit=20):LiveEventV5[]{return structuredClone(recentGlobal.slice(-Math.max(1,limit)));}

export class LiveEventBufferV5 {
  readonly #rows: LiveEventV5[] = [];
  readonly #ids = new Set<string>();
  constructor(readonly limit = 200) {}
  append(events: readonly LiveEventV5[]): LiveEventV5[] {
    const added:LiveEventV5[]=[];
    for(const event of events){if(this.#ids.has(event.event_id))continue;this.#ids.add(event.event_id);this.#rows.push(structuredClone(event));added.push(structuredClone(event));}
    this.#rows.sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp)||eventRank(a.event_type)-eventRank(b.event_type)||a.event_id.localeCompare(b.event_id));
    while(this.#rows.length>this.limit){const removed=this.#rows.shift();if(removed)this.#ids.delete(removed.event_id);}
    if(added.length){const merged=new Map(recentGlobal.map(row=>[row.event_id,row]));for(const row of added)merged.set(row.event_id,structuredClone(row));recentGlobal=[...merged.values()].sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp)||eventRank(a.event_type)-eventRank(b.event_type)).slice(-200);}
    return added;
  }
  since(lastEventId?:string):LiveEventV5[]{if(!lastEventId)return structuredClone(this.#rows);const index=this.#rows.findIndex(event=>event.event_id===lastEventId);return structuredClone(index<0?this.#rows:this.#rows.slice(index+1));}
  recent(limit=20):LiveEventV5[]{return structuredClone(this.#rows.slice(-Math.max(1,limit)));}
  lastEventId():string|null{return this.#rows.at(-1)?.event_id??null;}
}
