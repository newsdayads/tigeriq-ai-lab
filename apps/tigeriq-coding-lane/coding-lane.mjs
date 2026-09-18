import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {branchName,checkGateState,extractCanonicalAllowedPaths,isRetryableAiError,parseJsonObject,parseRawUtf8Envelope,safeRepoPath,validateChanges} from './policy.mjs';
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
  if(offending.length){
    const err=new CodingScopeViolationError(offending);
    err.code='CODING_SCOPE_VIOLATION';
    throw err;
  }
  return true;
}

export function validateSourceScope(proposedPaths,canonicalPaths){
  const canonical=new Set((canonicalPaths||[]).map(String));
  if(!canonical.size)return true;
  const offending=(proposedPaths||[]).map(String).filter(p=>!canonical.has(p));
  if(off
...[MODEL_CONTEXT_REDUCED]...
ilover(reviewer,prompt,{exclude:[implementerId]});const d=invoked.data;if(!['approve','changes_requested'].includes(d.decision)){const e=new Error('REVIEW_DECISION_INVALID');e.code='REVIEW_SCHEMA_INVALID';throw e}d.issues=Array.isArray(d.issues)?d.issues.slice(0,8):[];return {review:d,resource:invoked.resource}}

async function runJob(j){
  let worker=resources.find(r=>r.id===j.employee_id)||pickResource();if(!worker)throw new Error('NO_IMPLEMENTER_AVAILABLE');
  j.paths=Array.isArray(j.paths)?j.paths:j.paths||[];
  let context=null,generated=null,gen={summary:'resumed existing PR'},reviewer=null;
  let branch=j.branch||null,pr=j.pr_number?{number:Number(j.pr_number)}:null;
  if(shouldResumeExistingPr(j)){
    assertPrOpenState(await gh(`/pulls/${pr.number}`));
    context=await contextFor(j.paths,branch);
    reviewer=resources.find(r=>r.id===j.reviewer_employee_id&&r.id!==worker.id)||pickResource([worker.id]);
    if(!reviewer)throw new Error('NO_INDEPENDENT_REVIEWER_AVAILABLE');
    await pool.query("update tigeriq_coding_jobs set employee_id=$2,reviewer_employee_id=$3,status='waiting_ci',next_attempt_at=null,completed_at=null where id=$1",[j.id,worker.id,reviewer.id]);
  }else{
    context=await contextFor(j.paths,'main');
    generated=await generateChanges(worker,j,context);worker=generated.resource;gen=generated.payload;
    validateJobScope(j.paths,gen.changes);
    reviewer=pickResource([worker.id]);if(!reviewer)throw new Error('NO_INDEPENDENT_REVIEWER_AVAILABLE');
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
        generated=await generateRepairEdits(worker,j,context,[`CI gate failure on same PR #${pr.number}`,...evidence],[reviewer.id]);
        worker=generated.resource;gen=generated.payload;
        if(reviewer?.id===worker.id){reviewer=pickResource([worker.id]);if(!reviewer)throw new Error('NO_INDEPENDENT_REVIEWER_AVAILABLE')}
        await pool.query("update tigeriq_coding_jobs set employee_id=$2,reviewer_employee_id=$3,status='waiting_ci' where id=$1",[j.id,worker.id,reviewer.id]);
        await writeRepairEdits(branch,gen.edits);
      },
      maxRepairCycles:3,
      timeoutRetries:1,
    });
    await pool.query("update tigeriq_coding_jobs set status='review',head_sha=$2 where id=$1",[j.id,gates.sha]);
    if(reviewer?.id===worker.id){reviewer=pickResource([worker.id]);if(!reviewer)throw new Error('NO_INDEPENDENT_REVIEWER_AVAILABLE')}
    const diff=await ghText(`/pulls/${pr.number}`,'application/vnd.github.v3.diff');
    const reviewed=await reviewPr(reviewer,j,diff,worker.id);reviewer=reviewed.resource;review=reviewed.review;
    if(reviewer.id===worker.id)throw new Error('REVIEWER_IMPLEMENTER_COLLISION');
    await pool.query("update tigeriq_coding_jobs set reviewer_employee_id=$2 where id=$1",[j.id,reviewer.id]);
    if(review.decision==='approve')break;
    if(reviewCycle===2)throw Object.assign(new Error('REVIEW_CHANGES_UNRESOLVED'),{detail:review});
    context=await contextFor(j.paths,branch);
    generated=await generateRepairEdits(worker,j,context,review.issues,[reviewer.id]);worker=generated.resource;gen=generated.payload;
    if(reviewer.id===worker.id){reviewer=pickResource([worker.id]);if(!reviewer)throw new Error('NO_INDEPENDENT_REVIEWER_AVAILABLE')}
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

if(process.env.NODE_ENV!=='test'){
  await initDb();
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
