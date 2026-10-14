// Read-only PostgreSQL source for B03 Core -> Coding Lane health.
// Source helper only: does not register an HTTP endpoint or mutate Core controls.
import {projectCodingCoreHealth} from './coding-core-health-contract.mjs';
import {validateCodingFastHealthResponse} from './coding-core-health-response.mjs';

export const CODING_HEALTH_RESOURCE_SQL=`select
  r.employee_id,r.resource_id,r.provider,r.model,r.cost_tier,r.capabilities,r.enabled,
  r.credential_state,r.health_state,r.work_state,r.current_job_id,r.cooldown_until,r.quota_state,
  l.work_id as active_shared_lease_work_id
from tigeriq_ai_resources r
left join tigeriq_ai_resource_leases l
  on l.resource_id=r.resource_id and l.lease_until>now()
where r.enabled=true
order by r.employee_id nulls last,r.resource_id
limit 65`;

export const CODING_HEALTH_EVENTS_SQL=`select ts,type,resource_id,employee_id
from tigeriq_events
where resource_id is not null
  and type in ('RESOURCE_SUCCESS','RESOURCE_PROBE_OK','RESOURCE_FAILURE','RESOURCE_PROBE_FAIL')
order by seq desc
limit 96`;

export const CODING_HEALTH_PERFORMANCE_SQL=`select resource_id,coalesce(task_kind,'general') as task_kind,
  count(*) filter(where type in ('RESOURCE_SUCCESS','RESOURCE_PROBE_OK'))::int as success,
  count(*) filter(where type in ('RESOURCE_FAILURE','RESOURCE_PROBE_FAIL'))::int as failure,
  count(*) filter(where type='ROUTING_RETRY')::int as retries,
  count(*) filter(where type='ROUTING_FAILOVER')::int as failovers,
  round(avg((data->>'latencyMs')::numeric) filter(where data ? 'latencyMs'))::int as avg_latency_ms
from tigeriq_events
where resource_id is not null and ts>=now()-interval '7 days'
group by resource_id,coalesce(task_kind,'general')
order by resource_id,task_kind
limit 161`;

function error(code){const e=new Error(code);e.code=code;throw e}
function rowsOf(result){if(!Array.isArray(result?.rows))error('CODING_CORE_HEALTH_SQL_RESPONSE_INVALID');return result.rows}

// Keep the existing Core publicStatus ordering: credentials, busy lease,
// explicit failure, on-demand, idle, standby. Unknown states are rejected by
// the separate response validator; never infer ONLINE from credentials.
export function statusFromCoreResource(row){
  if(row?.enabled===false)return 'DISABLED';
  if(row?.credential_state==='WAIT_KEY')return 'WAIT_KEY';
  if(row?.current_job_id||row?.work_state==='BUSY')return 'BUSY';
  if(row?.health_state==='RATE_LIMITED')return 'RATE_LIMITED';
  if(row?.health_state==='ERROR')return 'ERROR';
  if(row?.health_state==='OFFLINE')return 'OFFLINE';
  if(row?.work_state==='ON_DEMAND')return 'ON_DEMAND';
  if(row?.health_state==='ONLINE')return 'IDLE';
  return 'READY';
}

export async function readCodingHealthFromPostgres(db,{now=()=>new Date()}={}){
  if(typeof db?.query!=='function')error('CODING_CORE_HEALTH_DB_UNAVAILABLE');
  // This ONE SQL statement joins resource state with active shared leases:
  // separate READ COMMITTED SELECTs can race and produce a false idle AI.
  const raw=rowsOf(await db.query(CODING_HEALTH_RESOURCE_SQL));
  if(raw.length>64)error('CODING_CORE_HEALTH_RESOURCE_OVERFLOW');
  const resources=raw.map(r=>{
    const activeWork=String(r?.active_shared_lease_work_id||'').trim();
    const resource={...r,current_job_id:activeWork||r?.current_job_id||null,
      work_state:activeWork?'BUSY':r?.work_state};
    resource.status=statusFromCoreResource(resource);
    return resource;
  });
  const events=rowsOf(await db.query(CODING_HEALTH_EVENTS_SQL));
  const performanceByTask=rowsOf(await db.query(CODING_HEALTH_PERFORMANCE_SQL));
  if(events.length>96||performanceByTask.length>160)
    error('CODING_CORE_HEALTH_EVIDENCE_OVERFLOW');
  const generatedAt=now().toISOString();
  const projected=projectCodingCoreHealth({ok:true,resources,events,
    routing:{performanceByTask}},{generatedAt});
  return validateCodingFastHealthResponse(projected,{nowMs:Date.parse(generatedAt)});
}
