import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {branchName,checkGateState,extractCanonicalAllowedPaths,isRetryableAiError,parseJsonObject,safeRepoPath,validateChanges} from './policy.mjs';
import { createGeminiRateController } from '../shared/gemini-rate-control.mjs';

export class CodingScopeViolationError extends Error {
  constructor(offending) {
    super(`CODING_SCOPE_VIOLATION: ${offending.join(', ')}`);
    this.code='CODING_SCOPE_VIOLATION';
    this.offending=offending;
    this.detail={code:'CODING_SCOPE_VIOLATION',offending};
  }
}

export function validateJobScope(jobPaths,changes){
  const allowed=new Set(Array.isArray(jobPaths)?jobPaths:[]);
  const offending=(changes||[]).map(c=>c?.path).filter(Boolean).filter(p=>!allowed.has(p));
  if(offending.length) throw new CodingScopeViolationError(offending);
  return true;
}

export function validateSourceScope(proposedPaths,canonicalPaths){
  const canonical=new Set((canonicalPaths||[]).map(String));
  if(!canonical.size)return true;
  const offending=(proposedPaths||[]).map(String).filter(p=>!canonical.has(p));
  if(offending.length)throw new CodingScopeViolationError(offending);
  return true;
}

export function shrinkAiPrompt(prompt,maxChars=18000){
  const p=String(prompt||'');
  if(p.length<=maxChars)return p;
  const head=Math.floor(maxChars*0.45),tail=maxChars-head;
  return `${p.slice(0,head)}\n...[MODEL_CONTEXT_REDUCED]...\n${p.slice(-tail)}`;
}

export function assertPrOpenState(pr){
  if(pr?.state==='open')return true;
  const code=pr?.merged?'PR_EXTERNALLY_MERGED':'PR_CLOSED_UNMERGED';
  const e=new Error(code);
  e.code=code;
  e.detail={code,number:pr?.number||null,state:pr?.state||null,merged:Boolean(pr?.merged)};
  throw e;
}

export function gateFailureIssues(error){
  const detail=error?.detail||{};
  const states=Array.isArray(detail.states)?detail.states:[];
  const issues=states
    .filter(s=>s?.conclusion && s.conclusion!=='success')
    .map(s=>`${s.name||'check'}: ${s.conclusion}${s.status?` (${s.status})`:''}`);
  if(detail.output)issues.push(String(detail.output).slice(0,2000));
  if(detail.message)issues.push(String(detail.message).slice(0,2000));
  if(!issues.length)issues.push(String(error?.message||'CI gate failed').slice(0,2000));
  return issues.slice(0,8);
}

export async function runGateWithRepair({waitFn,repairFn,onWaiting=async()=>{},maxRepairCycles=3,timeoutRetries=1}){
  let repairCycles=0;
  let timeoutCount=0;
  while(true){
    try{return await waitFn()}
    catch(error){
      const code=error?.code||String(error?.message||'').split(':')[0];
      if(code==='CI_GATES_TIMEOUT'){
        if(timeoutCount>=timeoutRetries){
          error.detail={...(error.detail||{}),timeoutRetries:timeoutCount};
          throw error;
        }
        timeoutCount++;
        await onWaiting({reason:'timeout',timeoutCount,evidence:gateFailureIssues(error)});
        continue;
      }
      if(code==='CI_GATES_FAILED'){
        if(repairCycles>=maxRepairCycles){
          const exhausted=new Error('CI_GATE_REPAIR_EXHAUSTED');
          exhausted.code='CI_GATE_REPAIR_EXHAUSTED';
          exhausted.detail={repairCycles,evidence:gateFailureIssues(error),lastFailure:error.detail||null};
          throw exhausted;
        }
        repairCycles++;
        const evidence=gateFailureIssues(error);
        await onWaiting({reason:'failed',repairCycle:repairCycles,evidence});
        await repairFn({repairCycle:repairCycles,evidence,error});
        timeoutCount=0;
        continue;
      }
      throw error;
    }
  }
}

const RESOURCE_WAIT_MAX_RETRIES=6;
const RESOURCE_WAIT_MAX_WINDOW_MS=60*60*1000;
const RESOURCE_WAIT_BASE_MS=30*1000;
const RESOURCE_WAIT_MAX_DELAY_MS=10*60*1000;

