import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {nv02WorkOrderMeta,nv02PrioritySummary} from '../tigeriq-core/nv02-local-self-pull.mjs';

const DEFAULT_INTERVAL_MS=15000;
const DEFAULT_STALE_MS=45*60*1000;
const DEFAULT_MAX_JOBS_PER_OBJECTIVE=3;
const RETRYABLE_FAILURES=new Set(['CI_GATES_FAILED','CI_GATES_TIMEOUT','REVIEW_CHANGES_UNRESOLVED','STALL_TIMEOUT','OUTPUT_CONTRACT_EXHAUSTED','CODING_COMPACT_EDIT_INVALID','CODING_COMPACT_EDITS_COUNT_INVALID','CODING_COMPACT_EDIT_OLD_NOT_FOUND','CODING_COMPACT_EDIT_OLD_NOT_UNIQUE']);
const GH_OWNER=process.env.TIGERIQ_GITHUB_OWNER||'newsdayads';
const GH_REPO=process.env.TIGERIQ_GITHUB_REPO||'tigeriq-ai-lab';

export function normalizeRepairFailure(message){
  const raw=String(message||'').trim();
  if(/REVIEW_CHANGES_UNRESOLVED|REVIEW_NOT_APPROVED/.test(raw))return 'REVIEW_CHANGES_UNRESOLVED';
  if(/CI_GATE_REPAIR_EXHAUSTED|CI_GATES_FAILED/.test(raw))return 'CI_GATES_FAILED';
  if(/OUTPUT_CONTRACT_EXHAUSTED/.test(raw))return 'OUTPUT_CONTRACT_EXHAUSTED';
  if(/CI_GATES_TIMEOUT/.test(raw))return 'CI_GATES_TIMEOUT';
  if(/CODING_COMPACT_EDITS_COUNT_INVALID/.test(raw))return 'CODING_COMPACT_EDITS_COUNT_INVALID';
  if(/CODING_COMPACT_EDIT_OLD_NOT_FOUND/.test(raw))return 'CODING_COMPACT_EDIT_OLD_NOT_FOUND';
  if(/CODING_COMPACT_EDIT_INVALID/.test(raw))return 'CODING_COMPACT_EDIT_INVALID';
  if(/STALL_TIMEOUT|\bSTALL\b/.test(raw))return 'STALL_TIMEOUT';
  return raw.split(':')[0]||'UNKNOWN_FAILURE';
}
export function isRetryableFailure(message){return RETRYABLE_FAILURES.has(normalizeRepairFailure(message));}
export function shouldRetry(totalJobs,maxJobs=DEFAULT_MAX_JOBS_PER_OBJECTIVE){return Number(totalJobs)<Number(maxJobs);}
export function repairJobTitle(title,cycle){
  const base=String(title||'Công việc Coding').replace(/(?:\s+\[(?:repair|sửa lần)\s*\d+\])+$/i,'').trim();
  return `${base} [sửa lần ${Math.max(1,Number(cycle)||1)}]`.slice(0,180);
}
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
export function retryResumeIdentity(job){
  const branch=String(job?.branch||'').trim();
  const prNumber=Number(job?.pr_number||0);
  if(!branch||!Number.isInteger(prNumber)||prNumber<=0)return {branch:null,prNumber:null,headSha:null};
  return {branch,prNumber,headSha:String(job?.head_sha||'').trim()||null};
}
export function retryResumeState(job){
  const identity=retryResumeIdentity(job);
  const liveGithubContext=job?.live_github_context&&typeof job.live_github_context==='object'?job.live_github_context:null;
  const liveGithubContextFingerprint=String(job?.live_github_context_fingerprint||'').trim()||null;
  return {...identity,liveGithubContext,liveGithubContextFingerprint};
}
export function repairInstruction(job,reason,cycle){
  const detail=typeof job.failure==='object'&&job.failure?JSON.stringify(job.failure):String(job.failure||'');
  const resume=retryResumeIdentity(job);
  const source=resume.prNumber?`the existing PR #${resume.prNumber} branch`:'current main';
  return `${job.instruction}\n\nAUTONOMOUS_REPAIR_CYCLE=${cycle}\nPREVIOUS_FAILURE=${reason}\nPREVIOUS_FAILURE_DETAIL=${detail.slice(0,3000)}\nRegenerate the implementation from ${source}, keep the same allowed paths, and explicitly fix the previous failure. Do not broaden scope.`;
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
export function autonomyGithubReceiptBody({issueNumber,sourceEventId,objectiveId,sourceJobId,retryJobId,reason,cycle,retryEventCount=1}={}){
  const issue=Math.max(1,Number(issueNumber)||0);
  const count=Math.max(0,Number(retryEventCount)||0);
  const fields={sourceEventId,objectiveId,sourceJobId,retryJobId,reason};
  if(!issue||Object.values(fields).some(v=>!String(v||'').trim()))throw Error('CODING_AUTONOMY_RECEIPT_INVALID');
  return [
    '[TIGERIQ_CODING_AUTONOMY_RECEIPT_V1]',
    `WORK_ORDER=#${issue}`,
    `SOURCE_EVENT_ID=${String(sourceEventId)}`,
    `OBJECTIVE_ID=${String(objectiveId)}`,
    `SOURCE_JOB_ID=${String(sourceJobId)}`,
    `RETRY_JOB_ID=${String(retryJobId)}`,
    `EVENT=${String(reason)}`,
    `REASON=${String(reason)}`,
    `CYCLE=${Math.max(1,Number(cycle)||1)}`,
    'RETRY_QUEUED=true',
    `RETRY_EVENT_COUNT=${count}`,
    `NO_DUPLICATE_REPAIR=${count===1?'true':'false'}`,
  ].join('\n');
}
async function githubIssueComments(issueNumber,fetchImpl=fetch){
  const token=(process.env.TIGERIQ_GITHUB_TOKEN||process.env.GITHUB_TOKEN||'').trim();
  if(!token)return {ok:false,reason:'GITHUB_TOKEN_MISSING',comments:[]};
  try{
    const res=await fetchImpl(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/issues/${issueNumber}/comments?per_page=100&sort=created&direction=desc`,{
      headers:{accept:'application/vnd.github+json',authorization:`Bearer ${token}`,'user-agent':'TigerIQ-Autonomy-Supervisor/1.0'},
      signal:AbortSignal.timeout(10000),
    });
    if(!res.ok)return {ok:false,reason:`GITHUB_COMMENTS_HTTP_${res.status}`,comments:[]};
    const comments=await res.json();
    return {ok:true,comments:Array.isArray(comments)?comments:[]};
  }catch(error){return {ok:false,reason:'GITHUB_COMMENTS_FETCH_FAILED',error:String(error?.message||error),comments:[]};}
}
async function postGithubIssueComment(issueNumber,body,fetchImpl=fetch){
  const token=(process.env.TIGERIQ_GITHUB_TOKEN||process.env.GITHUB_TOKEN||'').trim();
  if(!token)return {ok:false,reason:'GITHUB_TOKEN_MISSING'};
  try{
    const res=await fetchImpl(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/issues/${issueNumber}/comments`,{
      method:'POST',
      headers:{accept:'application/vnd.github+json',authorization:`Bearer ${token}`,'content-type':'application/json','user-agent':'TigerIQ-Autonomy-Supervisor/1.0'},
      body:JSON.stringify({body}),
      signal:AbortSignal.timeout(10000),
    });
    if(!res.ok)return {ok:false,reason:`GITHUB_COMMENT_HTTP_${res.status}`};
    const out=await res.json();
    return {ok:true,url:String(out?.html_url||'')||null};
  }catch(error){return {ok:false,reason:'GITHUB_COMMENT_POST_FAILED',error:String(error?.message||error)};}
}
export async function backfillGithubRetryReceipts(pool,{fetchImpl=fetch,limit=10}={}){
  const cap=Math.max(1,Math.min(50,Number(limit)||10));
  const q=await pool.query(`
    select e.id,e.payload,o.objective
    from tigeriq_coding_watchdog_events e
    left join tigeriq_coding_objectives o on o.id=e.payload->>'objectiveId'
    where e.kind='RETRY_QUEUED'
      and e.payload->>'reason'='CI_GATES_FAILED'
      and not exists (
        select 1 from tigeriq_coding_watchdog_events ack
        where ack.kind='GITHUB_RECEIPT_POSTED'
          and ack.payload->>'sourceEventId'=e.id::text
      )
    order by e.id desc
    limit $1`,[cap]);
  let posted=0,existing=0,failed=0;
  for(const row of q.rows||[]){
    const payload=row?.payload&&typeof row.payload==='object'?row.payload:{};
    const issueNumber=extractGitHubIssueNumber(row?.objective);
    const sourceEventId=String(row?.id||'').trim();
    if(!issueNumber||!sourceEventId){
      failed++;
      await emit(pool,'GITHUB_RECEIPT_FAILED',{sourceEventId:sourceEventId||null,objectiveId:payload.objectiveId||null,reason:'ISSUE_OR_EVENT_ID_MISSING'});
      continue;
    }
    const countQ=await pool.query(
      "select count(*)::int n from tigeriq_coding_watchdog_events where kind='RETRY_QUEUED' and payload->>'objectiveId'=$1 and payload->>'reason'=$2",
      [String(payload.objectiveId||''),String(payload.reason||'')]
    );
    const retryEventCount=Number(countQ.rows?.[0]?.n||0);
    const body=autonomyGithubReceiptBody({issueNumber,sourceEventId,retryEventCount,...payload});
    const comments=await githubIssueComments(issueNumber,fetchImpl);
    if(!comments.ok){
      failed++;
      await emit(pool,'GITHUB_RECEIPT_FAILED',{sourceEventId,objectiveId:payload.objectiveId||null,issueNumber,reason:comments.reason});
      continue;
    }
    const marker=`SOURCE_EVENT_ID=${sourceEventId}`;
    const prior=comments.comments.find(c=>String(c?.body||'').includes('[TIGERIQ_CODING_AUTONOMY_RECEIPT_V1]')&&String(c?.body||'').includes(marker));
    if(prior){
      existing++;
      await emit(pool,'GITHUB_RECEIPT_POSTED',{sourceEventId,objectiveId:payload.objectiveId||null,issueNumber,existing:true,url:String(prior?.html_url||'')||null});
      continue;
    }
    const result=await postGithubIssueComment(issueNumber,body,fetchImpl);
    if(!result.ok){
      failed++;
      await emit(pool,'GITHUB_RECEIPT_FAILED',{sourceEventId,objectiveId:payload.objectiveId||null,issueNumber,reason:result.reason});
      continue;
    }
    posted++;
    await emit(pool,'GITHUB_RECEIPT_POSTED',{sourceEventId,objectiveId:payload.objectiveId||null,issueNumber,existing:false,url:result.url});
  }
  return {posted,existing,failed};
}
export async function githubIssueIsOpen(issueNumber,fetchImpl=fetch){
  const token=(process.env.TIGERIQ_GITHUB_TOKEN||process.env.GITHUB_TOKEN||'').trim();
  if(!token||!issueNumber)return false;
  try{
    const res=await fetchImpl(`https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/issues/${issueNumber}`,{headers:{accept:'application/vnd.github+json',authorization:`Bearer ${token}`,'user-agent':'TigerIQ-Autonomy-Supervisor/1.0'},signal:AbortSignal.timeout(10000)});
    if(!res.ok)return false;
    const body=await res.json();
    if(body?.state!=='open'||body?.pull_request)return false;
    const current=nv02WorkOrderMeta(body);
    if(current.METADATA_CONFLICT==='true')return false;
    const labels=(Array.isArray(body?.labels)?body.labels:[]).map(l=>String(l?.name||l||'').trim().toUpperCase());
    // Labels and old descriptions can only deny; never grant permissions.
    if(labels.some(l=>['NV02_SELF_MODIFICATION_GUARD','MANUAL_HOLD','HOLD'].includes(l)))return false;
    if(current.TIGERIQ_EXECUTABLE!=='true'||current.OWNER_POLICY!=='AUTO')return false;
    if(nv02PrioritySummary(body)==='P0'||current.PRIORITY==='P0')return false;
    if(['EXCLUDED','EXCLUDED_'].some(prefix=>String(current.AUTO_QUEUE||'').toUpperCase().startsWith(prefix)))return false;
    if(['OWNER_HOLD','OWNER_GATE','MANUAL_HOLD','REVIEW_ONLY','DONE','NV02_SELF_MODIFICATION_GUARD'].some(k=>current[k]==='true'))return false;
    if(/^(?:BLOCKED|EXTERNAL_WAIT|WAIT_EXTERNAL|WAIT_DEPENDENCY|SUPERSEDED|CANCELLED|DONE|COMPLETED)(?:_|$)/i.test(String(current.CURRENT_STATE||'')))return false;
    return true;
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
    await pool.query("update tigeriq_coding_objectives set status='blocked',summary=$2,updated_at=now() where id=$1",[job.objective_id,`BLOCKED:AUTO_REPAIR_EXHAUSTED:${reason}`]);
    await emit(pool,'BLOCKED',{objectiveId:job.objective_id,jobId:job.id,reason,totalJobs:total,status:'BLOCKED'});
    return false;
  }
  if(await hasActiveJob(pool,job.objective_id,job.id))return false;
  const retryId=`CODE-${randomUUID()}`;
  const cycle=total+1;
  const paths=Array.isArray(job.paths)?job.paths:[];
  const resume=retryResumeState(job);
  await pool.query('insert into tigeriq_coding_jobs(id,objective_id,title,instruction,paths,status,branch,pr_number,head_sha,live_github_context,live_github_context_fingerprint) values($1,$2,$3,$4,$5,\'queued\',$6,$7,$8,$9,$10)',[
    retryId,job.objective_id,repairJobTitle(job.title,cycle),repairInstruction(job,reason,cycle),JSON.stringify(paths),
    resume.branch,resume.prNumber,resume.headSha,resume.liveGithubContext?JSON.stringify(resume.liveGithubContext):null,resume.liveGithubContextFingerprint
  ]);
  await pool.query("update tigeriq_coding_objectives set status='active',summary=$2,updated_at=now() where id=$1",[job.objective_id,`AUTO_REPAIR_QUEUED:${retryId}:${reason}`]);
  await emit(pool,'RETRY_QUEUED',{objectiveId:job.objective_id,sourceJobId:job.id,retryJobId:retryId,reason,cycle});
  return true;
}
async function handleFailed(pool,maxJobs){
  const q=await pool.query("select * from tigeriq_coding_jobs where status='failed' and coalesce(failure->>'supervisorHandled','false')<>'true' order by completed_at nulls last,created_at limit 10");
  for(const job of q.rows){
    const normalizedReason=normalizeRepairFailure(job.failure?.message||job.failure?.code||'UNKNOWN_FAILURE');
    await pool.query("update tigeriq_coding_jobs set failure=coalesce(failure,'{}'::jsonb)||'{\"supervisorHandled\":true}'::jsonb where id=$1",[job.id]);
    if(!isRetryableFailure(normalizedReason)){
      await emit(pool,'REPAIR_SKIPPED',{objectiveId:job.objective_id,jobId:job.id,reason:'NON_RETRYABLE_FAILURE',failure:normalizedReason});
      continue;
    }
    const gate=await objectiveIsEligible(pool,job.objective_id);
    if(!gate.eligible){await emit(pool,'REPAIR_SKIPPED',{objectiveId:job.objective_id,jobId:job.id,reason:'ISSUE_NOT_OPEN',issueNumber:gate.issueNumber});continue;}
    await queueRetry(pool,job,normalizedReason,maxJobs);
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
    await emit(pool,'STALL_DETECTED',{objectiveId:job.objective_id,jobId:job.id,previousStatus:job.status,retryQueued:queued,issueNumber:gate.issueNumber,status:'STALL_TIMEOUT'});
    if(!queued){
      await pool.query("update tigeriq_coding_objectives set status='blocked',summary=$2,updated_at=now() where id=$1",[job.objective_id,`BLOCKED:STALL_RETRY_EXHAUSTED`]);
      await emit(pool,'BLOCKED',{objectiveId:job.objective_id,jobId:job.id,reason:'STALL_TIMEOUT',status:'BLOCKED'});
    }
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
    try{await ensureSchema(pool);await handleFailed(pool,maxJobs);await backfillGithubRetryReceipts(pool,{fetchImpl:options.fetchImpl||fetch});await handleStale(pool,staleMs,maxJobs,onStall);}catch(error){console.error(JSON.stringify({event:'CODING_AUTONOMY_WATCHDOG_ERROR',error:String(error?.message||error)}));}finally{busy=false;}
  };
  const timer=setInterval(()=>void tick(),Math.max(5000,intervalMs));
  timer.unref?.();
  setTimeout(()=>void tick(),5000).unref?.();
  return {stop:async()=>{stopped=true;clearInterval(timer);if(!options.pool)await pool.end();}};
}
