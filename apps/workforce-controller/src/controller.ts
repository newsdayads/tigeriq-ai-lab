import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { SqlPoolLike } from '../../../packages/work-state/src/postgres-repository.js';
import { OperationalWorkService } from '../../../packages/work-state/src/service.js';
import type { EvidenceInput, JobDefinition, JobResultInput, ResultFailure, WorkerKind } from '../../../packages/work-state/src/types.js';
import { DeviceAuthError, VerifiedDeviceAuthenticator } from './device-auth.js';

export interface ControllerRequest { method:string; path:string; headers:Record<string,string|undefined>; body:Buffer; nowMs?:number; }
export interface ControllerResponse { status:number; body:Record<string,unknown>; }

export class ControllerError extends Error {
  constructor(readonly status:number,readonly code:string,message:string,readonly retryable=false){super(message);}
}

const MAX_LEASE_TTL_MS=900_000;
const MIN_LEASE_TTL_MS=15_000;
const PC01_EMPLOYEE_ID='EMP-PC01-NATIVE';

function sha256(value:string):string{return createHash('sha256').update(value,'utf8').digest('hex');}
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
function optionalString(value:unknown,max=512):string|undefined{return typeof value==='string'&&value.trim()?value.trim().slice(0,max):undefined;}
function optionalRecord(value:unknown,name:string):Record<string,unknown>|undefined{
  if(value===undefined||value===null)return undefined;
  if(typeof value!=='object'||Array.isArray(value))throw new ControllerError(400,`INVALID_${name.toUpperCase()}`,`${name} must be an object`);
  return value as Record<string,unknown>;
}
function recordField(value:unknown,name:string):Record<string,unknown>{return optionalRecord(value,name)??(()=>{throw new ControllerError(400,`INVALID_${name.toUpperCase()}`,`${name} is required`);})();}
function stringArray(value:unknown,name:string,maxItems=64):string[]{
  if(value===undefined||value===null)return [];
  if(!Array.isArray(value)||value.length>maxItems)throw new ControllerError(400,`INVALID_${name.toUpperCase()}`,`${name} must be an array`);
  return value.map((item,index)=>stringField(item,`${name}_${index}`,128));
}
function evidenceField(value:unknown):EvidenceInput[]{
  if(!Array.isArray(value)||value.length===0||value.length>64)throw new ControllerError(400,'INVALID_EVIDENCE','evidence must contain 1-64 items');
  return value.map((item,index)=>{
    const row=recordField(item,`evidence_${index}`);
    const kind=stringField(row.kind,'evidence_kind',32) as EvidenceInput['kind'];
    if(!['text','json','log','commit','url','screenshot'].includes(kind))throw new ControllerError(400,'INVALID_EVIDENCE_KIND','unsupported evidence kind');
    const ref=stringField(row.ref,'evidence_ref',2048);
    const summary=typeof row.summary==='string'&&row.summary.trim()?row.summary.trim().slice(0,2048):undefined;
    const digest=typeof row.sha256==='string'&&row.sha256.trim()?row.sha256.trim().toLowerCase():undefined;
    if(digest&&!/^[a-f0-9]{64}$/.test(digest))throw new ControllerError(400,'INVALID_EVIDENCE_SHA256','evidence sha256 must be 64 hex characters');
    return {kind,ref,summary,sha256:digest};
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
function oneOf<T extends string>(value:unknown,name:string,allowed:readonly T[],fallback:T):T{
  if(value===undefined||value===null)return fallback;
  const text=stringField(value,name,64) as T;
  if(!allowed.includes(text))throw new ControllerError(400,`INVALID_${name.toUpperCase()}`,`${name} is invalid`);
  return text;
}

export class WorkforceControllerV1 {
  readonly auth:VerifiedDeviceAuthenticator;
  constructor(readonly pool:SqlPoolLike,readonly service:OperationalWorkService,private readonly ingressToken?:string){this.auth=new VerifiedDeviceAuthenticator(pool);}

  async handle(request:ControllerRequest):Promise<ControllerResponse>{
    try{return await this.route(request);}catch(error){return this.errorResponse(error);}
  }

  private requireIngressAuth(request:ControllerRequest):void{
    if(!this.ingressToken)throw new ControllerError(503,'INGRESS_NOT_CONFIGURED','work intake is not configured',true);
    const authorization=request.headers.authorization??request.headers.Authorization;
    if(typeof authorization!=='string'||!authorization.startsWith('Bearer '))throw new ControllerError(401,'INGRESS_AUTH_REQUIRED','bearer authentication required');
    const supplied=authorization.slice(7).trim();
    const expectedHash=Buffer.from(sha256(this.ingressToken),'hex'),suppliedHash=Buffer.from(sha256(supplied),'hex');
    if(!timingSafeEqual(expectedHash,suppliedHash))throw new ControllerError(401,'INGRESS_AUTH_INVALID','invalid ingress credential');
  }

  private async route(request:ControllerRequest):Promise<ControllerResponse>{
    const method=request.method.toUpperCase();
    const pathname=request.path.split('?')[0]??request.path;
    if(method==='GET'&&pathname==='/api/v1/status')return this.status(request.nowMs??Date.now());

    if(method==='POST'&&pathname==='/api/v1/pc01/register'){
      this.requireIngressAuth(request);
      const body=jsonBody(request.body),now=new Date(request.nowMs??Date.now()).toISOString();
      const employeeId=optionalString(body.employeeId,128)??PC01_EMPLOYEE_ID;
      const deviceId=optionalString(body.deviceId,128)??'DEV-PC01';
      const bindingId=optionalString(body.bindingId,128)??'BIND-PC01-NATIVE';
      const fingerprint=stringField(body.publicKeyFingerprint,'public_key_fingerprint',64).toLowerCase();
      if(!/^[a-f0-9]{64}$/.test(fingerprint))throw new ControllerError(400,'INVALID_PUBLIC_KEY_FINGERPRINT','publicKeyFingerprint must be sha256 hex');
      const publicKeyBase64=stringField(body.publicKeyBase64,'public_key_base64',8192);
      const capabilities=stringArray(body.capabilities,'capabilities');
      const permissions=stringArray(body.permissions,'permissions');
      if(capabilities.length===0)throw new ControllerError(400,'CAPABILITIES_REQUIRED','capabilities are required');
      const concurrencyLimit=Number(body.concurrencyLimit??4);
      if(!Number.isInteger(concurrencyLimit)||concurrencyLimit<1||concurrencyLimit>16)throw new ControllerError(400,'INVALID_CONCURRENCY_LIMIT','concurrencyLimit must be 1-16');
      const metadata=optionalRecord(body.metadata,'metadata')??{};
      await this.service.upsertEmployee({employeeId,displayName:optionalString(body.displayName,128)??'PC01 Native Worker',roles:['pc01-native-worker'],permissions,capabilities,state:'active',concurrencyLimit,createdAt:now,updatedAt:now});
      await this.service.upsertDevice({deviceId,platform:optionalString(body.platform,64)??'windows-pc01',publicKeyFingerprint:fingerprint,state:'active',metadata:{...metadata,publicKeyBase64,nodeId:optionalString(body.nodeId,128)??'PC01'},createdAt:now,updatedAt:now});
      await this.service.bindDevice({bindingId,employeeId,deviceId,state:'active',createdAt:now,updatedAt:now});
      return {status:200,body:{ok:true,employeeId,deviceId,bindingId,capabilities,permissions}};
    }

    if(method==='POST'&&pathname==='/api/v1/work-orders'){
      this.requireIngressAuth(request);
      const body=jsonBody(request.body),payload=optionalRecord(body.payload,'payload')??{},createdAt=new Date(request.nowMs??Date.now()).toISOString();
      const allowedWorkerKinds=stringArray(body.allowedWorkerKinds,'allowed_worker_kinds') as WorkerKind[];
      const workerKinds=(allowedWorkerKinds.length?allowedWorkerKinds:['pc01']) as WorkerKind[];
      if(workerKinds.some(kind=>!['ai','pc01','device','tool','human'].includes(kind)))throw new ControllerError(400,'INVALID_WORKER_KIND','allowedWorkerKinds contains unsupported value');
      const expectedEvidence=stringArray(body.expectedEvidence,'expected_evidence') as EvidenceInput['kind'][];
      const evidenceKinds=(expectedEvidence.length?expectedEvidence:['json']) as EvidenceInput['kind'][];
      if(evidenceKinds.some(kind=>!['text','json','log','commit','url','screenshot'].includes(kind)))throw new ControllerError(400,'INVALID_EXPECTED_EVIDENCE','expectedEvidence contains unsupported value');
      const maxAttempts=Number(body.maxAttempts??2);
      if(!Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>10)throw new ControllerError(400,'INVALID_MAX_ATTEMPTS','maxAttempts must be 1-10');
      const independentReview=Boolean(body.independentReview??false),judgeRequired=Boolean(body.judgeRequired??false);
      if(judgeRequired&&!independentReview)throw new ControllerError(400,'INVALID_GATE','judgeRequired requires independentReview');
      const job:JobDefinition={
        jobId:optionalString(body.jobId,160)??`JOB-${randomUUID()}`.toUpperCase(),
        goalId:optionalString(body.goalId,160),
        idempotencyKey:stringField(body.idempotencyKey,'idempotency_key',256),
        title:stringField(body.title,'title',512),
        objective:stringField(body.objective,'objective',4096),
        payload,
        targetEmployeeId:optionalString(body.targetEmployeeId,160),
        preferredProviderId:optionalString(body.preferredProviderId,160),
        requiredPermissions:stringArray(body.requiredPermissions,'required_permissions'),
        requiredCapabilities:stringArray(body.requiredCapabilities,'required_capabilities'),
        allowedWorkerKinds:workerKinds,
        expectedEvidence:evidenceKinds,
        scopeKeys:stringArray(body.scopeKeys,'scope_keys').length?stringArray(body.scopeKeys,'scope_keys'):['workspace/tigeriq'],
        dependencies:stringArray(body.dependencies,'dependencies'),
        maxAttempts,
        independentReview,
        judgeRequired,
        priority:oneOf(body.priority,'priority',['P0','P1','P2','P3'] as const,'P1'),
        createdAt,
      };
      const created=await this.service.createJob(job);
      return {status:201,body:{ok:true,workOrder:created}};
    }

    const stateMatch=/^\/api\/v1\/work-orders\/([^/]+)$/.exec(pathname);
    if(method==='GET'&&stateMatch){
      this.requireIngressAuth(request);
      const snapshot=await this.service.getJob(decodeURIComponent(stateMatch[1]));
      if(!snapshot)throw new ControllerError(404,'WORK_ORDER_NOT_FOUND','work order not found');
      return {status:200,body:{ok:true,state:snapshot}};
    }

    if(method==='POST'&&pathname==='/api/v1/jobs/lease'){
      const auth=await this.auth.verify({...request,path:pathname});
      const body=jsonBody(request.body);
      const lease=await this.service.assignNextJob({employeeId:auth.employeeId,deviceId:auth.deviceId,workerKind:'pc01',workerIndependenceKey:`device:${auth.deviceId}`,capabilities:auth.capabilities,permissions:auth.permissions,leaseTtlMs:leaseTtl(body.leaseTtlMs),now:new Date(request.nowMs??Date.now()).toISOString()});
      return {status:200,body:{ok:true,lease:lease??null}};
    }

    const renewMatch=/^\/api\/v1\/jobs\/([^/]+)\/lease\/renew$/.exec(pathname);
    if(method==='POST'&&renewMatch){
      const auth=await this.auth.verify({...request,path:pathname});
      const jobId=decodeURIComponent(renewMatch[1]),body=jsonBody(request.body),leaseId=stringField(body.leaseId,'lease_id',160),leaseToken=stringField(body.leaseToken,'lease_token',256);
      const ttl=leaseTtl(body.leaseTtlMs)??120_000,nowMs=request.nowMs??Date.now(),now=new Date(nowMs).toISOString(),expiresAt=new Date(nowMs+ttl).toISOString();
      const lease=await this.pool.query<{lease_id:string;expires_at:string|Date}>(`UPDATE leases SET expires_at=$1 WHERE lease_id=$2 AND job_id=$3 AND employee_id=$4 AND device_id=$5 AND binding_id=$6 AND status='active' AND expires_at>$7 AND lease_token_hash=$8 RETURNING lease_id,expires_at`,[expiresAt,leaseId,jobId,auth.employeeId,auth.deviceId,auth.bindingId,now,sha256(leaseToken)]);
      if(!lease.rows[0])throw new ControllerError(409,'LEASE_RENEW_REJECTED','active matching lease not found or lease already expired');
      return {status:200,body:{ok:true,leaseId,jobId,expiresAt:new Date(lease.rows[0].expires_at).toISOString()}};
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
      const body=jsonBody(request.body),leaseId=stringField(body.leaseId,'lease_id',160),leaseToken=stringField(body.leaseToken,'lease_token',256),supplied=recordField(body.result,'result');
      const status=stringField(supplied.status,'result_status',16) as JobResultInput['status'];
      if(!['completed','failed'].includes(status))throw new ControllerError(400,'INVALID_RESULT_STATUS','result status must be completed or failed');
      const completedAt=isoTimestamp(supplied.completedAt,'completed_at'),output=optionalRecord(supplied.output,'output'),evidence=evidenceField(supplied.evidence),failure=failureField(supplied.failure);
      if(status==='completed'&&!output)throw new ControllerError(400,'RESULT_OUTPUT_REQUIRED','completed result requires output object');
      if(status==='failed'&&!failure)throw new ControllerError(400,'RESULT_FAILURE_REQUIRED','failed result requires failure object');
      const result:JobResultInput={jobId,employeeId:auth.employeeId,deviceId:auth.deviceId,bindingId:auth.bindingId,status,output,evidence,completedAt,failure};
      const accepted=await this.service.submitResult({leaseId,leaseToken,result,acceptedAt:new Date(request.nowMs??Date.now()).toISOString()});
      return {status:200,body:{ok:true,result:accepted}};
    }

    throw new ControllerError(404,'NOT_FOUND','route not found');
  }

  private async status(nowMs:number):Promise<ControllerResponse>{
    const migration=await this.pool.query<{version:string}>(`SELECT version FROM tigeriq_schema_migrations WHERE version='001_operational_state_v1'`);
    if(migration.rows[0]?.version!=='001_operational_state_v1')return {status:503,body:{ok:false,controller:'TigerIQ Workforce Controller V1',postgres:false,migration:null}};
    const counts=await this.pool.query<{employees:string;devices:string;queued_jobs:string;active_leases:string}>(`SELECT (SELECT count(*) FROM employees)::text employees,(SELECT count(*) FROM devices)::text devices,(SELECT count(*) FROM jobs WHERE stage='queued')::text queued_jobs,(SELECT count(*) FROM leases WHERE status='active' AND expires_at>now())::text active_leases`);
    const row=counts.rows[0]??{employees:'0',devices:'0',queued_jobs:'0',active_leases:'0'};
    const pc01Rows=await this.pool.query<{employee_id:string;device_id:string;last_heartbeat_at:Date|string|null;health:string|null}>(`SELECT e.employee_id,d.device_id,d.last_heartbeat_at,h.health FROM employees e JOIN employee_device_bindings b ON b.employee_id=e.employee_id AND b.state='active' JOIN devices d ON d.device_id=b.device_id AND d.state='active' LEFT JOIN LATERAL (SELECT health FROM heartbeats WHERE employee_id=e.employee_id AND device_id=d.device_id ORDER BY observed_at DESC LIMIT 1) h ON true WHERE e.employee_id=$1 AND e.state='active' ORDER BY b.updated_at DESC LIMIT 1`,[PC01_EMPLOYEE_ID]);
    const pc01=pc01Rows.rows[0],heartbeatMs=pc01?.last_heartbeat_at?Date.parse(new Date(pc01.last_heartbeat_at).toISOString()):0,online=Boolean(pc01&&pc01.health==='ok'&&nowMs-heartbeatMs<=45_000);
    return {status:200,body:{ok:true,controller:'TigerIQ Workforce Controller V1',protocol:'controller-v1',postgres:true,migration:'001_operational_state_v1',workforce:{employees:Number(row.employees),devices:Number(row.devices),queuedJobs:Number(row.queued_jobs),activeLeases:Number(row.active_leases)},pc01:pc01?{employeeId:pc01.employee_id,deviceId:pc01.device_id,health:pc01.health??'unknown',lastHeartbeatAt:pc01.last_heartbeat_at?new Date(pc01.last_heartbeat_at).toISOString():null,online}:null}};
  }

  private errorResponse(error:unknown):ControllerResponse{
    if(error instanceof DeviceAuthError||error instanceof ControllerError)return {status:error.status,body:{ok:false,error:{code:error.code,message:error.message,retryable:error.retryable}}};
    const message=error instanceof Error?error.message:'controller unavailable',lower=message.toLowerCase();
    if(lower.includes('expired'))return {status:410,body:{ok:false,error:{code:'LEASE_EXPIRED',message,retryable:true}}};
    if(lower.includes('stale job lease')||lower.includes('invalid job lease token')||lower.includes('identity mismatch'))return {status:409,body:{ok:false,error:{code:'LEASE_REJECTED',message,retryable:false}}};
    if(lower.includes('duplicate result conflict')||lower.includes('idempotency conflict'))return {status:409,body:{ok:false,error:{code:'IDEMPOTENCY_CONFLICT',message,retryable:false}}};
    if(lower.includes('required')||lower.includes('invalid')||lower.includes('must be'))return {status:400,body:{ok:false,error:{code:'INVALID_REQUEST',message,retryable:false}}};
    return {status:503,body:{ok:false,error:{code:'CONTROLLER_UNAVAILABLE',message:'workforce controller unavailable',retryable:true}}};
  }
}
