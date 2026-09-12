import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';

const DEFAULT_INTERVAL_MS=15000;
const DEFAULT_STALE_MS=45*60*1000;
const DEFAULT_MAX_JOBS_PER_OBJECTIVE=3;
const RETRYABLE_FAILURES=new Set(['CI_GATES_FAILED','CI_GATES_TIMEOUT']);
const GH_OWNER=process.env.TIGERIQ_GITHUB_OWNER||'newsdayads';
const GH_REPO=process.env.TIGERIQ_GITHUB_REPO||'tigeriq-ai-lab';

export function isRetryableFailure(message){return RETRYABLE_FAILURES.has(String(message||''));}
export function shouldRetry(totalJobs,maxJobs=DEFAULT_MAX_JOBS_PER_OBJECTIVE){return Number(totalJobs)<Number(maxJobs);}
export function isStaleJob(job,now=Date.now(),staleMs=DEFAULT_STALE_MS){
  if(!job||!['running','waiting_ci','review'].includes(job.status))return false;
  const t=Date.parse(job.started_at||job.created_at||'');
  return Number.isFinite(t)&&now-t>staleMs;
}
export function extractGitHubIssueNumber(text){
  const s=String(text||'');
  const tagged=s.match(/GitHub autonomous coding issue #(\d+)/i);
  if(tagged)return Number(tagged[1]);
  const url=s.match(/github\.com\/[^/]+\/[^/]+\/issues\/(\d+)/i);
  return url?Number(url[1]):null;
}
export function repairInstruction(job,reason,cycle){
  const detail=typeof job.failure==='object'&&job.failure?JSON.stringify(job.failure):String(job.failure||'');
  return `${job.instruction}\n\nAUTONOMOUS_REPAIR_CYCLE=${cycle}\nPREVIOUS_FAILURE=${reason}\nPREVIOUS_FAILURE_DETAIL=${detail.slice(0,3000)}\nRegenerate the implementation from current main, keep the same allowed paths, and explicitly fix the previous failure. Do not broaden scope.`;
}

async function ensureSchema(pool){
  await pool.query(`create table if not exists tigeriq_coding_watchdog_events(
    id bigserial primary key,
    kind text not null,
    payload jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
  )`);
}
async function emit(pool,kind,payload){
  await pool.query('insert into tigeriq_coding_watchdog_events(kind,payload) values($1,$2)',[kind,JSON.stringify(payload)]);
  console.log(JSON.stringify({event:'CODING_AUTONOMY_WATCHDOG',kind,...payload}));
}
async function githubIssueIsOpen(issueNumber,fetchImpl=fetch){
  const token=(process.env.TIGERIQ_GITHUB_TOKEN||process.env.GITHUB_TOKEN||'').trim();
  if(!token||!issueNumber)return false;
  try{
    const res=await fetchImpl(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/issues/${issueNumber}`,{headers:{accept:'application/vnd.github+json',authorization:`Bearer ${token}`,'user-agent':'TigerIQ-Autonomy-Supervisor/1.0'},signal:AbortSignal.timeout(10000)});
    if(!res.ok)return false;
    const body=await res.json();
    return body?.state==='open'&&!body?.pull_request;
  }catch{return false;}
}
async function objectiveIsEligible(pool,objectiveId,fetchImpl=fetch){
  const q=await pool.query('select objective from tigeriq_coding_objectives where id=$1',[objectiveId]);
  const issueNumber=extractGitHubIssueNumber(q.rows[0]?.objective);
  return {eligible:await githubIssueIsOpen(issueNumber,fetchImpl),issueNumber};
}
async function countObjectiveJobs(pool,objectiveId){
  const q=await pool.query('select count(*)::int n from tigeriq_coding_jobs where objective_id=$1',[objectiveId]);
  return Number(q.rows[0]?.n||0);
}
async function hasActiveJob(pool,objectiveId,excludeId=null){
  const q=await pool.query("select 1 from tigeriq_coding_jobs where objective_id=$1 and status in ('queued','running','waiting_ci','review') and ($2::text is null or id<>$2) limit 1",[objectiveId,excludeId]);
  return Boolean(q.rows[0]);
}
async function queueRetry(pool,job,reason,maxJobs){
  const total=await countObjectiveJobs(pool,job.objective_id);
  if(!shouldRetry(total,maxJobs)){
    await pool.query("update tigeriq_coding_objectives set status='blocked',summary=$2,updated_at=now() where id=$1",[job.objective_id,`AUTO_REPAIR_EXHAUSTED:${reason}`]);
    await emit(pool,'BLOCKED',{objectiveId:job.objective_id,jobId:job.id,reason,totalJobs:total});
    return false;
  }
  if(await hasActiveJob(pool,job.objective_id,job.id))return false;
  const retryId=`CODE-${randomUUID()}`;
  const cycle=total+1;
  const paths=Array.isArray(job.paths)?job.paths:[];
  await pool.query('insert into tigeriq_coding_jobs(id,objective_id,title,instruction,paths,status) values($1,$2,$3,$4,$5,\'queued\')',[
    retryId,job.objective_id,`${String(job.title||'Coding job').slice(0,140)} [repair ${cycle}]`,repairInstruction(job,reason,cycle),JSON.stringify(paths)
  ]);
  await pool.query("update tigeriq_coding_objectives set status='active',summary=$2,updated_at=now() where id=$1",[job.objective_id,`AUTO_REPAIR_QUEUED:${retryId}:${reason}`]);
  await emit(pool,'RETRY_QUEUED',{objectiveId:job.objective_id,sourceJobId:job.id,retryJobId:retryId,reason,cycle});
  return true;
}
async function handleFailed(pool,maxJobs){
  const q=await pool.query("select * from tigeriq_coding_jobs where status='failed' and coalesce(failure->>'supervisorHandled','false')<>'true' order by completed_at nulls last,created_at limit 10");
  for(const job of q.rows){
    const reason=String(job.failure?.message||'');
    if(!isRetryableFailure(reason))continue;
    const gate=await objectiveIsEligible(pool,job.objective_id);
    await pool.query("update tigeriq_coding_jobs set failure=coalesce(failure,'{}'::jsonb)||'{\"supervisorHandled\":true}'::jsonb where id=$1",[job.id]);
    if(!gate.eligible){await emit(pool,'REPAIR_SKIPPED',{objectiveId:job.objective_id,jobId:job.id,reason:'ISSUE_NOT_OPEN',issueNumber:gate.issueNumber});continue;}
    await queueRetry(pool,job,reason,maxJobs);
  }
}
async function handleStale(pool,staleMs,maxJobs,onStall){
  const q=await pool.query("select * from tigeriq_coding_jobs where status in ('running','waiting_ci','review') order by coalesce(started_at,created_at) limit 20");
  for(const job of q.rows){
    if(!isStaleJob(job,Date.now(),staleMs))continue;
    const gate=await objectiveIsEligible(pool,job.objective_id);
    if(!gate.eligible)continue;
    const reason='STALL_TIMEOUT';
    await pool.query("update tigeriq_coding_jobs set status='failed',failure=$2,completed_at=now() where id=$1",[job.id,JSON.stringify({message:reason,supervisorHandled:true,previousStatus:job.status})]);
    const queued=await queueRetry(pool,job,reason,maxJobs);
    await emit(pool,'STALL_DETECTED',{objectiveId:job.objective_id,jobId:job.id,previousStatus:job.status,retryQueued:queued,issueNumber:gate.issueNumber});
    if(typeof onStall==='function')onStall({job,retryQueued:queued});
    return true;
  }
  return false;
}

export function startAutonomySupervisor(options={}){
  const databaseUrl=options.databaseUrl||process.env.DATABASE_URL?.trim();
  if(!databaseUrl)return {stop:async()=>{}};
  const pool=options.pool||new Pool({connectionString:databaseUrl,max:2});
  const intervalMs=Number(options.intervalMs||process.env.TIGERIQ_AUTONOMY_WATCHDOG_INTERVAL_MS||DEFAULT_INTERVAL_MS);
  const staleMs=Number(options.staleMs||process.env.TIGERIQ_CODING_STALE_MS||DEFAULT_STALE_MS);
  const maxJobs=Number(options.maxJobs||process.env.TIGERIQ_AUTOREPAIR_MAX_JOBS||DEFAULT_MAX_JOBS_PER_OBJECTIVE);
  let stopped=false,busy=false;
  const onStall=options.onStall||(()=>{setTimeout(()=>process.exit(75),250).unref?.();});
  const tick=async()=>{
    if(stopped||busy)return;
    busy=true;
    try{await ensureSchema(pool);await handleFailed(pool,maxJobs);await handleStale(pool,staleMs,maxJobs,onStall);}catch(error){console.error(JSON.stringify({event:'CODING_AUTONOMY_WATCHDOG_ERROR',error:String(error?.message||error)}));}finally{busy=false;}
  };
  const timer=setInterval(()=>void tick(),Math.max(5000,intervalMs));
  timer.unref?.();
  setTimeout(()=>void tick(),5000).unref?.();
  return {stop:async()=>{stopped=true;clearInterval(timer);if(!options.pool)await pool.end();}};
}
