import type { SqlPoolLike } from '../../../packages/work-state/src/postgres-repository.js';
import { OperationalWorkService } from '../../../packages/work-state/src/service.js';
import type { EvidenceInput, JobResultInput, ResultFailure } from '../../../packages/work-state/src/types.js';
import { DeviceAuthError, VerifiedDeviceAuthenticator, type DeviceAuthContext } from './device-auth.js';

export interface ControllerRequest { method:string; path:string; headers:Record<string,string|undefined>; body:Buffer; nowMs?:number; }
export interface ControllerResponse { status:number; body:Record<string,unknown>; }

export class ControllerError extends Error {
  constructor(readonly status:number,readonly code:string,message:string,readonly retryable=false){super(message);}
}

const MAX_LEASE_TTL_MS=900_000;
const MIN_LEASE_TTL_MS=15_000;

function jsonBody(raw:Buffer):Record<string,unknown>{
  if(raw.length===0)return {};
  let value:unknown;
  try{value=JSON.parse(raw.toString('utf8'));}catch{throw new ControllerError(400,'INVALID_JSON','request body must be valid JSON');}
  if(!value||typeof value!=='object'||Array.isArray(value))throw new ControllerError(400,'INVALID_JSON_OBJECT','request body must be a JSON object');
  return value as Record<string,unknown>;
}
function stringField(value:unknown,name:string,max=512):string{
  if(typeof value!=='string'||!value.trim()||value.trim().length>max)throw new ControllerError(400,`INVALID_${name.toUpperCase()}`,`${name} is required`);
  return value.trim();
}
function optionalRecord(value:unknown,name:string):Record<string,unknown>|undefined{
  if(value===undefined||value===null)return undefined;
  if(typeof value!=='object'||Array.isArray(value))throw new ControllerError(400,`INVALID_${name.toUpperCase()}`,`${name} must be an object`);
  return value as Record<string,unknown>;
}
function recordField(value:unknown,name:string):Record<string,unknown>{return optionalRecord(value,name)??(()=>{throw new ControllerError(400,`INVALID_${name.toUpperCase()}`,`${name} is required`);})();}
function evidenceField(value:unknown):EvidenceInput[]{
  if(!Array.isArray(value)||value.length===0||value.length>64)throw new ControllerError(400,'INVALID_EVIDENCE','evidence must contain 1-64 items');
  return value.map((item,index)=>{
    const row=recordField(item,`evidence_${index}`);
    const kind=stringField(row.kind,'evidence_kind',32) as EvidenceInput['kind'];
    if(!['text','json','log','commit','url','screenshot'].includes(kind))throw new ControllerError(400,'INVALID_EVIDENCE_KIND','unsupported evidence kind');
    const ref=stringField(row.ref,'evidence_ref',2048);
    const summary=typeof row.summary==='string'&&row.summary.trim()?row.summary.trim().slice(0,2048):undefined;
    const sha256=typeof row.sha256==='string'&&row.sha256.trim()?row.sha256.trim().toLowerCase():undefined;
    if(sha256&&!/^[a-f0-9]{64}$/.test(sha256))throw new ControllerError(400,'INVALID_EVIDENCE_SHA256','evidence sha256 must be 64 hex characters');
    return {kind,ref,summary,sha256};
  });
}
function failureField(value:unknown):ResultFailure|undefined{
  if(value===undefined||value===null)return undefined;
  const row=recordField(value,'failure');
  return {code:stringField(row.code,'failure_code',128),message:stringField(row.message,'failure_message',2048),retriable:Boolean(row.retriable)};
}
function leaseTtl(value:unknown):number|undefined{
  if(value===undefined||value===null)return undefined;
  const ttl=Number(value);
  if(!Number.isInteger(ttl)||ttl<MIN_LEASE_TTL_MS||ttl>MAX_LEASE_TTL_MS)throw new ControllerError(400,'INVALID_LEASE_TTL','leaseTtlMs must be between 15000 and 900000');
  return ttl;
}
function isoTimestamp(value:unknown,name:string):string{
  const text=stringField(value,name,64);
  if(!Number.isFinite(Date.parse(text)))throw new ControllerError(400,`INVALID_${name.toUpperCase()}`,`${name} must be an ISO timestamp`);
  return new Date(text).toISOString();
}

export class WorkforceControllerV1 {
  readonly auth:VerifiedDeviceAuthenticator;
  constructor(readonly pool:SqlPoolLike,readonly service:OperationalWorkService){this.auth=new VerifiedDeviceAuthenticator(pool);}

  async handle(request:ControllerRequest):Promise<ControllerResponse>{
    try{return await this.route(request);}catch(error){return this.errorResponse(error);}
  }