export function classifyAiFailure(error){
  const status=Number(error?.status||0);
  const msg=String(error?.message||error||'');
  if(status===429||/HTTP_429\b|RATE_LIMIT|RESOURCE_EXHAUSTED/i.test(msg))return 'rate_limit';
  if(error?.name==='AbortError'||/ETIMEDOUT|timeout|aborted|ECONNRESET|socket/i.test(msg))return 'timeout';
  if(/JSON_OBJECT_(?:INVALID|MISSING)|CODING_CHANGES_COUNT_INVALID|schema|unterminated|truncat|COMPACT_EDIT/i.test(msg))return 'output_contract';
  if(/EMPTY_RESPONSE|invalid_response/i.test(msg))return 'invalid_response';
  if([408,409,413,500,502,503,504].includes(status)||/fetch failed|HTTP_(?:408|409|413|500|502|503|504)\b/i.test(msg))return 'provider_unavailable';
  return isRetryableAiError(error)?'other_retryable':'other';
}

export function activeProviderCooldownIds(failure,nowMs=Date.now()){
  const ledger=Array.isArray(failure?.detail?.failureLedger)?failure.detail.failureLedger:[];
  return [...new Set(ledger.filter(x=>x?.class==='rate_limit'&&Date.parse(x?.cooldownUntil||0)>nowMs).map(x=>x.resourceId).filter(Boolean))];
}

export function isResourceTransientError(error){
  if(error?.code==='AI_RESOURCES_UNAVAILABLE')return true;
  const msg=String(error?.message||error||'');
  return /NO_(?:IMPLEMENTER_AVAILABLE|INDEPENDENT_REVIEWER_AVAILABLE|FREE_API_CODING_RESOURCE)|AI_RETRY_BUDGET_EXHAUSTED/i.test(msg);
}

export function resourceWaitPlan({retryCount=0,startedAt=null,nowMs=Date.now(),maxRetries=RESOURCE_WAIT_MAX_RETRIES,maxWindowMs=RESOURCE_WAIT_MAX_WINDOW_MS}={}){
  const count=Math.max(0,Number(retryCount)||0);
  const startedMs=startedAt?new Date(startedAt).getTime():nowMs;
  const ageMs=Math.max(0,nowMs-(Number.isFinite(startedMs)?startedMs:nowMs));
  if(count>=maxRetries||ageMs>=maxWindowMs)return {wait:false,retryCount:count,ageMs,nextAttemptAt:null,delayMs:0};
  const delayMs=Math.min(RESOURCE_WAIT_MAX_DELAY_MS,RESOURCE_WAIT_BASE_MS*Math.pow(2,count));
  return {wait:true,retryCount:count+1,ageMs,delayMs,nextAttemptAt:new Date(nowMs+delayMs).toISOString()};
}

