import type { SqlPoolLike } from '../../../packages/work-state/src/postgres-repository.js';

type EmployeeRow={employee_id:string;display_name:string;roles:string[];permissions:string[];capabilities:string[];employee_state:string;concurrency_limit:number;employee_heartbeat:Date|string|null;binding_id:string|null;device_id:string|null;platform:string|null;device_state:string|null;device_heartbeat:Date|string|null;health:string|null;heartbeat_metadata:Record<string,unknown>|null;observed_at:Date|string|null};
type ProviderRow={provider_id:string;provider:string;model:string;independence_key:string;state:string;last_heartbeat_at:Date|string|null;metadata:Record<string,unknown>};
type JobRow={job_id:string;title:string;objective:string;target_employee_id:string|null;preferred_provider_id:string|null;priority:string;stage:string;attempts:number;max_attempts:number;last_failure_code:string|null;created_at:Date|string;updated_at:Date|string};
type LeaseRow={lease_id:string;job_id:string;employee_id:string;device_id:string|null;binding_id:string|null;worker_kind:string;attempt:number;status:string;leased_at:Date|string;expires_at:Date|string};
type CountRow={stage:string;count:string};

function iso(value:Date|string|null):string|null{return value?new Date(value).toISOString():null;}
function fresh(value:Date|string|null,nowMs:number,staleAfterMs:number):boolean{if(!value)return false;const at=Date.parse(new Date(value).toISOString());return Number.isFinite(at)&&nowMs-at<=staleAfterMs;}

export async function buildRuntimeTruth(pool:SqlPoolLike,nowMs=Date.now(),staleAfterMs=45_000){
  const [employees,providers,jobs,leases,counts]=await Promise.all([
    pool.query<EmployeeRow>(`SELECT e.employee_id,e.display_name,e.roles,e.permissions,e.capabilities,e.state employee_state,e.concurrency_limit,e.last_heartbeat_at employee_heartbeat,b.binding_id,d.device_id,d.platform,d.state device_state,d.last_heartbeat_at device_heartbeat,h.health,h.metadata heartbeat_metadata,h.observed_at FROM employees e LEFT JOIN LATERAL (SELECT binding_id,device_id FROM employee_device_bindings WHERE employee_id=e.employee_id AND state='active' ORDER BY updated_at DESC LIMIT 1) b ON true LEFT JOIN devices d ON d.device_id=b.device_id LEFT JOIN LATERAL (SELECT health,metadata,observed_at FROM heartbeats WHERE employee_id=e.employee_id AND (device_id=d.device_id OR d.device_id IS NULL) ORDER BY observed_at DESC LIMIT 1) h ON true ORDER BY e.employee_id`),
    pool.query<ProviderRow>(`SELECT provider_id,provider,model,independence_key,state,last_heartbeat_at,metadata FROM ai_providers ORDER BY provider_id`),
    pool.query<JobRow>(`SELECT job_id,title,objective,target_employee_id,preferred_provider_id,priority,stage,attempts,max_attempts,last_failure_code,created_at,updated_at FROM jobs ORDER BY updated_at DESC,job_id DESC LIMIT 200`),
    pool.query<LeaseRow>(`SELECT lease_id,job_id,employee_id,device_id,binding_id,worker_kind,attempt,status,leased_at,expires_at FROM leases WHERE status='active' AND expires_at>now() ORDER BY leased_at`),
    pool.query<CountRow>(`SELECT stage,count(*)::text count FROM jobs GROUP BY stage ORDER BY stage`),
  ]);
  const employeeTruth=employees.rows.map(row=>{
    const heartbeatAt=row.observed_at??row.device_heartbeat??row.employee_heartbeat;
    const online=row.employee_state==='active'&&row.device_state==='active'&&row.health==='ok'&&fresh(heartbeatAt,nowMs,staleAfterMs);
    return {employeeId:row.employee_id,displayName:row.display_name,roles:row.roles,permissions:row.permissions,capabilities:row.capabilities,state:row.employee_state,concurrencyLimit:row.concurrency_limit,bindingId:row.binding_id,deviceId:row.device_id,platform:row.platform,deviceState:row.device_state,health:row.health??'unknown',heartbeatAt:iso(heartbeatAt),stale:!fresh(heartbeatAt,nowMs,staleAfterMs),online,metadata:row.heartbeat_metadata??{}};
  });
  const providerTruth=providers.rows.map(row=>({providerId:row.provider_id,provider:row.provider,model:row.model,independenceKey:row.independence_key,state:row.state,lastHeartbeatAt:iso(row.last_heartbeat_at),stale:row.last_heartbeat_at?!fresh(row.last_heartbeat_at,nowMs,staleAfterMs):true,metadata:row.metadata??{}}));
  const jobTruth=jobs.rows.map(row=>({jobId:row.job_id,title:row.title,objective:row.objective,targetEmployeeId:row.target_employee_id,preferredProviderId:row.preferred_provider_id,priority:row.priority,stage:row.stage,attempts:row.attempts,maxAttempts:row.max_attempts,lastFailureCode:row.last_failure_code,createdAt:iso(row.created_at),updatedAt:iso(row.updated_at)}));
  const leaseTruth=leases.rows.map(row=>({leaseId:row.lease_id,jobId:row.job_id,employeeId:row.employee_id,deviceId:row.device_id,bindingId:row.binding_id,workerKind:row.worker_kind,attempt:row.attempt,status:row.status,leasedAt:iso(row.leased_at),expiresAt:iso(row.expires_at)}));
  const stageCounts:Object=Object.fromEntries(counts.rows.map(row=>[row.stage,Number(row.count)]));
  const pc01=employeeTruth.find(row=>row.employeeId==='EMP-PC01-NATIVE')??null;
  return {ok:true,source:'workforce-controller-v1',protocol:'runtime-truth-v1',generatedAt:new Date(nowMs).toISOString(),staleAfterMs,postgres:true,queue:{queued:Number((stageCounts as Record<string,number>).queued??0),activeLeases:leaseTruth.length,stageCounts},pc01,employees:employeeTruth,providers:providerTruth,jobs:jobTruth,leases:leaseTruth};
}