  private async route(request:ControllerRequest):Promise<ControllerResponse>{
    const method=request.method.toUpperCase();
    const pathname=request.path.split('?')[0]??request.path;
    if(method==='GET'&&pathname==='/api/v1/status')return this.status();

    if(method==='POST'&&pathname==='/api/v1/jobs/lease'){
      const auth=await this.auth.verify({...request,path:pathname});
      const body=jsonBody(request.body);
      const lease=await this.service.assignNextJob({
        employeeId:auth.employeeId,
        deviceId:auth.deviceId,
        workerKind:'device',
        workerIndependenceKey:`device:${auth.deviceId}`,
        capabilities:auth.capabilities,
        permissions:auth.permissions,
        leaseTtlMs:leaseTtl(body.leaseTtlMs),
        now:new Date(request.nowMs??Date.now()).toISOString(),
      });
      return {status:200,body:{ok:true,lease:lease??null}};
    }

    const heartbeatMatch=/^\/api\/v1\/devices\/([^/]+)\/heartbeat$/.exec(pathname);
    if(method==='POST'&&heartbeatMatch){
      const auth=await this.auth.verify({...request,path:pathname});
      if(auth.deviceId!==decodeURIComponent(heartbeatMatch[1]))throw new ControllerError(409,'DEVICE_IDENTITY_MISMATCH','device path does not match authenticated device');
      const body=jsonBody(request.body);
      const health=stringField(body.health??'ok','health',16) as 'ok'|'degraded'|'offline';
      if(!['ok','degraded','offline'].includes(health))throw new ControllerError(400,'INVALID_HEALTH','health must be ok, degraded or offline');
      const metadata=optionalRecord(body.metadata,'metadata')??{};
      await this.service.heartbeat({employeeId:auth.employeeId,deviceId:auth.deviceId,at:new Date(request.nowMs??Date.now()).toISOString(),health,metadata});
      return {status:200,body:{ok:true,employeeId:auth.employeeId,deviceId:auth.deviceId,bindingId:auth.bindingId}};
    }

    const resultMatch=/^\/api\/v1\/jobs\/([^/]+)\/result$/.exec(pathname);
    if(method==='POST'&&resultMatch){
      const auth=await this.auth.verify({...request,path:pathname});
      const jobId=decodeURIComponent(resultMatch[1]);
      const body=jsonBody(request.body);
      const leaseId=stringField(body.leaseId,'lease_id',160);
      const leaseToken=stringField(body.leaseToken,'lease_token',256);
      const supplied=recordField(body.result,'result');
      const status=stringField(supplied.status,'result_status',16) as JobResultInput['status'];
      if(!['completed','failed'].includes(status))throw new ControllerError(400,'INVALID_RESULT_STATUS','result status must be completed or failed');
      const completedAt=isoTimestamp(supplied.completedAt,'completed_at');
      const output=optionalRecord(supplied.output,'output');
      const evidence=evidenceField(supplied.evidence);
      const failure=failureField(supplied.failure);
      if(status==='completed'&&!output)throw new ControllerError(400,'RESULT_OUTPUT_REQUIRED','completed result requires output object');
      if(status==='failed'&&!failure)throw new ControllerError(400,'RESULT_FAILURE_REQUIRED','failed result requires failure object');
      const result:JobResultInput={jobId,employeeId:auth.employeeId,deviceId:auth.deviceId,bindingId:auth.bindingId,status,output,evidence,completedAt,failure};
      const accepted=await this.service.submitResult({leaseId,leaseToken,result,acceptedAt:new Date(request.nowMs??Date.now()).toISOString()});
      return {status:200,body:{ok:true,result:accepted}};
    }

    throw new ControllerError(404,'NOT_FOUND','route not found');
  }

  private async status():Promise<ControllerResponse>{
    const migration=await this.pool.query<{version:string}>(`SELECT version FROM tigeriq_schema_migrations WHERE version='001_operational_state_v1'`);
    if(migration.rows[0]?.version!=='001_operational_state_v1')return {status:503,body:{ok:false,controller:'TigerIQ Workforce Controller V1',postgres:false,migration:null}};
    const counts=await this.pool.query<{employees:string;devices:string;queued_jobs:string;active_leases:string}>(`SELECT (SELECT count(*) FROM employees)::text employees,(SELECT count(*) FROM devices)::text devices,(SELECT count(*) FROM jobs WHERE stage='queued')::text queued_jobs,(SELECT count(*) FROM leases WHERE status='active' AND expires_at>now())::text active_leases`);
    const row=counts.rows[0]??{employees:'0',devices:'0',queued_jobs:'0',active_leases:'0'};
    return {status:200,body:{ok:true,controller:'TigerIQ Workforce Controller V1',protocol:'controller-v1',postgres:true,migration:'001_operational_state_v1',workforce:{employees:Number(row.employees),devices:Number(row.devices),queuedJobs:Number(row.queued_jobs),activeLeases:Number(row.active_leases)}}};
  }

  private errorResponse(error:unknown):ControllerResponse{
    if(error instanceof DeviceAuthError||error instanceof ControllerError)return {status:error.status,body:{ok:false,error:{code:error.code,message:error.message,retryable:error.retryable}}};
    const message=error instanceof Error?error.message:'controller unavailable';
    const lower=message.toLowerCase();
    if(lower.includes('expired'))return {status:410,body:{ok:false,error:{code:'LEASE_EXPIRED',message,retryable:true}}};
    if(lower.includes('stale job lease')||lower.includes('invalid job lease token')||lower.includes('identity mismatch'))return {status:409,body:{ok:false,error:{code:'LEASE_REJECTED',message,retryable:false}}};
    if(lower.includes('duplicate result conflict')||lower.includes('idempotency conflict'))return {status:409,body:{ok:false,error:{code:'IDEMPOTENCY_CONFLICT',message,retryable:false}}};
    if(lower.includes('required')||lower.includes('invalid')||lower.includes('must be'))return {status:400,body:{ok:false,error:{code:'INVALID_REQUEST',message,retryable:false}}};
    return {status:503,body:{ok:false,error:{code:'CONTROLLER_UNAVAILABLE',message:'workforce controller unavailable',retryable:true}}};
  }
}
