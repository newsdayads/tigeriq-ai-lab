const CORE_IDLE_FROM="const MANAGER_IDLE_MS = Number(process.env.TIGERIQ_MANAGER_IDLE_MS || 5000);";
const CORE_IDLE_TO="const MANAGER_IDLE_MS = Math.max(500, Number(process.env.TIGERIQ_MANAGER_IDLE_MS || 1000));\nconst MANAGER_MAX_JOBS = Math.max(1, Math.min(6, Number(process.env.TIGERIQ_MANAGER_MAX_JOBS || 6)));";
const CORE_SCHEMA_FROM="      maxItems:3,";
const CORE_SCHEMA_TO="      maxItems:MANAGER_MAX_JOBS,";
const CORE_POOL_FROM="const pool = new Pool({ connectionString: DATABASE_URL, max: 4 });";
const CORE_POOL_TO="const pool = new Pool({ connectionString: DATABASE_URL, max: Math.max(4, Math.min(20, Number(process.env.TIGERIQ_CORE_DB_POOL_MAX || 12))) });";
const CORE_PROMPT_FROM="Maximum 3 jobs.";
const CORE_PROMPT_TO="Maximum ${MANAGER_MAX_JOBS} jobs.";
const CORE_PARALLEL_FROM=`let stop=false, lastRefresh=0, lastRecover=0, lastOpenClawObjectiveReconcile=0, lastManager=0, lastProbe=0, lastFailureLearning=0, lastApiDoctor=0, apiDoctorScanRunning=false, managerTickRunning=false; const active=new Set();
function getDynamicMaxParallel() {
  const resList = typeof resources !== 'undefined' ? resources : [];
  const healthyCount = Array.isArray(resList) ? resList.filter(r => r && (r.status === 'ready' || r.status === 'healthy' || r.healthy || r.health_state === 'READY' || r.health_state === 'ONLINE' || r.credential_state === 'LOCAL')).length : 0;
  return Math.max(3, Math.min(20, healthyCount));
}`;
const CORE_PARALLEL_TO=`let stop=false, lastRefresh=0, lastRecover=0, lastOpenClawObjectiveReconcile=0, lastManager=0, lastProbe=0, lastFailureLearning=0, lastApiDoctor=0, apiDoctorScanRunning=false, managerTickRunning=false; const active=new Set();
let liveHealthyResourceCount=3;
function getDynamicMaxParallel() {
  return Math.max(3, Math.min(20, liveHealthyResourceCount));
}`;
const CORE_REFRESH_FROM=`    if(r.provider==='openclaw')await pool.query("update tigeriq_ai_resources set enabled=$2,credential_state='LOCAL',health_state=$3,work_state=case when current_job_id is null then $4 else 'BUSY' end,updated_at=now() where resource_id=$1",[r.resourceId,openClawResourceActivated(),health,health==='ONLINE'?'IDLE':'OFFLINE']);
  }
}`;
const CORE_REFRESH_TO=`    if(r.provider==='openclaw')await pool.query("update tigeriq_ai_resources set enabled=$2,credential_state='LOCAL',health_state=$3,work_state=case when current_job_id is null then $4 else 'BUSY' end,updated_at=now() where resource_id=$1",[r.resourceId,openClawResourceActivated(),health,health==='ONLINE'?'IDLE':'OFFLINE']);
  }
  const liveCapacity=(await pool.query(\`select count(*)::int as count from tigeriq_ai_resources where enabled=true and credential_state in ('LOCAL','READY') and health_state in ('READY','ONLINE') and (cooldown_until is null or cooldown_until<=now())\`)).rows[0]?.count||0;
  liveHealthyResourceCount=Math.max(0,Number(liveCapacity)||0);
}`;

function replaceOnce(source,from,to,label){
  const first=source.indexOf(from);
  if(first<0)throw new Error('CORE_THROUGHPUT_PATCH_MISSING:'+label);
  if(source.indexOf(from,first+from.length)>=0)throw new Error('CORE_THROUGHPUT_PATCH_AMBIGUOUS:'+label);
  return source.slice(0,first)+to+source.slice(first+from.length);
}

export function parallelLimitFromHealthyCount(value){
  const n=Math.max(0,Math.trunc(Number(value)||0));
  return Math.max(3,Math.min(20,n));
}

export function transformCoreSource(value){
  let source=String(value??'');
  source=replaceOnce(source,CORE_IDLE_FROM,CORE_IDLE_TO,'manager_idle');
  source=replaceOnce(source,CORE_SCHEMA_FROM,CORE_SCHEMA_TO,'manager_schema');
  source=replaceOnce(source,CORE_POOL_FROM,CORE_POOL_TO,'db_pool');
  source=replaceOnce(source,CORE_PROMPT_FROM,CORE_PROMPT_TO,'manager_prompt');
  source=replaceOnce(source,CORE_PARALLEL_FROM,CORE_PARALLEL_TO,'parallel_limit');
  source=replaceOnce(source,CORE_REFRESH_FROM,CORE_REFRESH_TO,'live_capacity_refresh');
  return source;
}

export function transformManagerJsonSource(value){
  let source=String(value??'');
  source=replaceOnce(source,"function managerError(code,cause){const error=new Error(code);error.code=code;error.kind='invalid_response';if(cause)error.cause=cause;return error;}","function managerError(code,cause){const error=new Error(code);error.code=code;error.kind='invalid_response';if(cause)error.cause=cause;return error;}\nconst MAX_MANAGER_JOBS=Math.max(1,Math.min(6,Number(process.env.TIGERIQ_MANAGER_MAX_JOBS||6)));",'manager_json_limit');
  source=replaceOnce(source,"value.jobs.length > 3","value.jobs.length > MAX_MANAGER_JOBS",'manager_json_validate');
  source=replaceOnce(source,"value.jobs.slice(0, 3)","value.jobs.slice(0, MAX_MANAGER_JOBS)",'manager_json_slice');
  return source;
}