export function shouldResumeExistingPr(job){
  return Boolean(String(job?.branch||'').trim()&&Number(job?.pr_number)>0);
}
const DATABASE_URL=process.env.DATABASE_URL?.trim(); if(!DATABASE_URL&&process.env.NODE_ENV!=='test')throw new Error('DATABASE_URL_MISSING');
const GH_TOKEN=(process.env.TIGERIQ_GITHUB_TOKEN||process.env.GITHUB_TOKEN||'').trim(); if(!GH_TOKEN&&process.env.NODE_ENV!=='test')throw new Error('GITHUB_TOKEN_MISSING');
const OWNER=process.env.TIGERIQ_GITHUB_OWNER||'newsdayads';
const REPO=process.env.TIGERIQ_GITHUB_REPO||'tigeriq-ai-lab';
const HOST=process.env.TIGERIQ_CODING_HOST||'127.0.0.1';
const PORT=Number(process.env.TIGERIQ_CODING_PORT||8797);
const AUTO_MERGE=String(process.env.TIGERIQ_CODING_AUTO_MERGE||'true').toLowerCase()==='true';
const MAX_PARALLEL=Math.max(1,Math.min(2,Number(process.env.TIGERIQ_CODING_MAX_PARALLEL||1)));
const pool=DATABASE_URL?new Pool({connectionString:DATABASE_URL,max:4}):null;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const GEMINI_MIN_INTERVAL_MS=Math.max(4500,Number(process.env.TIGERIQ_GEMINI_MIN_INTERVAL_MS||4500));
const GEMINI_BACKOFF_BASE_MS=Math.max(4500,Number(process.env.TIGERIQ_GEMINI_BACKOFF_BASE_MS||4500));
c
...[MODEL_CONTEXT_REDUCED]...
erCooldownIds(j.failure);
  let worker=resources.find(r=>r.id===j.employee_id&&!cooldownExcludes.includes(r.id))||pickResource(cooldownExcludes);if(!worker)throw new Error('NO_IMPLEMENTER_AVAILABLE');
  j.paths=Array.isArray(j.paths)?j.paths:j.paths||[];
  let context=null,generated=null,gen={summary:'resumed existing PR'},reviewer=null;
  let branch=j.branch||null,pr=j.pr_number?{number:Number(j.pr_number)}:null;
  if(shouldResumeExistingPr(j)){
    assertPrOpenState(await gh(`/pulls/${pr.number}`));
    context=await contextFor(j.paths,branch);
    reviewer=resources.find(r=>r.id===j.reviewer_employee_id&&r.id!==worker.id&&!cooldownExcludes.includes(r.id))||pickResource([worker.id,...cooldownExcludes]);
    if(!reviewer)throw new Error('NO_INDEPENDENT_REVIEWER_AVAILABLE');
    await pool.query("update tigeriq_coding_jobs set employee_id=$2,reviewer_employee_id=$3,status='waiting_ci',next_attempt_at=null,completed_at=null where id=$1",[j.id,worker.id,reviewer.id]);
  }else{
    context=await contextFor(j.paths,'main');
    generated=await generateChanges(worker,j,context,[],cooldownExcludes);worker=generated.resource;gen=generated.payload;
    validateJobScope(j.paths,gen.changes);
    reviewer=pickResource([worker.id,...cooldownExcludes]);if(!reviewer)throw new Error('NO_INDEPENDENT_REVIEWER_AVAILABLE');
    const base=await mainSha();branch=branchName(worker.id,j.id);await createBranch(branch,base);
    await pool.query("update tigeriq_coding_jobs set employee_id=$2,reviewer_employee_id=$3,branch=$4,next_attempt_at=null where id=$1",[j.id,worker.id,reviewer.id,branch]);
    for(const ch of gen.changes)await writeFile(branch,ch);
    pr=await openPr(branch,`[${worker.id}] ${j.title}`,`Automated TigerIQ Coding Lane job \`${j.id}\`.\n\nImplementer: ${worker.id}\nIndependent reviewer: ${reviewer.id}\nDirect writes to main are forbidden. Merge is attempted only after CI gates and reviewer approval.`);
    await pool.query("update tigeriq_coding_jobs set pr_number=$2,status='waiting_ci' where id=$1",[j.id,pr.number]);
  }
  let review=null,gates=null;
  for(let reviewCycle=0;reviewCycle<3;reviewCycle++){
    gates=await runGateWithRepair({
      waitFn:()=>waitGates(branch,pr.number),
      onWaiting:async()=>{await pool.query("update tigeriq_coding_jobs set status='waiting_ci' where id=$1",[j.id])},
      repairFn:async({evidence})=>{
        context=await contextFor(j.paths,branch);
        generated=await generateRepairEdits(worker,j,context,[`CI gate failure on same PR #${pr.number}`,...evidence],[reviewer.id,...cooldownExcludes]);
        worker=generated.resource;gen=generated.payload;
        if(reviewer?.id===worker.id){reviewer=pickResource([worker.id,...cooldownExcludes]);if(!reviewer)throw new Error('NO_INDEPENDENT_REVIEWER_AVAILABLE')}
        await pool.query("update tigeriq_coding_jobs set employee_id=$2,reviewer_employee_id=$3,status='waiting_ci' where id=$1",[j.id,worker.id,reviewer.id]);
        await writeRepairEdits(branch,gen.edits);
      },
      maxRepairCycles:3,
      timeoutRetries:1,
    });
    await pool.query("update tigeriq_coding_jobs set status='review',head_sha=$2 where id=$1",[j.id,gates.sha]);
    if(reviewer?.id===worker.id){reviewer=pickResource([worker.id,...cooldownExcludes]);if(!reviewer)throw new Error('NO_INDEPENDENT_REVIEWER_AVAILABLE')}
    const diff=await ghText(`/pulls/${pr.number}`,'application/vnd.github.v3.diff');
    const reviewed=await reviewPr(reviewer,j,diff,worker.id,cooldownExcludes);reviewer=reviewed.resource;review=reviewed.review;
    if(reviewer.id===worker.id)throw new Error('REVIEWER_IMPLEMENTER_COLLISION');
    await pool.query("update tigeriq_coding_jobs set reviewer_employee_id=$2 where id=$1",[j.id,reviewer.id]);
    if(review.decision==='approve')break;
    if(reviewCycle===2)throw Object.assign(new Error('REVIEW_CHANGES_UNRESOLVED'),{detail:review});
    context=await contextFor(j.paths,branch);
    generated=await generateRepairEdits(worker,j,context,review.issues,[reviewer.id,...cooldownExcludes]);worker=generated.resource;gen=generated.payload;
    if(reviewer.id===worker.id){reviewer=pickResource([worker.id,...cooldownExcludes]);if(!reviewer)throw new Error('NO_INDEPENDENT_REVIEWER_AVAILABLE')}
    await pool.query("update tigeriq_coding_jobs set employee_id=$2,reviewer_employee_id=$3,status='waiting_ci' where id=$1",[j.id,worker.id,reviewer.id]);
    await writeRepairEdits(branch,gen.edits);
  }
  if(review?.decision!=='approve')throw new Error('REVIEW_NOT_APPROVED');
  assertPrOpenState(await gh(`/pulls/${pr.number}`));
  const finalSha=await headSha(branch);let merge={merged:false,message:'AUTO_MERGE_DISABLED'};
  if(AUTO_MERGE){try{merge=await mergePr(pr.number,finalSha)}catch(e){merge={merged:false,message:String(e.message||e)}}}
  const status=merge?.merged?'done':'blocked';
  await pool.query("update tigeriq_coding_jobs set status=$2,head_sha=$3,result=$4,completed_at=now(),next_attempt_at=null,resource_retry_count=0,resource_retry_started_at=null where id=$1",[j.id,status,finalSha,JSON.stringify({summary:gen.summary,prNumber:pr.number,branch,gates,review,merge})]);
  await pool.query("update tigeriq_coding_objectives set status=$2,summary=$3,updated_at=now() where id=$1",[j.objective_id,merge?.merged?'completed':'blocked',merge?.merged?`Merged PR #${pr.number}`:`PR #${pr.number} ready but merge blocked: ${String(merge?.message||'unknown').slice(0,500)}`]);
  return {prNumber:pr.number,branch,merge};
}
async function failJob(j,e){
  if(!pool)return;
  const current=(await pool.query("select * from tigeriq_coding_jobs where id=$1",[j.id])).rows[0]||j;
  const failure={message:String(e?.message||e),code:e?.code||null,detail:e?.detail||null};
  if(isResourceTransientError(e)){
    const plan=resourceWaitPlan({retryCount:current.resource_retry_count,startedAt:current.resource_retry_started_at});
    if(plan.wait){
      await pool.query("update tigeriq_coding_jobs set status='waiting_resource',failure=$2,next_attempt_at=$3,resource_retry_count=$4,resource_retry_started_at=coalesce(resource_retry_started_at,now()),completed_at=null where id=$1",[j.id,JSON.stringify({...failure,resourceWait:{retryCount:plan.retryCount,delayMs:plan.delayMs,nextAttemptAt:plan.nextAttemptAt}}),plan.nextAttemptAt,plan.retryCount]);
      await pool.query("update tigeriq_coding_objectives set status='active',summary=$2,updated_at=now() where id=$1",[j.objective_id,`WAITING_RESOURCE retry ${plan.retryCount}/${RESOURCE_WAIT_MAX_RETRIES}: ${failure.message}`.slice(0,1000)]);
      return;
    }
  }
  await pool.query("update tigeriq_coding_jobs set status='failed',failure=$2,completed_at=now(),next_attempt_at=null where id=$1",[j.id,JSON.stringify(failure)]);
  await pool.query("update tigeriq_coding_objectives set status='blocked',summary=$2,updated_at=now() where id=$1",[j.objective_id,String(e?.message||e).slice(0,1000)]);
}

