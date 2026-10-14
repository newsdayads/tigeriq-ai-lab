// Bounded, read-only Core -> Coding Lane health projection.
// This module does not expose HTTP routes or modify control-plane state.
// The Core and Coding Lane integration must be separately authorized and
// protected by their existing resource-lease and review gates.
const MAX_RESOURCES=64;
const MAX_EVENTS=96;
const MAX_PERFORMANCE=160;
const SIGNAL_TYPES=new Set(['RESOURCE_SUCCESS','RESOURCE_PROBE_OK','RESOURCE_FAILURE','RESOURCE_PROBE_FAIL']);

function safeString(value,max=150){
  if(typeof value!=='string'&&typeof value!=='number')return '';
  return String(value).slice(0,max);
}
function finiteInteger(value){
  const n=Number(value);
  return Number.isFinite(n)?Math.max(0,Math.floor(n)):0;
}
function projectionResource(r){
  const quota=r?.quota_state??r?.quotaState;
  return {
    employee_id:safeString(r?.employee_id??r?.employeeId??r?.id,24),
    resource_id:safeString(r?.resource_id??r?.resourceId,220),
    provider:safeString(r?.provider,80),
    model:safeString(r?.model,160),
    cost_tier:safeString(r?.cost_tier??r?.costTier,30),
    capabilities:Array.isArray(r?.capabilities)?r.capabilities.filter(x=>typeof x==='string').slice(0,12).map(x=>x.slice(0,45)):[],
    enabled:r?.enabled!==false,
    health_state:safeString(r?.health_state??r?.healthState,28),
    work_state:safeString(r?.work_state??r?.workState,28),
    status:safeString(r?.status,28),
    current_job_id:safeString(r?.current_job_id??r?.currentJobId,160)||null,
    cooldown_until:safeString(r?.cooldown_until??r?.cooldownUntil,52)||null,
    quota_state:{usable:quota?.usable!==false},
  };
}
function projectionEvent(e){
  const type=safeString(e?.type,48).toUpperCase();
  if(!SIGNAL_TYPES.has(type))return null;
  return {
    type,
    ts:safeString(e?.ts??e?.created_at??e?.createdAt,52),
    resource_id:safeString(e?.resource_id??e?.resourceId,220),
    employee_id:safeString(e?.employee_id??e?.employeeId,24),
  };
}
function projectionPerformance(row){
  return {
    resource_id:safeString(row?.resource_id??row?.resourceId,220),
    task_kind:safeString(row?.task_kind??row?.taskKind,64),
    success:finiteInteger(row?.success),
    failure:finiteInteger(row?.failure),
    retries:finiteInteger(row?.retries),
    failovers:finiteInteger(row?.failovers),
    avg_latency_ms:finiteInteger(row?.avg_latency_ms??row?.avgLatencyMs),
  };
}

/** Keep precisely the fields consumed by Coding Lane's existing health/ranking gate.
 * Missing Core health is always an error; never fabricate an ONLINE resource.
 * Caller must read from the authoritative Core, not GitHub or a stale UI cache.
 */
export function projectCodingCoreHealth(coreStatus,{generatedAt=null}={}){
  if(coreStatus?.ok!==true||!Array.isArray(coreStatus?.resources)){
    const error=new Error('CODING_CORE_HEALTH_SOURCE_INVALID');
    error.code='CODING_CORE_HEALTH_SOURCE_INVALID';
    throw error;
  }
  // Resource rows are security/lease eligibility gates, not best-effort telemetry.
  // Never accept a partial list: a later row can invalidate an earlier employee or lease.
  if(coreStatus.resources.length>MAX_RESOURCES){
    const error=new Error('CODING_CORE_HEALTH_RESOURCE_OVERFLOW');
    error.code=error.message;
    throw error;
  }
  const resources=coreStatus.resources.map(projectionResource);
  const employeeIds=new Set(),resourceIds=new Set();
  for(const r of resources){
    if(!r.employee_id||!r.resource_id||employeeIds.has(r.employee_id)||resourceIds.has(r.resource_id)){
      const error=new Error('CODING_CORE_HEALTH_RESOURCE_ID_INVALID');
      error.code=error.message;
      throw error;
    }
    employeeIds.add(r.employee_id);resourceIds.add(r.resource_id);
  }
  const events=(Array.isArray(coreStatus?.events)?coreStatus.events:[])
    .map(projectionEvent).filter(Boolean).slice(0,MAX_EVENTS);
  const performanceByTask=(Array.isArray(coreStatus?.routing?.performanceByTask)?coreStatus.routing.performanceByTask:[])
    .slice(0,MAX_PERFORMANCE).map(projectionPerformance).filter(r=>r.resource_id);
  return {
    ok:true,
    schema:'TIGERIQ_CODING_CORE_HEALTH_V1',
    generatedAt:generatedAt||safeString(coreStatus?.core?.time,52)||null,
    resources,
    events,
    routing:{performanceByTask},
  };
}

export const CODING_CORE_HEALTH_BOUNDS=Object.freeze({
  resources:MAX_RESOURCES,
  events:MAX_EVENTS,
  performance:MAX_PERFORMANCE,
});
