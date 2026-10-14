import {projectCodingCoreHealth} from '../shared/coding-core-health-contract.mjs';

// Authoritative, bounded health snapshot for the Coding Lane.
// Only resource eligibility, observed functional outcomes and 7-day task
// performance; no objectives, prompts, full event data or integration probes.
// This does not create jobs, acquire leases, mutate Core DB state or expand
// any resource's eligibility. Shared leases are applied BEFORE projection.
export async function createCodingCoreHealthSnapshot({
  pool,nowIso,refreshWorkforce,activeLeases,indexLeases,
  normalizeResources,normalizeQuota,publicStatus,
}={}){
  if(!pool||typeof pool.query!=='function'||![nowIso,refreshWorkforce,activeLeases,indexLeases,normalizeResources,normalizeQuota,publicStatus].every(f=>typeof f==='function'))
    throw new Error('CODING_HEALTH_DEPENDENCY_MISSING');
  const {workforce}=await refreshWorkforce();
  const leases=await activeLeases(pool);
  const byLease=indexLeases(leases);
  const rows=(await pool.query('select * from tigeriq_ai_resources where enabled=true order by employee_id nulls last,resource_id')).rows;
  const withLeases=rows.map(row=>{
    const lease=byLease.get(String(row.resource_id||''))||null;
    return lease?{
      ...row,current_job_id:lease.work_id,work_state:'BUSY',
      shared_lease_lane:lease.lane,shared_lease_role:lease.role,
      shared_lease_work_id:lease.work_id,shared_lease_until:lease.lease_until,
    }:row;
  });
  const resources=normalizeResources(withLeases,workforce).map(r=>{
    const lease=byLease.get(String(r.resource_id||''))||null;
    const normalized=lease?{...r,current_job_id:lease.work_id,work_state:'BUSY'}:r;
    return {
      ...normalized,
      quota_state:normalizeQuota(normalized.quota_state||{}),
      status:lease?'BUSY':publicStatus(normalized),
    };
  });
  // Exact fields used by Coding Lane; no JSON event payloads or secret traces.
  const events=(await pool.query(
    "select ts,type,resource_id,employee_id from tigeriq_events where type in ('RESOURCE_SUCCESS','RESOURCE_PROBE_OK','RESOURCE_FAILURE','RESOURCE_PROBE_FAIL') order by seq desc limit 80"
  )).rows;
  const performanceByTask=(await pool.query(
    `select resource_id,coalesce(task_kind,'general') as task_kind,
      count(*) filter(where type in ('RESOURCE_SUCCESS','RESOURCE_PROBE_OK'))::int as success,
      count(*) filter(where type in ('RESOURCE_FAILURE','RESOURCE_PROBE_FAIL'))::int as failure,
      count(*) filter(where type='ROUTING_RETRY')::int as retries,
      count(*) filter(where type='ROUTING_FAILOVER')::int as failovers,
      round(avg((data->>'latencyMs')::numeric) filter(where data ? 'latencyMs'))::int as avg_latency_ms
      from tigeriq_events where resource_id is not null and ts>=now()-interval '7 days'
      group by resource_id,coalesce(task_kind,'general') order by resource_id,task_kind`
  )).rows;
  return projectCodingCoreHealth({
    ok:true,core:{time:nowIso()},resources,events,routing:{performanceByTask},
  });
}
