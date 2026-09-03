import { FileJournal } from '../../../packages/event-store/src/index.js';

export type ProjectId='ai-lab'|'driver';
export interface HeartbeatRecord {id:string;projectId:ProjectId;lastSeenAt:string;status:'running'|'idle'|'waiting'|'failed';attempt:number;}
export interface RecoveryPolicy {stuckAfterMs:number;maxAttempts:number;baseRetryMs:number;maxRetryMs:number;}
export type RecoveryAction='healthy'|'retry'|'restart'|'blocked';
export interface RecoveryDecision {action:RecoveryAction;reason:string;retryAfterMs?:number;}
export interface ProjectPaths {projectId:ProjectId;root:string;queue:string;state:string;evidence:string;secrets:string;journal:string;}
export interface SecretReference {version:1;providerId:string;keyName:string;source:'env'|'windows-credential-manager'|'file-ref';reference:string;}

const projectIds:ProjectId[]=['ai-lab','driver'];
const idPattern=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;

function requireId(value:string,name:string):string{
  if(typeof value!=='string'||!idPattern.test(value))throw new Error(`INVALID_${name.toUpperCase()}`);
  return value;
}

export function projectPaths(projectId:ProjectId,base='F:\\TigerIQ\\Runtime'):ProjectPaths{
  if(!projectIds.includes(projectId))throw new Error('INVALID_PROJECT_ID');
  const root=`${base}\\${projectId}`;
  return {projectId,root,queue:`${root}\\queue`,state:`${root}\\state`,evidence:`${root}\\evidence`,secrets:`${root}\\secrets`,journal:`${root}\\state\\events.jsonl`};
}

/** The repository's existing SHA-256 chained FileJournal is the only durable journal implementation. */
export function createProjectJournal(projectId:ProjectId,base='F:\\TigerIQ\\Runtime'):FileJournal{
  return new FileJournal(projectPaths(projectId,base).journal);
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
