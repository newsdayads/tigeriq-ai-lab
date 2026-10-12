// Fast Core -> Coding Lane health response gate. No network or mutation side effects.
// A malformed/stale endpoint must never make an unavailable AI eligible for work.
export const CODING_FAST_HEALTH_SCHEMA='TIGERIQ_CODING_CORE_HEALTH_V1';

function reject(code){const error=new Error(code);error.code=code;throw error}
function nonempty(value,max){return typeof value==='string'&&value.trim().length>0&&value.length<=max}

export function validateCodingFastHealthResponse(payload,{nowMs=Date.now(),maxAgeMs=15_000,maxFutureMs=5_000}={}){
  if(payload?.ok!==true||payload?.schema!==CODING_FAST_HEALTH_SCHEMA||
     !Array.isArray(payload.resources)||!Array.isArray(payload.events)||
     !Array.isArray(payload.routing?.performanceByTask))reject('CODING_CORE_HEALTH_RESPONSE_INVALID');
  const at=Date.parse(String(payload.generatedAt||''));
  if(!Number.isFinite(at)||at>nowMs+maxFutureMs||nowMs-at>maxAgeMs)
    reject('CODING_CORE_HEALTH_RESPONSE_STALE');
  if(payload.resources.length>64||payload.events.length>96||payload.routing.performanceByTask.length>160)
    reject('CODING_CORE_HEALTH_RESPONSE_OVERFLOW');
  const employees=new Set(),ids=new Set();
  for(const r of payload.resources){
    if(!r||!nonempty(r.employee_id,24)||!nonempty(r.resource_id,220)||
       employees.has(r.employee_id)||ids.has(r.resource_id)||
       typeof r.enabled!=='boolean'||typeof r.quota_state?.usable!=='boolean'||
       !(r.current_job_id===null||typeof r.current_job_id==='string'))
      reject('CODING_CORE_HEALTH_RESOURCE_INVALID');
    employees.add(r.employee_id);ids.add(r.resource_id);
    const health=String(r.health_state||'').toUpperCase();
    const work=String(r.work_state||'').toUpperCase();
    const status=String(r.status||'').toUpperCase();
    // Only coherent ready/idle/on-demand pairs may be eligible downstream.
    // Keep valid BUSY or ERROR records: downstream must still reject them.
    const readyOnline=health==='ONLINE'&&work==='IDLE'&&status==='IDLE';
    // Core's publicStatus returns READY for a healthy READY/READY resource.
    // Do not reject this canonical idle state or promote UNKNOWN to READY.
    const readyStandby=health==='READY'&&work==='READY'&&status==='READY';
    const readyOnDemand=(health==='ONLINE'&&work==='ON_DEMAND'&&status==='ON_DEMAND')||
                        (health==='READY'&&work==='ON_DEMAND'&&status==='READY');
    const busyOnline=health==='ONLINE'&&work==='BUSY'&&status==='BUSY';
    if((status==='READY'||status==='IDLE'||health==='ONLINE')&&
       !(readyOnline||readyStandby||readyOnDemand||busyOnline))
      reject('CODING_CORE_HEALTH_RESOURCE_INVALID');
    if((readyOnline||readyStandby||readyOnDemand)&&(!r.enabled||!r.quota_state.usable||r.current_job_id))
      reject('CODING_CORE_HEALTH_RESOURCE_INVALID');
  }
  return payload;
}