async function snapshot(){const objectives=(await pool.query('select * from tigeriq_coding_objectives order by created_at desc limit 20')).rows;const jobs=(await pool.query('select * from tigeriq_coding_jobs order by created_at desc limit 30')).rows;return {ok:true,service:'tigeriq-coding-lane',host:HOST,port:PORT,pid:process.pid,resources:resources.map(x=>({id:x.id,provider:x.provider,model:x.model})),objectives,jobs}}
async function body(req){let s='';for await(const c of req){s+=c;if(s.length>65536)throw new Error('BODY_TOO_LARGE')}return s?JSON.parse(s):{}}
const server=createServer(async(req,res)=>{const u=new URL(req.url||'/','http://localhost');try{if(req.method==='GET'&&u.pathname==='/health'){res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({ok:true,service:'tigeriq-coding-lane',pid:process.pid,resources:resources.length}))}if(req.method==='GET'&&u.pathname==='/api/status'){res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});return res.end(JSON.stringify(await snapshot()))}if(req.method==='POST'&&u.pathname==='/api/objectives'){const b=await body(req);if(!String(b.objective||'').trim()){res.writeHead(400);return res.end('objective_required')}const id=`CODEOBJ-${randomUUID()}`;const priority=['P0','P1','P2'].includes(b.priority)?b.priority:'P1';await pool.query('insert into tigeriq_coding_objectives(id,objective,priority) values($1,$2,$3)',[id,String(b.objective).slice(0,12000),priority]);res.writeHead(201,{'content-type':'application/json'});return res.end(JSON.stringify({ok:true,id}))}res.writeHead(404);res.end('not_found')}catch(e){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({ok:false,error:String(e?.message||e)}))}});

