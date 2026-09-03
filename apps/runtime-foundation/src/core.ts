export type ProjectId='ai-lab'|'driver';
export type RuntimeEntity='goal'|'mission'|'task'|'worker'|'evidence'|'provider';
export type RuntimeEventKind='created'|'updated'|'started'|'heartbeat'|'retry_scheduled'|'paused'|'resumed'|'completed'|'failed'|'blocked'|'recovered';

export interface RuntimeEvent {
  version:1;
  eventId:string;
  projectId:ProjectId;
  entity:RuntimeEntity;
  entityId:string;
  kind:RuntimeEventKind;
  at:string;
  sequence:number;
  idempotencyKey?:string;
  metadata?:Record<string,string|number|boolean|null>;
}

export interface EventJournal {version:1;events:RuntimeEvent[];lastSequence:number;}
export interface HeartbeatRecord {id:string;projectId:ProjectId;lastSeenAt:string;status:'running'|'idle'|'waiting'|'failed';attempt:number;}
export interface RecoveryPolicy {stuckAfterMs:number;maxAttempts:number;baseRetryMs:number;maxRetryMs:number;}
export type RecoveryAction='healthy'|'retry'|'restart'|'blocked';
export interface RecoveryDecision {action:RecoveryAction;reason:string;retryAfterMs?:number;}
export interface ProjectPaths {projectId:ProjectId;root:string;queue:string;state:string;evidence:string;secrets:string;}
export interface SecretReference {version:1;providerId:string;keyName:string;source:'env'|'windows-credential-manager'|'file-ref';reference:string;}

const projectIds:ProjectId[]=['ai-lab','driver'];
const eventKinds:RuntimeEventKind[]=['created','updated','started','heartbeat','retry_scheduled','paused','resumed','completed','failed','blocked','recovered'];
const entityKinds:RuntimeEntity[]=['goal','mission','task','worker','evidence','provider'];
const idPattern=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;

function requireId(value:string,name:string):string{
  if(typeof value!=='string'||!idPattern.test(value))throw new Error(`INVALID_${name.toUpperCase()}`);
  return value;
}

export function projectPaths(projectId:ProjectId,base='F:\\TigerIQ\\Runtime'):ProjectPaths{
  if(!projectIds.includes(projectId))throw new Error('INVALID_PROJECT_ID');
  const root=`${base}\\${projectId}`;
  return {projectId,root,queue:`${root}\\queue`,state:`${root}\\state`,evidence:`${root}\\evidence`,secrets:`${root}\\secrets`};
}

export function emptyJournal():EventJournal{return {version:1,events:[],lastSequence:0};}

export function appendEvent(journal:EventJournal,input:Omit<RuntimeEvent,'version'|'eventId'|'sequence'> & {eventId?:string}):EventJournal{
  if(journal.version!==1||journal.lastSequence<0)throw new Error('INVALID_EVENT_JOURNAL');
  if(!projectIds.includes(input.projectId)||!entityKinds.includes(input.entity)||!eventKinds.includes(input.kind))throw new Error('INVALID_RUNTIME_EVENT');
  requireId(input.entityId,'entity_id');
  if(Number.isNaN(Date.parse(input.at)))throw new Error('INVALID_EVENT_TIME');
  if(input.idempotencyKey){
    requireId(input.idempotencyKey,'idempotency_key');
    const duplicate=journal.events.find(event=>event.projectId===input.projectId&&event.idempotencyKey===input.idempotencyKey);
    if(duplicate)return journal;
  }
  const sequence=journal.lastSequence+1;
  const eventId=input.eventId?requireId(input.eventId,'event_id'):`evt:${input.projectId}:${sequence}`;
  if(journal.events.some(event=>event.eventId===eventId))throw new Error('DUPLICATE_EVENT_ID');
  const event:RuntimeEvent={version:1,eventId,projectId:input.projectId,entity:input.entity,entityId:input.entityId,kind:input.kind,at:input.at,sequence,idempotencyKey:input.idempotencyKey,metadata:input.metadata};
  return {version:1,events:[...journal.events,event],lastSequence:sequence};
}

export function verifyJournal(journal:EventJournal):boolean{
  if(journal.version!==1||journal.lastSequence!==journal.events.length)return false;
  const ids=new Set<string>();
  for(let index=0;index<journal.events.length;index++){
    const event=journal.events[index];
    if(event.version!==1||event.sequence!==index+1||ids.has(event.eventId))return false;
    ids.add(event.eventId);
  }
  return true;
}

export function recoveryDecision(heartbeat:HeartbeatRecord,nowMs:number,policy:RecoveryPolicy):RecoveryDecision{
  if(policy.stuckAfterMs<1000||policy.maxAttempts<1||policy.baseRetryMs<100||policy.maxRetryMs<policy.baseRetryMs)throw new Error('INVALID_RECOVERY_POLICY');
  if(heartbeat.status==='failed'){
    if(heartbeat.attempt>=policy.maxAttempts)return {action:'blocked',reason:'max_attempts_exceeded'};
    const retryAfterMs=Math.min(policy.maxRetryMs,policy.baseRetryMs*Math.pow(2,Math.max(0,heartbeat.attempt)));
    return {action:'retry',reason:'worker_failed',retryAfterMs};
  }
  const last=Date.parse(heartbeat.lastSeenAt);
  if(Number.isNaN(last))throw new Error('INVALID_HEARTBEAT_TIME');
  const age=Math.max(0,nowMs-last);
  if(heartbeat.status==='running'&&age>policy.stuckAfterMs){
    if(heartbeat.attempt>=policy.maxAttempts)return {action:'blocked',reason:'stuck_max_attempts'};
    return {action:'restart',reason:'heartbeat_stale'};
  }
  return {action:'healthy',reason:'heartbeat_fresh'};
}

export function parseSecretReference(raw:unknown):SecretReference{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('INVALID_SECRET_REFERENCE');
  const row=raw as Record<string,unknown>;
  if(row.version!==1||typeof row.providerId!=='string'||typeof row.keyName!=='string'||typeof row.reference!=='string')throw new Error('INVALID_SECRET_REFERENCE');
  const source=row.source;
  if(source!=='env'&&source!=='windows-credential-manager'&&source!=='file-ref')throw new Error('INVALID_SECRET_SOURCE');
  const providerId=requireId(row.providerId,'provider_id');
  const keyName=requireId(row.keyName,'key_name');
  const reference=row.reference.trim();
  if(!reference||reference.length>240)throw new Error('INVALID_SECRET_REFERENCE');
  if(/sk-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{12,}|-----BEGIN [A-Z ]+PRIVATE KEY-----/.test(reference))throw new Error('RAW_SECRET_FORBIDDEN');
  return {version:1,providerId,keyName,source,reference};
}

export function redactSensitiveText(value:string):string{
  return value
    .replace(/sk-[A-Za-z0-9_-]{8,}/g,'[REDACTED]')
    .replace(/AIza[A-Za-z0-9_-]{8,}/g,'[REDACTED]')
    .replace(/(api[_-]?key\s*[=:]\s*)[^\s,;]+/gi,'$1[REDACTED]')
    .replace(/(authorization\s*:\s*bearer\s+)[^\s]+/gi,'$1[REDACTED]');
}
