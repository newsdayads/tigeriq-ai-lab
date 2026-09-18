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
const GEMINI_MAX_ATTEMPTS=Math.max(1,Number(process.env.TIGERIQ_GEMINI_MAX_ATTEMPTS||4));
const geminiRateController=createGeminiRateController({minIntervalMs:GEMINI_MIN_INTERVAL_MS,backoffBaseMs:GEMINI_BACKOFF_BASE_MS,maxAttempts:GEMINI_MAX_ATTEMPTS});

const R=(id,provider,model,ready)=>({id,provider,model,ready});
const resources=[
  R('NV11','groq',process.env.TIGERIQ_GROQ_MODEL||'openai/gpt-oss-120b',()=>process.env.GROQ_API_KEY&&process.env.TIGERIQ_GROQ_FREE_TIER_VERIFIED==='true'),
  R('NV12','gemini',process.env.TIGERIQ_GEMINI_MODEL||'gemini-3.5-flash-lite',()=>process.env.GEMINI_API_KEY&&process.env.TIGERIQ_GEMINI_FREE_TIER_VERIFIED==='true'),
  R('NV13','openrouter','openrouter/free',()=>process.env.OPENROUTER_API_KEY),
  R('NV14','mistral','mistral-small-latest',()=>process.env.MISTRAL_API_KEY),
  R('NV16','huggingface','openai/gpt-oss-120b:fastest',()=>process.env.HF_TOKEN),
  R('NV19','cohere',process.env.TIGERIQ_COHERE_MODEL||'command-a-plus-05-2026',()=>process.env.COHERE_API_KEY&&process.env.TIGERIQ_COHERE_TRIAL_CONFIRMED==='true'),
].filter(x=>x.ready());
let rr=0;
function pickResource(exclude=[]){const available=resources.filter(x=>!exclude.includes(x.id));if(!available.length)return null;const r=available[rr%available.length];rr++;return r;}

