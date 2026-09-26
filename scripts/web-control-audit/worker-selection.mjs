const DEFAULT_CORE_STATUS_URL='http://100.97.23.87:8795/api/status';

export function isEligibleAuditResource(resource, now=Date.now()) {
  if(!resource || resource.enabled===false) return false;
  if(String(resource.health_state||'').toUpperCase()!=='ONLINE') return false;
  if(!['IDLE','READY'].includes(String(resource.work_state||'').toUpperCase())) return false;
  if(!['FREE','LOCAL'].includes(String(resource.cost_tier||'').toUpperCase())) return false;
  if(resource.quota_state?.usable===false) return false;
  if(resource.cooldown_until && Date.parse(resource.cooldown_until)>now) return false;
  const caps=Array.isArray(resource.capabilities)?resource.capabilities:[];
  return caps.length===0 || caps.some(cap=>['general','reasoning','review'].includes(String(cap).toLowerCase()));
}

export function normalizeAuditResource(resource) {
  return {
    employee_id:resource.employee_id,
    resource_id:resource.resource_id,
    name:resource.name||resource.employee_id,
    provider:resource.provider||null,
    model:resource.model||null,
    cost_tier:resource.cost_tier||null,
    rank:Number(resource.rank??999),
    capabilities:Array.isArray(resource.capabilities)?resource.capabilities:[]
  };
}

export async function selectIdleWorkers({fetchImpl=fetch,statusUrl=DEFAULT_CORE_STATUS_URL,now=Date.now()}={}) {
  const res=await fetchImpl(statusUrl,{headers:{accept:'application/json'},cache:'no-store'});
  if(!res.ok) throw new Error(`CORE_STATUS_HTTP_${res.status||'ERROR'}`);
  const data=await res.json();
  const eligible=(Array.isArray(data.resources)?data.resources:[])
    .filter(resource=>isEligibleAuditResource(resource,now))
    .sort((a,b)=>Number(a.rank??999)-Number(b.rank??999)||String(a.employee_id||'').localeCompare(String(b.employee_id||'')));
  if(eligible.length===0) throw new Error('NO_IDLE_READY_ZERO_COST_AUDIT_RESOURCE');
  return eligible.map(normalizeAuditResource);
}

export async function selectIdleWorker(options={}) {
  const workers=await selectIdleWorkers(options);
  return workers[0];
}