export async function recoverOrphanedJobs(){
  if(!pool)return [];
  const {rows:jobs}=await pool.query("select * from tigeriq_coding_jobs where status in ('running','waiting_ci','waiting_review','waiting_resource')");
  const actions=[];
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  
  for(const j of jobs){
    let action='resumed';
    let prInfo=null;
    let details={};
    
    try {
      const resultObj = typeof j.result === 'string' ? parseJsonObject(j.result) : (j.result || {});
      const prNumber = resultObj.prNumber || j.pr_number;
      
      if(prNumber) {
        try {
          const prData = await gh(`/pulls/${prNumber}`);
          prInfo = prData;
          if(prData?.merged) {
            action = 'completed';
            const finalSha = prData.merge_commit_sha || j.head_sha || 'HEAD';
            await pool.query("update tigeriq_coding_jobs set status='done',head_sha=$2,completed_at=coalesce(completed_at,now()),next_attempt_at=null where id=$1", [j.id, finalSha]);
            if(j.objective_id) {
              await pool.query("update tigeriq_coding_objectives set status='completed',summary=$2,updated_at=now() where id=$1", [j.objective_id, `Merged PR #${prNumber} detected during orphan recovery`]);
            }
          } else {
            action = 'resumed_resumable';
            await pool.query("update tigeriq_coding_jobs set status='running',completed_at=null where id=$1", [j.id]);
          }
        } catch(err) {
          action = 'resumed_resumable';
          await pool.query("update tigeriq_coding_jobs set status='running',completed_at=null where id=$1", [j.id]);
          details.ghError = String(err?.message || err);
        }
      } else {
        action = 'resumed_resumable';
        await pool.query("update tigeriq_coding_jobs set status='running',completed_at=null where id=$1", [j.id]);
      }
    } catch(err) {
      action = 'error';
      details.error = String(err?.message || err);
    }
    
    actions.push({ jobId: j.id, objectiveId: j.objective_id, action, prNumber: prInfo?.number || null, details });
  }
  
  try {
    const evidenceDir = path.resolve(process.cwd(), 'reports');
    await fs.mkdir(evidenceDir, { recursive: true });
    const evidencePath = path.join(evidenceDir, 'coding-lane-recovery-evidence.json');
    await fs.writeFile(evidencePath, JSON.stringify({ timestamp: new Date().toISOString(), actions }, null, 2), 'utf8');
  } catch(e) {}
  
  return actions;
}

if(process.env.NODE_ENV!=='test'){
  await initDb();
  await recoverOrphanedJobs();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(PORT,HOST,resolve)});
  console.log(JSON.stringify({event:'TIGERIQ_CODING_LANE_STARTED',host:HOST,port:PORT,pid:process.pid,resources:resources.map(x=>x.id),autoMerge:AUTO_MERGE}));
  let stop=false;
  const active=new Set();
  process.on('SIGINT',()=>{stop=true;server.close()});
  process.on('SIGTERM',()=>{stop=true;server.close()});
  while(!stop){
    try{
      await managerTick();
      while(active.size<MAX_PARALLEL){
        const j=await claimJob();
        if(!j)break;
        active.add(j.id);
        void runJob(j).catch(e=>failJob(j,e)).finally(()=>active.delete(j.id));
      }
    }catch(e){console.error(JSON.stringify({event:'CODING_LANE_LOOP_ERROR',error:String(e?.message||e)}))}
    await sleep(1500);
  }
  if(pool)await pool.end();
}