async function fetchJson(url,init={},timeout=90000){const c=new AbortController(),t=setTimeout(()=>c.abort(),timeout);try{const res=await fetch(url,{...init,signal:c.signal});const text=await res.text();let body={};try{body=text?JSON.parse(text):{};}catch{body={text};}if(!res.ok){const e=new Error(`HTTP_${res.status}:${String(body?.message||body?.error||text).slice(0,300)}`);e.status=res.status;throw e;}return body;}finally{clearTimeout(t)}}
async function openAi(endpoint,key,model,prompt){const b=await fetchJson(endpoint,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${key}`},body:JSON.stringify({model,messages:[{role:'user',content:prompt}],temperature:0,max_tokens:8000,stream:false})});const text=b?.choices?.[0]?.message?.content;if(!String(text||'').trim())throw new Error('EMPTY_RESPONSE');return String(text)}
async function invoke(r,prompt){
  if(r.provider==='groq')return openAi('https://api.groq.com/openai/v1/chat/completions',process.env.GROQ_API_KEY,r.model,prompt);
  if(r.provider==='openrouter')return openAi('https://openrouter.ai/api/v1/chat/completions',process.env.OPENROUTER_API_KEY,r.model,prompt);
  if(r.provider==='mistral')return openAi('https://api.mistral.ai/v1/chat/completions',process.env.MISTRAL_API_KEY,r.model,prompt);
  if(r.provider==='huggingface')return openAi('https://router.huggingface.co/v1/chat/completions',process.env.HF_TOKEN,r.model,prompt);
  if(r.provider==='gemini')return geminiRateController.run(async()=>{const b=await fetchJson(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(r.model)}:generateContent`,{method:'POST',headers:{'content-type':'application/json','x-goog-api-key':process.env.GEMINI_API_KEY},body:JSON.stringify({contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{temperature:0,maxOutputTokens:8192}})});const text=b?.candidates?.[0]?.content?.parts?.map(x=>x.text||'').join('\n');if(!String(text||'').trim())throw new Error('EMPTY_RESPONSE');return String(text)});
  if(r.provider==='cohere'){const b=await fetchJson('https://api.cohere.com/v2/chat',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${process.env.COHERE_API_KEY}`},body:JSON.stringify({model:r.model,messages:[{role:'user',content:prompt}],temperature:0,max_tokens:8000})});const text=b?.message?.content?.map(x=>x.text||'').join('');if(!String(text||'').trim())throw new Error('EMPTY_RESPONSE');return String(text)}
  throw new Error('PROVIDER_UNSUPPORTED');
}

export async function invokeJsonWithFailover(initialResource,prompt,{exclude=[],resourcePool=resources,invokeFn=invoke,shrinkPrompt=shrinkAiPrompt,maxResources=3,validateData=null,sleepFn=sleep,randomFn=Math.random,backoffBaseMs=1000}={}){
  const initial=(initialResource&&!exclude.includes(initialResource.id))?initialResource:resourcePool.find(r=>r&&!exclude.includes(r.id));
  if(!initial)throw new Error('NO_FREE_API_CODING_RESOURCE');
  const ordered=[initial,...resourcePool.filter(r=>r?.id!==initial.id&&!exclude.includes(r?.id))];
  const unique=[];const ids=new Set();
  for(const r of ordered){if(!r||exclude.includes(r.id)||ids.has(r.id))continue;ids.add(r.id);unique.push(r);if(unique.length>=Math.min(3,maxResources))break;}
  const failureLedger=[];let attempts=0;
  for(let resourceIndex=0;resourceIndex<unique.length;resourceIndex++){
    const resource=unique[resourceIndex];
    for(let same=0;same<2;same++){
      attempts++;
      try{
        const data=parseJsonObject(await invokeFn(resource,same===0?prompt:shrinkPrompt(prompt)));
        if(validateData)validateData(data,resource);
        return {data,resource,attempts,failureLedger};
      }catch(e){
        const retryable=isRetryableAiError(e);
        const failureClass=classifyAiFailure(e);
        const cooldownUntil=failureClass==='rate_limit'?new Date(Date.now()+30*60*1000).toISOString():null;
        failureLedger.push({resourceId:resource.id,provider:resource.provider,class:failureClass,retryable,cooldownUntil,message:String(e?.message||e).slice(0,500)});
        if(!retryable){
          e.detail={...(e.detail||{}),attempts,tried:[...new Set(failureLedger.map(x=>x.resourceId))],failureLedger};
          throw e;
        }
        if(failureClass==='rate_limit')break;
        if(same===0)continue;
        break;
      }
    }
  }
  const tried=[...new Set(failureLedger.map(x=>x.resourceId))];
  const resourceOnly=failureLedger.length>0&&failureLedger.every(x=>['rate_limit','timeout','provider_unavailable'].includes(x.class));
  const hasOutputFailure=failureLedger.some(x=>['output_contract','invalid_response'].includes(x.class));
  const code=resourceOnly?'AI_RESOURCES_UNAVAILABLE':hasOutputFailure?'OUTPUT_CONTRACT_EXHAUSTED':'AI_RETRY_BUDGET_EXHAUSTED';
  const error=new Error(code);error.code=code;error.detail={attempts,tried,failureLedger};throw error;
}

async function gh(path,init={}){return fetchJson(`https://api.github.com/repos/${OWNER}/${REPO}${path}`,{...init,headers:{accept:'application/vnd.github+json','content-type':'application/json','user-agent':'TigerIQ-Coding-Lane/1.0','x-github-api-version':'2022-11-28',authorization:`Bearer ${GH_TOKEN}`,...(init.headers||{})}},30000)}
async function ghText(path,accept){const res=await fetch(`https://api.github.com/repos/${OWNER}/${REPO}${path}`,{headers:{accept,authorization:`Bearer ${GH_TOKEN}`,'user-agent':'TigerIQ-Coding-Lane/1.0'},signal:AbortSignal.timeout(30000)});const text=await res.text();if(!res.ok)throw new Error(`GITHUB_HTTP_${res.status}:${text.slice(0,250)}`);return text}
async function mainSha(){return (await gh('/git/ref/heads/main')).object.sha}
async function repoTree(){const sha=await mainSha();const t=await gh(`/git/trees/${sha}?recursive=1`);return (t.tree||[]).filter(x=>x.type==='blob').map(x=>x.path).filter(safeRepoPath).slice(0,3000)}
async function readRepoFile(path,ref='main'){try{const x=await gh(`/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`);return {path,sha:x.sha,content:Buffer.from(x.content||'','base64').toString('utf8')};}catch(e){if(e.status===404)return {path,sha:null,content:''};throw e}}
async function createBranch(name,sha){await gh('/git/refs',{method:'POST',body:JSON.stringify({ref:`refs/heads/${name}`,sha})})}
async function writeFile(branch,change){const old=await readRepoFile(change.path,branch);const body={message:`TigerIQ ${change.path}`,content:Buffer.from(change.content,'utf8').toString('base64'),branch};if(old.sha)body.sha=old.sha;return gh(`/contents/${change.path.split('/').map(encodeURIComponent).join('/')}`,{method:'PUT',body:JSON.stringify(body)})}
async function openPr(branch,title,body){return gh('/pulls',{method:'POST',body:JSON.stringify({title,head:branch,base:'main',body,draft:false,maintainer_can_modify:true})})}
async function headSha(branch){return (await gh(`/git/ref/heads/${encodeURIComponent(branch)}`)).object.sha}
async function waitGates(branch,prNumber,timeoutMs=20*60*1000){const deadline=Date.now()+timeoutMs;while(Date.now()<deadline){assertPrOpenState(await gh(`/pulls/${prNumber}`));const sha=await headSha(branch);const x=await gh(`/commits/${sha}/check-runs?per_page=100`);const g=checkGateState(x.check_runs||[]);if(g.state==='passed')return {sha,...g};if(g.state==='failed'){const e=Object.assign(new Error('CI_GATES_FAILED'),{code:'CI_GATES_FAILED',detail:g});throw e}await sleep(15000)}const e=new Error('CI_GATES_TIMEOUT');e.code='CI_GATES_TIMEOUT';throw e}
async function mergePr(number,sha){return gh(`/pulls/${number}/merge`,{method:'PUT',body:JSON.stringify({sha,merge_method:'squash',commit_title:`TigerIQ Coding Lane PR #${number}`})})}

async function initDb(){if(!pool)return;await pool.query(`
create table if not exists tigeriq_coding_objectives(id text primary key,objective text not null,priority text not null default 'P1',status text not null default 'active',summary text,manager_employee_id text,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table if not exists tigeriq_coding_jobs(id text primary key,objective_id text references tigeriq_coding_objectives(id),title text not null,instruction text not null,paths jsonb not null default '[]'::jsonb,status text not null default 'queued',employee_id text,reviewer_employee_id text,branch text,pr_number int,head_sha text,result jsonb,failure jsonb,attempts int not null default 0,created_at timestamptz not null default now(),started_at timestamptz,completed_at timestamptz);
alter table tigeriq_coding_jobs add column if not exists next_attempt_at timestamptz;
alter table tigeriq_coding_jobs add column if not exists resource_retry_count int not null default 0;
alter table tigeriq_coding_jobs add column if not exists resource_retry_started_at timestamptz;
create index if not exists tigeriq_coding_jobs_status_idx on tigeriq_coding_jobs(status,created_at);
`)}

export function extractGithubIssueNumber(text){
  const value=String(text||'');
  const tagged=value.match(/GitHub(?:\s+autonomous|\s+bootstrap)?\s+coding\s+issue\s+#(\d+)/i)||value.match(/(?:issue|work item)\s+#(\d+)/i);
  if(tagged)return Number(tagged[1]);
  const url=value.match(/github\.com\/[^/]+\/[^/]+\/issues\/(\d+)/i);
  return url?Number(url[1]):null;
}

export function recoveryDecision({job={},issue=null,pr=null,lookupError=null}={}){
  if(lookupError)return {action:'defer',reason:'GITHUB_LOOKUP_FAILED'};
  if(pr){
    if(pr.merged)return {action:'complete',reason:'PR_MERGED'};
    if(pr.state==='open'){
      if(job.branch)return {action:'resume',reason:'PR_OPEN'};
      return {action:'block',reason:'PR_OPEN_WITHOUT_BRANCH'};
    }
    return {action:'block',reason:'PR_CLOSED_UNMERGED'};
  }
  if(issue){
    if(issue.state==='closed'){
      if(String(issue.state_reason||'').toLowerCase()==='completed')return {action:'complete',reason:'ISSUE_COMPLETED'};
      return {action:'block',reason:'ISSUE_CLOSED_NOT_COMPLETED'};
    }
    if(job.branch)return {action:'block',reason:'BRANCH_WITHOUT_PR'};
    return {action:'resume',reason:'ISSUE_OPEN_NO_MUTATION'};
  }
  if(job.branch)return {action:'block',reason:'BRANCH_WITHOUT_DURABLE_GITHUB_REF'};
  return {action:'resume',reason:'NO_MUTATION_TO_REPLAY'};
}

export async function recoverOrphanedJobs({db=pool,github=gh}={}){
  if(!db)return [];
  const q=await db.query("select j.*,o.objective from tigeriq_coding_jobs j left join tigeriq_coding_objectives o on o.id=j.objective_id where j.status in ('running','review','waiting_ci') order by j.created_at");
  const actions=[];
  for(const job of q.rows){
    const issueNumber=extractGithubIssueNumber(job.objective);
    let pr=null,issue=null,lookupError=null;
    try{
      if(Number(job.pr_number)>0)pr=await github(`/pulls/${Number(job.pr_number)}`);
      else if(issueNumber)issue=await github(`/issues/${issueNumber}`);
    }catch(error){lookupError=String(error?.message||error)}
    const decision=recoveryDecision({job,issue,pr,lookupError});
    const evidence={event:'CODING_LANE_ORPHAN_RECOVERY',jobId:job.id,objectiveId:job.objective_id,issueNumber,prNumber:Number(job.pr_number)||null,previousStatus:job.status,...decision};
    if(lookupError)evidence.lookupError=lookupError.slice(0,240);
    if(decision.action==='complete'){
      await db.query("update tigeriq_coding_jobs set status='done',result=coalesce(result,'{}'::jsonb)||$2::jsonb,completed_at=coalesce(completed_at,now()),next_attempt_at=null where id=$1",[job.id,JSON.stringify({recovery:evidence})]);
      if(job.objective_id)await db.query("update tigeriq_coding_objectives set status='completed',summary=$2,updated_at=now() where id=$1",[job.objective_id,`ORPHAN_RECOVERY_COMPLETED:${decision.reason}`]);
    }else if(decision.action==='resume'){
      await db.query("update tigeriq_coding_jobs set status='queued',result=coalesce(result,'{}'::jsonb)||$2::jsonb,completed_at=null,next_attempt_at=null where id=$1",[job.id,JSON.stringify({recovery:evidence})]);
      if(job.objective_id)await db.query("update tigeriq_coding_objectives set status='active',summary=$2,updated_at=now() where id=$1",[job.objective_id,`ORPHAN_RECOVERY_RESUME:${decision.reason}`]);
    }else if(decision.action==='defer'){
      await db.query("update tigeriq_coding_jobs set status='waiting_resource',failure=coalesce(failure,'{}'::jsonb)||$2::jsonb,next_attempt_at=now()+interval '60 seconds',completed_at=null where id=$1",[job.id,JSON.stringify({recovery:evidence})]);
      if(job.objective_id)await db.query("update tigeriq_coding_objectives set status='active',summary=$2,updated_at=now() where id=$1",[job.objective_id,'ORPHAN_RECOVERY_DEFER:GITHUB_LOOKUP_FAILED']);
    }else{
      await db.query("update tigeriq_coding_jobs set status='failed',failure=coalesce(failure,'{}'::jsonb)||$2::jsonb,completed_at=now(),next_attempt_at=null where id=$1",[job.id,JSON.stringify({recovery:evidence})]);
      if(job.objective_id)await db.query("update tigeriq_coding_objectives set status='blocked',summary=$2,updated_at=now() where id=$1",[job.objective_id,`ORPHAN_RECOVERY_BLOCKED:${decision.reason}`]);
    }
    console.log(JSON.stringify(evidence));
    actions.push(evidence);
  }
  return actions;
}

async function managerTick(){
  const q=await pool.query("select * from tigeriq_coding_objectives where status='active' and not exists(select 1 from tigeriq_coding_jobs j where j.objective_id=tigeriq_coding_objectives.id and j.status in ('queued','running','review','waiting_ci','waiting_resource')) order by case priority when 'P0' then 0 when 'P1' then 1 else 2 end,created_at limit 1");
  const o=q.rows[0];if(!o)return;
  let manager=pickResource();if(!manager){await pool.query("update tigeriq_coding_objectives set status='blocked',summary='NO_FREE_API_CODING_RESOURCE' where id=$1",[o.id]);return}
  const canonical=extractCanonicalAllowedPaths(o.objective);
  const tree=await repoTree();
  const scopeText=canonical.length?`\nCANONICAL ALLOWED PATHS (MUST NOT EXPAND):\n${canonical.join('\n')}\n`:'';
  const prompt=`You are TigerIQ Coding Manager. Decompose this repository objective into ONE safe coding job. Repository files:\n${tree.join('\n').slice(0,45000)}\n\nOBJECTIVE: ${o.objective}${scopeText}\nReturn ONLY JSON {"status":"continue|blocked","summary":"short","job":{"title":"short","instruction":"standalone implementation instruction","paths":["exact/repo/path"]}}. Max 8 paths. Include relevant tests only when they are inside canonical scope. Never select .github/workflows, credentials/secrets, production/deploy config, docs/EXECUTION_BOUNDARY.md, docs/SECURITY.md, scripts/tigeriq-core/run-core.ps1, or main/release controls.`;
  try{
    const invoked=await invokeJsonWithFailover(manager,prompt);manager=invoked.resource;const d=invoked.data;
    if(d.status!=='continue'||!d.job){await pool.query("update tigeriq_coding_objectives set status='blocked',summary=$2,manager_employee_id=$3,updated_at=now() where id=$1",[o.id,String(d.summary||'manager blocked').slice(0,1000),manager.id]);return}
    const paths=[...new Set((d.job.paths||[]).map(String))].filter(safeRepoPath).slice(0,8);if(!paths.length)throw new Error('MANAGER_PATHS_EMPTY');
    validateSourceScope(paths,canonical);
    const id=`CODE-${randomUUID()}`;
    await pool.query('insert into tigeriq_coding_jobs(id,objective_id,title,instruction,paths) values($1,$2,$3,$4,$5)',[id,o.id,String(d.job.title||'Coding job').slice(0,180),String(d.job.instruction||o.objective).slice(0,12000),JSON.stringify(paths)]);
    await pool.query("update tigeriq_coding_objectives set manager_employee_id=$2,summary=$3,updated_at=now() where id=$1",[o.id,manager.id,String(d.summary||'coding job created').slice(0,1000)]);
  }catch(e){await pool.query("update tigeriq_coding_objectives set status='blocked',summary=$2,manager_employee_id=$3,updated_at=now() where id=$1",[o.id,String(e.message).slice(0,1000),manager.id])}
}

async function claimJob(){const c=await pool.connect();try{await c.query('begin');const q=await c.query("select * from tigeriq_coding_jobs where status='queued' or (status='waiting_resource' and coalesce(next_attempt_at,now())<=now()) order by case when status='waiting_resource' then 0 else 1 end,created_at for update skip locked limit 1");if(!q.rows[0]){await c.query('commit');return null}const j=q.rows[0];await c.query("update tigeriq_coding_jobs set status='running',started_at=coalesce(started_at,now()),attempts=attempts+1,completed_at=null where id=$1",[j.id]);await c.query('commit');return j}catch(e){await c.query('rollback');throw e}finally{c.release()}}
async function contextFor(paths,ref='main'){const rows=[];for(const p of paths){const f=await readRepoFile(p,ref);rows.push(`FILE ${p}\n${f.content.slice(0,45000)}`)}return rows.join('\n\n---\n\n').slice(0,180000)}
export function validateCompactEdits(edits,allowedPaths=[]){
  if(!Array.isArray(edits)||edits.length<1||edits.length>12)throw new Error('CODING_COMPACT_EDITS_COUNT_INVALID');
  const allow=new Set((allowedPaths||[]).map(String)),seen=new Set(),paths=new Set();
  let bytes=0;
  for(const edit of edits){
    const path=String(edit?.path||'').trim(),old=String(edit?.old??''),next=String(edit?.new??'');
    if(!safeRepoPath(path)||!allow.has(path))throw new CodingScopeViolationError([path||'<empty>']);
    paths.add(path);
    if(!old||old===next)throw new Error('CODING_COMPACT_EDIT_INVALID');
    const key=`${path}\u0000${old}`;if(seen.has(key))throw new Error('CODING_COMPACT_EDIT_DUPLICATE');seen.add(key);
    bytes+=Buffer.byteLength(old,'utf8')+Buffer.byteLength(next,'utf8');
  }
  if(paths.size!==1)throw new Error('CODING_COMPACT_REPAIR_MULTI_FILE_INVALID');
  if(bytes>120000)throw new Error('CODING_COMPACT_EDITSET_TOO_LARGE');
  return true;
}

export function applyCompactEdits(content,edits){
  const source=String(content??''),ranges=[];
  for(const edit of edits||[]){
    const old=String(edit.old),next=String(edit.new),first=source.indexOf(old);
    if(first<0)throw new Error('CODING_COMPACT_EDIT_OLD_NOT_FOUND');
    if(source.indexOf(old,first+old.length)>=0)throw new Error('CODING_COMPACT_EDIT_OLD_NOT_UNIQUE');
    ranges.push({start:first,end:first+old.length,next});
  }
  ranges.sort((a,b)=>a.start-b.start);
  for(let i=1;i<ranges.length;i++)if(ranges[i].start<ranges[i-1].end)throw new Error('CODING_COMPACT_EDIT_OVERLAP');
  let out=source;
  for(const r of [...ranges].sort((a,b)=>b.start-a.start))out=out.slice(0,r.start)+r.next+out.slice(r.end);
  return out;
}

async function generateRepairEdits(worker,j,context,issues=[],exclude=[]){
  const prompt=`You are ${worker.id}, an autonomous TigerIQ repository engineer. Fix ONLY the listed issues on the existing branch.\nTASK: ${j.instruction}\nALLOWED PATHS: ${j.paths.join(', ')}\nISSUES TO FIX: ${JSON.stringify(issues)}\nCURRENT FILES:\n${context}\nReturn ONLY compact JSON {"summary":"short","edits":[{"path":"exact allowed path","old":"exact UNIQUE existing snippet","new":"replacement snippet"}]}. Never return a complete file. All edits in one repair response must target ONE allowed file. Each old snippet must exist exactly once. Keep edits minimal. Do not touch paths outside ALLOWED PATHS. Never output secrets.`;
  const validateData=d=>validateCompactEdits(d.edits,j.paths);
  const invoked=await invokeJsonWithFailover(worker,prompt,{exclude,validateData});
  return {payload:invoked.data,resource:invoked.resource};
}
async function writeRepairEdits(branch,edits){
  const byPath=new Map();
  for(const edit of edits){if(!byPath.has(edit.path))byPath.set(edit.path,[]);byPath.get(edit.path).push(edit)}
  for(const [path,pathEdits] of byPath){
    const current=await readRepoFile(path,branch);
    if(!current.sha)throw new Error(`CODING_COMPACT_EDIT_FILE_MISSING:${path}`);
    const content=applyCompactEdits(current.content,pathEdits);
    await writeFile(branch,{path,content});
  }
}
async function generateChanges(worker,j,context,reviewIssues=[],exclude=[]){const prompt=`You are ${worker.id}, an autonomous TigerIQ repository engineer. Implement ONLY the assigned task on a GitHub branch.\nTASK: ${j.instruction}\nALLOWED PATHS: ${j.paths.join(', ')}\n${reviewIssues.length?`REVIEW ISSUES TO FIX: ${JSON.stringify(reviewIssues)}\n`:''}CURRENT FILES:\n${context}\nReturn ONLY JSON {"summary":"short","changes":[{"path":"exact allowed path","content":"complete replacement UTF-8 file content"}]}. Do not touch paths outside ALLOWED PATHS. Never output secrets. Keep changes minimal and testable.`;const validateData=d=>{validateChanges(d.changes,j.paths);validateJobScope(j.paths,d.changes)};const invoked=await invokeJsonWithFailover(worker,prompt,{exclude,validateData});const d=invoked.data;return {payload:d,resource:invoked.resource}}
async function reviewPr(reviewer,j,diff,implementerId,extraExclude=[]){const prompt=`You are ${reviewer.id}, independent TigerIQ code reviewer. Review against the task and safety boundaries. TASK: ${j.instruction}\nDIFF:\n${diff.slice(0,180000)}\nReturn ONLY JSON {"decision":"approve|changes_requested","summary":"short","issues":["specific issue"]}. Reject unsafe, untested, out-of-scope, credential/security/production changes.`;const invoked=await invokeJsonWithFailover(reviewer,prompt,{exclude:[implementerId,...extraExclude]});const d=invoked.data;if(!['approve','changes_requested'].includes(d.decision)){const e=new Error('REVIEW_DECISION_INVALID');e.code='REVIEW_SCHEMA_INVALID';throw e}d.issues=Array.isArray(d.issues)?d.issues.slice(0,8):[];return {review:d,resource:invoked.resource}}

async function runJob(j){
  const cooldownExcludes=activeProviderCooldownIds(j.failure);
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
