import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { applyChatMutationOwnerHandoff, backlogCanonicalDedupeKey, backlogOwnerControlled, backlogOwnerDirect, bodyValue as policyBodyValue, chatMutationOwnerPlan, isOwnerOnlyP0, routingFault, sortBacklogSpecs } from './github-backlog-policy.mjs';
import { activeRoleClaim, classifyWorkOrder } from './work-routing-policy.mjs';
import { SUPPORTED_PUBLIC_EVIDENCE_KEYS, appendPublicEvidenceToSummary, validatePublicEvidenceKeys } from './public-evidence.mjs';
import { addTerminalBlockedLabel, clearTerminalBlockedLabel } from './github-lifecycle-label.mjs';
import { githubRequestJson } from './github-shared-client.mjs';
import { githubEventIssue, subscribeGithubEvents } from './github-event-bus.mjs';
import { localizeOwnerFacingText, ownerStatusIcon, ownerStatusLabel } from './owner-facing-vietnamese.mjs';
import { isStabilityV2ResourceScope } from './stability-v2.mjs';
import { enqueueFreshLiveMobileTask, liveMobileCompletionToken, liveMobileTaskPrompt } from './mobile-worker-api.mjs';

const DEFAULT_OWNER='newsdayads';
const DEFAULT_REPO='tigeriq-ai-lab';
export const GITHUB_RECONCILE_INTERVAL_MS=30000;
export const GITHUB_LIGHT_HYGIENE_INTERVAL_MS=15*60*1000;
export const GITHUB_DEEP_HYGIENE_INTERVAL_MS=6*60*60*1000;
const DEFAULT_INTERVAL_MS=Number(process.env.TIGERIQ_GITHUB_RECONCILE_MS||GITHUB_RECONCILE_INTERVAL_MS);
const DEFAULT_INITIAL_DELAY_MS=15000;
export const GITHUB_MATERIALIZE_BATCH_DEFAULT=12;
const DEFAULT_MATERIALIZE_BATCH=Math.max(1,Math.min(20,Number(process.env.TIGERIQ_GITHUB_MATERIALIZE_BATCH||GITHUB_MATERIALIZE_BATCH_DEFAULT)));
const MAX_CONTEXT_CHARS=50000;
const SAFE_PATH_RE=/^[A-Za-z0-9._/-]+\.(?:md|mjs|js|ts|json|ya?ml)$/i;
const GITHUB_RATE_LIMIT_FALLBACK_MS=60000;
const GITHUB_RATE_LIMIT_MAX_MS=60*60*1000;

export function githubRateLimitCooldownMs(error,nowMs=Date.now(),fallbackMs=GITHUB_RATE_LIMIT_FALLBACK_MS,maxMs=GITHUB_RATE_LIMIT_MAX_MS){
  const status=Number(error?.status||0);
  const remaining=String(error?.rateLimitRemaining??'');
  const message=String(error?.message||'');
  const limited=status===429||(status===403&&(remaining==='0'||/rate limit/i.test(message)));
  if(!limited)return 0;
  const retryAfter=Number(error?.retryAfter);
  if(Number.isFinite(retryAfter)&&retryAfter>0)return Math.max(1000,Math.min(maxMs,retryAfter*1000));
  const resetSeconds=Number(error?.rateLimitReset);
  if(Number.isFinite(resetSeconds)&&resetSeconds>0){
    const delay=Math.max(1000,resetSeconds*1000-Number(nowMs||Date.now())+1000);
    return Math.min(maxMs,delay);
  }
  return Math.max(1000,Math.min(maxMs,Number(fallbackMs)||GITHUB_RATE_LIMIT_FALLBACK_MS));
}

export function indexOpenGithubIssues(rows=[]){
  const out=new Map();
  for(const issue of Array.isArray(rows)?rows:[]){
    const n=Number(issue?.number);
    if(n)out.set(n,issue);
  }
  return out;
}

export function hasExactFlag(body,key,value='true'){
  return new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}=${value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}$`,'m').test(String(body||''));
}

export function bodyValue(body,key){return policyBodyValue(body,key);}

export function githubIssueSourceRevision(issue={}){
  return createHash('sha256')
    .update(String(issue?.title||''))
    .update('\n')
    .update(String(issue?.body||''))
    .digest('hex')
    .slice(0,12);
}

export function finalLiveReviewJobId(objectiveId='',evidenceKey='',implementationFingerprint='base'){
  const objective=String(objectiveId||'').trim().replace(/[^A-Za-z0-9._-]+/g,'-').slice(0,140);
  const evidence=String(evidenceKey||'').trim().replace(/[^A-Za-z0-9._-]+/g,'-').slice(0,40);
  const implementation=String(implementationFingerprint||'base').trim().replace(/[^A-Za-z0-9._-]+/g,'-').slice(0,20)||'base';
  if(!objective||!evidence)throw new Error('FINAL_LIVE_REVIEW_JOB_ID_REQUIRED');
  return `JOB-${objective}-FINAL-LIVE-REVIEW-${evidence}-${implementation}`;
}

function employeeControlValues(body=''){
  return ['IMPLEMENTER_EMPLOYEE','IMPLEMENTER','ASSIGNED_EXECUTOR','EXECUTOR','PRIMARY_EMPLOYEE']
    .map((key)=>bodyValue(body,key).toUpperCase())
    .filter((value)=>/^NV\d{2}$/.test(value));
}

export async function implementationReviewContext(pool,{objectiveId='',metadata={},sourceBody=''}={}){
  const rows=objectiveId
    ? (await pool.query("select id,status,employee_id,resource_id,completed_at from tigeriq_jobs where objective_id=$1 and capability<>'review' order by id",[objectiveId])).rows
    : [];
  const implementerEmployeeIds=new Set(employeeControlValues(sourceBody));
  const implementerResourceIds=new Set();
  for(const key of ['assignedExecutor','implementerEmployeeId','codingExecutor','requestedWorker','targetWorker']){
    const value=String(metadata?.[key]||'').trim().toUpperCase();
    if(/^NV\d{2}$/.test(value))implementerEmployeeIds.add(value);
  }
  for(const row of rows){
    const employee=String(row.employee_id||'').trim().toUpperCase();
    const resource=String(row.resource_id||'').trim();
    if(employee)implementerEmployeeIds.add(employee);
    if(resource)implementerResourceIds.add(resource);
  }
  const terminalStatuses=new Set(['done','failed']);
  const blockingJobs=rows.filter((row)=>!terminalStatuses.has(String(row.status||'').toLowerCase())).map((row)=>String(row.id||''));
  const fingerprint=createHash('sha256').update(JSON.stringify({
    rows:rows.map((row)=>({
      id:String(row.id||''),
      status:String(row.status||'').toLowerCase(),
      employeeId:String(row.employee_id||'').toUpperCase(),
      resourceId:String(row.resource_id||''),
      completedAt:row.completed_at?String(row.completed_at):'',
    })),
    implementerEmployeeIds:[...implementerEmployeeIds].sort(),
    implementerResourceIds:[...implementerResourceIds].sort(),
  })).digest('hex').slice(0,16);
  return {
    blockingJobs,
    implementationTerminal:blockingJobs.length===0,
    implementerEmployeeIds:[...implementerEmployeeIds],
    implementerResourceIds:[...implementerResourceIds],
    fingerprint,
  };
}

export async function trustedFinalLiveReviewEvidence(pool,{objectiveId='',sourceRevision='',evidenceKey='',implementationContext=null}={}){
  const expected=String(sourceRevision||'').trim().toLowerCase();
  const context=implementationContext||{implementerEmployeeIds:[],implementerResourceIds:[],fingerprint:'base',implementationTerminal:true};
  if(!objectiveId||!expected||!evidenceKey)return {accepted:false,reason:'trusted_review_input_missing'};
  if(context.implementationTerminal===false)return {accepted:false,reason:'implementation_not_terminal',blockingJobs:context.blockingJobs||[]};
  const jobId=finalLiveReviewJobId(objectiveId,evidenceKey,context.fingerprint);
  const job=(await pool.query("select id,status,employee_id,resource_id,provider,result,failure,attempts,max_attempts from tigeriq_jobs where id=$1 and objective_id=$2 and capability='review' and (kind='github_review' or kind='ui')",[jobId,objectiveId])).rows[0]||null;
  if(!job)return {accepted:false,reason:'trusted_review_missing',jobId};
  if(String(job.status||'').toLowerCase()!=='done')return {accepted:false,reason:`trusted_review_${String(job.status||'unknown').toLowerCase()}`,jobId};
  const review=job.result?.reviewEvidence||null;
  const employeeId=String(job.employee_id||'').trim().toUpperCase();
  const resourceId=String(job.resource_id||'').trim();
  const excludedEmployees=new Set((context.implementerEmployeeIds||[]).map(x=>String(x||'').trim().toUpperCase()).filter(Boolean));
  const excludedResources=new Set((context.implementerResourceIds||[]).map(x=>String(x||'').trim()).filter(Boolean));
  if(!review||String(review.decision||'').toUpperCase()!=='PASS'||String(review.targetHead||'').toLowerCase()!==expected)return {accepted:false,reason:'trusted_review_not_pass',jobId,employeeId:employeeId||null,resourceId:resourceId||null};
  if(!employeeId||!resourceId)return {accepted:false,reason:'trusted_reviewer_identity_missing',jobId};
  if(excludedEmployees.has(employeeId)||excludedResources.has(resourceId))return {accepted:false,reason:'trusted_reviewer_not_independent',jobId,employeeId,resourceId};
  return {accepted:true,jobId,employeeId,resourceId,provider:String(job.provider||''),review,implementationFingerprint:context.fingerprint};
}

export async function selectUiFinalReviewer(pool,implementationContext={}){
  const excluded=new Set((implementationContext?.implementerEmployeeIds||[]).map((x)=>String(x||'').trim().toUpperCase()).filter(Boolean));
  const active=await pool.query("select employee_id from tigeriq_jobs where kind='ui' and status in ('ui_assigned','ui_running') and employee_id=any($1::text[])",[['NV03','NV04']]);
  const busy=new Set(active.rows.map((row)=>String(row.employee_id||'').trim().toUpperCase()).filter(Boolean));
  for(const workerId of ['NV03','NV04']){
    if(!excluded.has(workerId)&&!busy.has(workerId))return workerId;
  }
  return '';
}
function uiReviewerResourceId(workerId){return 'res:ui:'+String(workerId||'').trim().toLowerCase()+':subscription:chrome';}

export async function ensureFinalLiveReviewJob(pool,row,{comments=[],sourceRevision='',evidenceKey='',evidenceCommentId=null,implementationContext=null,sourceBody=''}={}){
  const context=implementationContext||{implementationTerminal:true,fingerprint:'base'};
  if(context.implementationTerminal===false)return {jobId:null,state:'WAIT_IMPLEMENTATION',blockingJobs:context.blockingJobs||[]};
  const jobId=finalLiveReviewJobId(row.id,evidenceKey,context.fingerprint);
  const all=Array.isArray(comments)?comments:[];
  const selected=evidenceCommentId==null?null:all.find((comment)=>String(comment?.id??'')===String(evidenceCommentId));
  const recent=[...all].reverse().filter((comment)=>!selected||String(comment?.id??'')!==String(selected?.id??'')).slice(0,39);
  const evidenceRows=[...(selected?[selected]:[]),...recent];
  const evidenceText=evidenceRows.map((comment)=>`COMMENT_ID=${comment?.id??''}\n${String(comment?.body||'').slice(0,5000)}`).join('\n\n---\n\n').slice(0,30000);
  const prompt=[
    `TARGET_HEAD=${sourceRevision}`,
    `FINAL_LIVE_REVIEW_FOR_GITHUB_ISSUE=#${Number(row.metadata?.issueNumber)||0}`,
    `IMPLEMENTATION_FINGERPRINT=${context.fingerprint}`,
    'You are the independent final acceptance reviewer. Review only the supplied CURRENT source revision, source policy, objective summary, and durable evidence. Do not perform source mutation.',
    'PASS only if all required acceptance conditions are terminal and the evidence supports the current source revision.',
    'Return exactly:',
    '[TIGERIQ_INDEPENDENT_REVIEW_V1]',
    'REVIEW=PASS|CHANGES_REQUIRED',
    `TARGET_HEAD=${sourceRevision}`,
    'SUMMARY=<short finding>',
    'FINDINGS=<specific findings or NONE>',
    '',
    'SOURCE_POLICY:',
    String(sourceBody||'').slice(0,10000)||'NONE',
    '',
    'OBJECTIVE_SUMMARY:',
    String(row.summary||'').slice(0,4000)||'NONE',
    '',
    'DURABLE_EVIDENCE_NEWEST_FIRST:',
    evidenceText||'NONE',
  ].join('\n');
  let existing=(await pool.query("select status,attempts,max_attempts,employee_id,kind,resource_id,provider,routing_decision from tigeriq_jobs where id=$1",[jobId])).rows[0]||null;
  let uiReviewer='';
  if(!existing){
    uiReviewer=await selectUiFinalReviewer(pool,context).catch(()=>'');
    if(uiReviewer){
      const resourceId=uiReviewerResourceId(uiReviewer);
      await pool.query("insert into tigeriq_jobs(id,objective_id,title,prompt,capability,kind,status,employee_id,resource_id,provider,routing_profile,routing_decision,max_attempts) values($1,$2,$3,$4,'review','ui','ui_assigned',$5,$6,'ui','UI',$7,2) on conflict(id) do nothing",[jobId,row.id,`Final acceptance review GitHub #${Number(row.metadata?.issueNumber)||row.id}`,prompt,uiReviewer,resourceId,JSON.stringify({authority:'CORE_UI_FINAL_REVIEW',workerId:uiReviewer,reason:uiReviewer==='NV03'?'NV03_PRIMARY_FINAL_REVIEW':'NV04_REVIEW_OVERFLOW',sourceRevision})]);
    }else{
      await pool.query("insert into tigeriq_jobs(id,objective_id,title,prompt,capability,kind,status,max_attempts) values($1,$2,$3,$4,'review','github_review','queued',2) on conflict(id) do nothing",[jobId,row.id,`Final acceptance review GitHub #${Number(row.metadata?.issueNumber)||row.id}`,prompt]);
    }
    existing=(await pool.query("select status,attempts,max_attempts,employee_id,kind,resource_id,provider,routing_decision from tigeriq_jobs where id=$1",[jobId])).rows[0]||null;
  }
  if(existing&&String(existing.status||'').toLowerCase()==='failed'&&Number(existing.attempts||0)<Number(existing.max_attempts||2)){
    if(String(existing.kind||'')==='ui'){
      await pool.query("update tigeriq_jobs set status='ui_assigned',result=null,failure=null,lease_until=null,started_at=null,completed_at=null,next_attempt_at=null where id=$1",[jobId]);
      return {jobId,state:'UI_ASSIGNED',workerId:String(existing.employee_id||'')||null};
    }
    await pool.query("update tigeriq_jobs set status='queued',employee_id=null,resource_id=null,provider=null,result=null,failure=null,lease_until=null,started_at=null,completed_at=null,next_attempt_at=null where id=$1",[jobId]);
    return {jobId,state:'REQUEUED'};
  }
  return {jobId,state:String(existing?.status||(uiReviewer?'ui_assigned':'queued')).toUpperCase(),workerId:String(existing?.employee_id||uiReviewer||'')||null};
}

export function parseLiveAcceptanceEvidence(comments=[],{sourceRevision='',finalReviewRequired=false}={}){
  const expected=String(sourceRevision||'').trim();
  if(!expected)return {accepted:false,reason:'source_revision_missing'};
  const rows=Array.isArray(comments)?[...comments].reverse():[];
  for(const comment of rows){
    const body=String(comment?.body||'');
    const pass=hasExactFlag(body,'LIVE_ACCEPTANCE_PASS');
    const explicitFail=hasExactFlag(body,'LIVE_ACCEPTANCE_PASS','false')||(!pass&&hasExactFlag(body,'DONE','false'));
    if(!pass&&!explicitFail)continue;
    const revision=(bodyValue(body,'SOURCE_REVISION')||bodyValue(body,'LIVE_ACCEPTANCE_SOURCE_REVISION')).trim();
    if(revision&&revision!==expected)continue;
    if(explicitFail)return {accepted:false,reason:'live_acceptance_explicitly_not_passed',commentId:comment?.id??null};
    if(revision!==expected)return {accepted:false,reason:'live_acceptance_revision_missing',commentId:comment?.id??null};
    if(finalReviewRequired===true)return {accepted:false,reason:'trusted_final_review_required',commentId:comment?.id??null};
    return {accepted:true,revision,reviewer:null,commentId:comment?.id??null};
  }
  return {accepted:false,reason:'live_acceptance_evidence_missing'};
}

const TERMINAL_DEPENDENCY_POLICIES=new Set(['REQUIRE_PARENT_GATE_PASS','REQUIRE_ALL_PARENT_GATES_PASS','REQUIRE_ALL_TERMINAL_ACCEPTED']);

export function githubDependencySpec(body='',currentNumber=0){
  const text=String(body||'');
  const policy=bodyValue(text,'DEPENDENCY_POLICY').trim().toUpperCase();
  if(!TERMINAL_DEPENDENCY_POLICIES.has(policy))return {required:false,policy,dependencies:[]};
  const raw=[bodyValue(text,'DEPENDS_ON'),bodyValue(text,'ADDITIONAL_DEPENDENCY')].filter(Boolean).join(',');
  const dependencies=[]; const seen=new Set([Number(currentNumber)]);
  for(const match of raw.matchAll(/#(\d{1,6})/g)){
    const n=Number(match[1]);
    if(!n||seen.has(n))continue;
    seen.add(n);dependencies.push(n);
  }
  return {required:true,policy,dependencies};
}

export async function githubTerminalDependencyGate(fetchImpl,owner,repo,token,sourceIssue,openIssueIndex=null){
  const spec=githubDependencySpec(sourceIssue?.body||'',sourceIssue?.number);
  if(!spec.required)return {allow:true,reason:'dependency_policy_not_required',...spec};
  if(spec.dependencies.length===0)return {allow:false,reason:'dependency_reference_missing',...spec};
  const states=[];
  for(const dependency of spec.dependencies){
    let issue;
    try{
      issue=await resolveGithubSourceIssue(fetchImpl,owner,repo,token,dependency,openIssueIndex);
    }catch(error){
      if(githubRateLimitCooldownMs(error)>0)throw error;
      return {allow:false,reason:'dependency_lookup_failed',dependency,error:String(error?.message||error),...spec,states};
    }
    const state=String(issue?.state||'unknown').toLowerCase();
    const stateReason=String(issue?.state_reason||'').toLowerCase();
    const accepted=state==='closed'&&stateReason==='completed';
    states.push({dependency,state,stateReason,accepted});
    if(!accepted)return {allow:false,reason:'dependency_not_terminal_accepted',dependency,state,stateReason,...spec,states};
  }
  return {allow:true,reason:'dependencies_terminal_accepted',...spec,states};
}

export function objectiveCompletionGate(metadata={}){
  const sourceRevision=String(metadata?.sourceRevision||'').trim();
  if(metadata?.dependencyGateRequired===true&&metadata?.dependencyGatePass!==true)return {allow:false,reason:'dependency_pending'};
  if(metadata?.liveAcceptanceRequired===true){
    const liveRevision=String(metadata?.liveAcceptanceRevision||'').trim();
    if(!(metadata?.liveAcceptancePass===true&&sourceRevision&&liveRevision===sourceRevision))return {allow:false,reason:'live_acceptance_pending'};
  }
  if(metadata?.finalReviewRequired===true){
    const reviewRevision=String(metadata?.finalReviewRevision||'').trim();
    if(!(metadata?.finalReviewPass===true&&sourceRevision&&reviewRevision===sourceRevision&&metadata?.finalReviewerEmployeeId&&metadata?.finalReviewerResourceId&&metadata?.finalReviewImplementationFingerprint))return {allow:false,reason:'final_review_pending'};
  }
  return {allow:true,reason:'acceptance_satisfied'};
}

export function preferredUiWorker(body){
  const preferred=bodyValue(body,'PREFERRED_REVIEWER').toUpperCase();
  if(preferred==='NV03'||preferred==='NV04')return preferred;
  const primary=bodyValue(body,'PRIMARY_EMPLOYEE').toUpperCase();
  return primary==='NV03'||primary==='NV04'?primary:'';
}

export function githubDispatchLane(capability='reasoning'){
  const cap=String(capability||'reasoning').toLowerCase();
  if(cap==='pc_operator')return 'PC_OPERATOR';
  if(cap==='review')return 'CORE_REVIEW';
  if(cap==='mobile_worker')return 'MOBILE_WORKER';
  return 'CORE_REASONING';
}

export function isBoundedAppChromeRequestOnly(body){
  const b=String(body||'');
  if(!hasExactFlag(b,'APP_CHROME_REQUEST_ONLY'))return false;
  if(!hasExactFlag(b,'OWNER_DIRECT')||!hasExactFlag(b,'NO_CODE_CHANGE')||!hasExactFlag(b,'NO_PC01_SHELL'))return false;
  if(bodyValue(b,'CAPABILITY')!=='pc_operator')return false;
  const scope=bodyValue(b,'RESOURCE_SCOPE');
  if(!/^APP_CHROME_(?:DEPLOY_)?REQUEST_STATE(?:_|$)/i.test(scope)&&!/^PC01_STATE_APP_CHROME_DEPLOY_REQUEST(?:_|$)/i.test(scope))return false;
  const assigned=extractPcOperatorInstruction(b);
  if(!assigned||!/tigeriq_pc\s+file_(?:write|read)/i.test(assigned))return false;
  if(/(?:cmd|powershell|shell_exec|start_process|Desktop Commander)/i.test(assigned))return false;
  if(/D:\\TigerIQ\\Apps\\ChromeController/i.test(assigned))return false;
  return /D:\\TigerIQ\\State\\appchrome-install-request\.json/i.test(assigned);
}

export function githubSpecBlockedByActive(spec,activeMetadata=[]){
  const scope=String(spec?.resourceScope||'');
  if(!scope)return false;
  return (Array.isArray(activeMetadata)?activeMetadata:[]).some((metadata)=>String(metadata?.resourceScope||'')===scope);
}

export function normalizeWorkOrderScopeFamily(value=''){
  return String(value||'').trim().toUpperCase()
    .replace(/(?:_V\d+|_RETRY(?:_\d+)?|_REARM(?:_\d+)?)(?=_|$)/g,'')
    .replace(/_20\d{6}(?:\d{0,6})?$/,'')
    .replace(/_+/g,'_')
    .replace(/^_|_$/g,'');
}

export function normalizeWorkOrderIntentTitle(value=''){
  return String(value||'').trim().toLowerCase()
    .replace(/\[nv\d{2}\]/gi,'')
    .replace(/\b(?:retry|rearm)\b(?:\s*#?\d+)?/gi,'')
    .replace(/\bv\d+\b/gi,'')
    .replace(/[^a-z0-9]+/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

export function workOrderDedupIdentity(spec={}){
  const body=String(spec?.body||'');
  const scope=normalizeWorkOrderScopeFamily(spec?.resourceScope||bodyValue(body,'RESOURCE_SCOPE'));
  const reviewOnly=spec?.capability==='review'||hasExactFlag(body,'REVIEW_ONLY')||bodyValue(body,'CAPABILITY').toLowerCase()==='review';
  if(reviewOnly)return `review:${Number(spec?.number||0)}:${scope}`;
  return backlogCanonicalDedupeKey({...spec,resourceScope:scope});
}

function explicitCanonicalIssueNumber(spec={}){
  const body=String(spec?.body||'');
  const raw=bodyValue(body,'CANONICAL_SPEC')||bodyValue(body,'CANONICAL_ISSUE')||bodyValue(body,'SUPERSEDED_BY');
  const match=String(raw||'').match(/#?(\d{1,9})/);
  return match?Number(match[1]):null;
}

function preferCanonicalWorkOrder(a,b){
  if(!a)return b;
  if(!b)return a;
  const aExplicit=bodyValue(a.body||'','CANONICAL_WORK').toLowerCase()==='true'||bodyValue(a.body||'','CANONICAL').toLowerCase()==='true';
  const bExplicit=bodyValue(b.body||'','CANONICAL_WORK').toLowerCase()==='true'||bodyValue(b.body||'','CANONICAL').toLowerCase()==='true';
  if(aExplicit!==bExplicit)return aExplicit?a:b;
  const aPoints=explicitCanonicalIssueNumber(a);
  const bPoints=explicitCanonicalIssueNumber(b);
  if(aPoints===Number(a.number))return a;
  if(bPoints===Number(b.number))return b;
  if(aPoints===Number(b.number))return b;
  if(bPoints===Number(a.number))return a;
  return Number(a?.number||Number.MAX_SAFE_INTEGER)<=Number(b?.number||Number.MAX_SAFE_INTEGER)?a:b;
}

export function dedupeBacklogWorkOrders(specs=[]){
  const byKey=new Map();
  const unkeyed=[];
  for(const spec of Array.isArray(specs)?specs:[]){
    const key=workOrderDedupIdentity(spec);
    if(!key){unkeyed.push(spec);continue}
    byKey.set(key,preferCanonicalWorkOrder(byKey.get(key),spec));
  }
  return [...byKey.values(),...unkeyed];
}

export function eventBacklogDedupeDecision(eventSpec,specs=[]){
  if(!eventSpec)return {duplicate:false,canonical:null,key:''};
  const key=workOrderDedupIdentity(eventSpec);
  if(!key)return {duplicate:false,canonical:eventSpec,key:''};
  const matches=(Array.isArray(specs)?specs:[]).filter((spec)=>workOrderDedupIdentity(spec)===key);
  let canonical=eventSpec;
  for(const spec of matches)canonical=preferCanonicalWorkOrder(canonical,spec);
  return {duplicate:Number(canonical?.number)!==Number(eventSpec?.number),canonical,key};
}

export function githubBacklogHygieneSweepPlan({nowMs=Date.now(),lastLightMs=0,lastDeepMs=0,running=false,lightIntervalMs=GITHUB_LIGHT_HYGIENE_INTERVAL_MS,deepIntervalMs=GITHUB_DEEP_HYGIENE_INTERVAL_MS}={}){
  if(running)return {kind:'NONE',reason:'ALREADY_RUNNING'};
  const now=Number(nowMs)||Date.now();
  const lightDue=now-Number(lastLightMs||0)>=Math.max(1000,Number(lightIntervalMs)||GITHUB_LIGHT_HYGIENE_INTERVAL_MS);
  const deepDue=now-Number(lastDeepMs||0)>=Math.max(1000,Number(deepIntervalMs)||GITHUB_DEEP_HYGIENE_INTERVAL_MS);
  if(deepDue)return {kind:'DEEP',reason:'DEEP_INTERVAL_DUE'};
  if(lightDue)return {kind:'LIGHT',reason:'LIGHT_INTERVAL_DUE'};
  return {kind:'NONE',reason:'NOT_DUE'};
}

function hygieneSpecFromIssue(issue={}){
  if(!issue||issue.pull_request||issue.state!=='open')return null;
  const body=String(issue.body||'');
  const title=String(issue.title||'');
  if(isOwnerOnlyP0(body,title))return null;
  const state=bodyValue(body,'CURRENT_STATE').toUpperCase();
  const autoQueue=bodyValue(body,'AUTO_QUEUE').toUpperCase();
  if(bodyValue(body,'DONE').toLowerCase()==='true'||/SUPERSEDED|COMPLETED/.test(state)||autoQueue.startsWith('EXCLUDED_DUPLICATE')||autoQueue.startsWith('EXCLUDED_TERMINAL'))return null;
  const resourceScope=bodyValue(body,'RESOURCE_SCOPE');
  if(!resourceScope)return null;
  return {
    number:Number(issue.number),
    title,
    body,
    resourceScope,
    priority:bodyValue(body,'PRIORITY').toUpperCase()||'P3',
    capability:bodyValue(body,'CAPABILITY').toLowerCase(),
    updatedAt:String(issue.updated_at||''),
  };
}

function leaseExpiryMs(body=''){
  for(const key of ['LEASE_UNTIL','MUTATION_LEASE_UNTIL','CHAT_SESSION_LEASE_UNTIL']){
    const raw=bodyValue(body,key);
    const ms=Date.parse(raw);
    if(raw&&Number.isFinite(ms))return {key,raw,ms};
  }
  return null;
}

function mutationOwnerReleasedValue(value=''){
  const owner=String(value||'').trim().toUpperCase();
  return !owner||['NONE','NONE_TERMINAL','RELEASED','UNASSIGNED','UNCLAIMED'].includes(owner);
}

function mutationOwnerHasActiveLease(body='',nowMs=Date.now()){
  const owner=bodyValue(body,'MUTATION_OWNER');
  if(mutationOwnerReleasedValue(owner))return false;
  const expiry=leaseExpiryMs(body);
  if(expiry&&expiry.ms<=Number(nowMs||Date.now()))return false;
  const active=bodyValue(body,'ACTIVE_LEASE').toLowerCase();
  const leaseState=bodyValue(body,'LEASE_STATE').toUpperCase();
  if(active==='false'||leaseState==='RELEASED')return false;
  if(active==='true'||leaseState==='ACTIVE'||expiry)return true;
  return true;
}

export function backlogHygieneFindings(issues=[],nowMs=Date.now()){
  const rows=(Array.isArray(issues)?issues:[]).filter((issue)=>issue&&!issue.pull_request);
  const open=rows.filter((issue)=>issue.state==='open');
  const specs=open.map(hygieneSpecFromIssue).filter(Boolean);
  const groups=new Map();
  for(const spec of specs){
    const key=workOrderDedupIdentity(spec);
    if(!key)continue;
    const list=groups.get(key)||[];
    list.push(spec);
    groups.set(key,list);
  }
  const duplicates=[];
  for(const [key,list] of groups){
    if(list.length<2)continue;
    let canonical=null;
    for(const spec of list)canonical=preferCanonicalWorkOrder(canonical,spec);
    for(const spec of list){
      if(Number(spec.number)===Number(canonical?.number))continue;
      duplicates.push({issueNumber:Number(spec.number),canonicalIssueNumber:Number(canonical?.number),key});
    }
  }
  const terminalExecutable=[];
  const closedExecutableMarkers=[];
  const staleLeases=[];
  const orphanLeases=[];
  const parkedHoldingLease=[];
  const parentChildDrift=[];
  const now=Number(nowMs)||Date.now();
  const issueIndex=new Map(rows.map((issue)=>[Number(issue?.number),issue]));
  for(const issue of open){
    const body=String(issue.body||'');
    if(isOwnerOnlyP0(body,issue.title||''))continue;
    const executable=bodyValue(body,'TIGERIQ_EXECUTABLE').toLowerCase()==='true'||bodyValue(body,'AUTO_QUEUE').toUpperCase()==='INCLUDED';
    if(bodyValue(body,'DONE').toLowerCase()==='true'&&executable)terminalExecutable.push({issueNumber:Number(issue.number)});
    const owner=bodyValue(body,'MUTATION_OWNER');
    const expiry=leaseExpiryMs(body);
    if(expiry&&expiry.ms<=now&&!mutationOwnerReleasedValue(owner)){
      staleLeases.push({issueNumber:Number(issue.number),owner,leaseKey:expiry.key,leaseUntil:expiry.raw});
    }
    const activeLease=bodyValue(body,'ACTIVE_LEASE').toLowerCase();
    const leaseState=bodyValue(body,'LEASE_STATE').toUpperCase();
    if(!expiry&&!mutationOwnerReleasedValue(owner)&&(activeLease==='false'||leaseState==='RELEASED')){
      orphanLeases.push({issueNumber:Number(issue.number),owner,activeLease,leaseState});
    }
    const state=bodyValue(body,'CURRENT_STATE').toUpperCase();
    const parked=/^(?:WAIT|WAITING|BLOCKED|PARKED|EXTERNAL_WAIT|CHỜ|BỊ_CHẶN)/.test(state);
    if(parked&&!mutationOwnerReleasedValue(owner)){
      parkedHoldingLease.push({issueNumber:Number(issue.number),owner,state});
    }
    const childRaw=bodyValue(body,'ACTIVE_CHILD')||bodyValue(body,'CURRENT_CHILD');
    const childMatch=String(childRaw||'').match(/#?(\d{1,9})/);
    if(childMatch){
      const child=issueIndex.get(Number(childMatch[1]));
      if(child&&child.state==='closed')parentChildDrift.push({issueNumber:Number(issue.number),childIssueNumber:Number(child.number),reason:'CLOSED_CHILD_STILL_ACTIVE'});
    }
  }
  for(const issue of rows.filter((row)=>row?.state==='closed')){
    const body=String(issue.body||'');
    if(isOwnerOnlyP0(body,issue.title||''))continue;
    const executable=bodyValue(body,'TIGERIQ_EXECUTABLE').toLowerCase()==='true'||bodyValue(body,'AUTO_QUEUE').toUpperCase()==='INCLUDED';
    if(executable)closedExecutableMarkers.push({issueNumber:Number(issue.number),reason:'CLOSED_SOURCE_STILL_EXECUTABLE'});
  }
  return {duplicates,terminalExecutable,closedExecutableMarkers,staleLeases,orphanLeases,parkedHoldingLease,parentChildDrift};
}

function prependBodyOverride(body,lines=[]){
  const block=(Array.isArray(lines)?lines:[]).filter(Boolean).join('\n');
  return block+'\n\n'+String(body||'');
}

function releaseLeaseBody(body=''){
  return prependBodyOverride(body,[
    'MUTATION_OWNER=NONE',
    'LEASE_STATE=RELEASED',
    'ACTIVE_LEASE=false',
  ]);
}

function terminalNormalizeBody(body=''){
  return prependBodyOverride(body,[
    'TIGERIQ_EXECUTABLE=false',
    'AUTO_QUEUE=EXCLUDED_TERMINAL',
    'MUTATION_OWNER=NONE',
    'LEASE_STATE=RELEASED',
    'ACTIVE_LEASE=false',
  ]);
}

function duplicateSupersedeBody(body='',canonicalIssueNumber=0){
  return prependBodyOverride(body,[
    'CURRENT_STATE=SUPERSEDED_DUPLICATE',
    'TIGERIQ_EXECUTABLE=false',
    'AUTO_QUEUE=EXCLUDED_DUPLICATE',
    'MUTATION_OWNER=NONE',
    'LEASE_STATE=RELEASED',
    'ACTIVE_LEASE=false',
    'DONE=true',
    'SUPERSEDED_BY=#'+Number(canonicalIssueNumber),
  ]);
}

async function patchIssueBody(fetchImpl,owner,repo,token,issueNumber,body){
  if(!token)return false;
  await ghJson(fetchImpl,'https://api.github.com/repos/'+owner+'/'+repo+'/issues/'+Number(issueNumber),token,{
    method:'PATCH',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({body:String(body||'')}),
  });
  return true;
}

export async function runGithubBacklogHygieneSweep({pool,fetchImpl=fetch,owner=DEFAULT_OWNER,repo=DEFAULT_REPO,token='',openIssues=[],kind='LIGHT',nowMs=Date.now()}={}){
  const normalizedKind=String(kind||'LIGHT').toUpperCase()==='DEEP'?'DEEP':'LIGHT';
  let rows=Array.isArray(openIssues)?openIssues:[];
  if(normalizedKind==='DEEP'){
    const since=new Date((Number(nowMs)||Date.now())-7*24*60*60*1000).toISOString();
    rows=await ghJson(fetchImpl,'https://api.github.com/repos/'+owner+'/'+repo+'/issues?state=all&per_page=100&sort=updated&direction=desc&since='+encodeURIComponent(since),token,{freshMs:0});
  }
  const findings=backlogHygieneFindings(rows,nowMs);
  const byNumber=new Map(rows.map((issue)=>[Number(issue?.number),issue]));
  const actions={duplicatesSuperseded:0,leasesReleased:0,terminalNormalized:0};
  const touched=new Set();

  for(const finding of findings.duplicates){
    const issue=byNumber.get(Number(finding.issueNumber));
    if(!issue||issue.state!=='open'||touched.has(Number(issue.number)))continue;
    const body=String(issue.body||'');
    if(mutationOwnerHasActiveLease(body,nowMs))continue;
    if(await patchIssueBody(fetchImpl,owner,repo,token,issue.number,duplicateSupersedeBody(body,finding.canonicalIssueNumber))){
      touched.add(Number(issue.number));
      actions.duplicatesSuperseded++;
    }
  }

  const releaseCandidates=[...findings.staleLeases,...findings.orphanLeases,...findings.parkedHoldingLease];
  for(const finding of releaseCandidates){
    const issue=byNumber.get(Number(finding.issueNumber));
    if(!issue||issue.state!=='open'||touched.has(Number(issue.number)))continue;
    if(await patchIssueBody(fetchImpl,owner,repo,token,issue.number,releaseLeaseBody(issue.body||''))){
      touched.add(Number(issue.number));
      actions.leasesReleased++;
    }
  }

  for(const finding of findings.terminalExecutable){
    const issue=byNumber.get(Number(finding.issueNumber));
    if(!issue||issue.state!=='open'||touched.has(Number(issue.number)))continue;
    if(await patchIssueBody(fetchImpl,owner,repo,token,issue.number,terminalNormalizeBody(issue.body||''))){
      touched.add(Number(issue.number));
      actions.terminalNormalized++;
    }
  }

  const eventData={kind:normalizedKind,at:new Date(Number(nowMs)||Date.now()).toISOString(),counts:{
    duplicates:findings.duplicates.length,
    terminalExecutable:findings.terminalExecutable.length,
    closedExecutableMarkers:findings.closedExecutableMarkers.length,
    staleLeases:findings.staleLeases.length,
    orphanLeases:findings.orphanLeases.length,
    parkedHoldingLease:findings.parkedHoldingLease.length,
    parentChildDrift:findings.parentChildDrift.length,
  },actions};
  try{await pool?.query?.("insert into tigeriq_events(type,data) values('GITHUB_BACKLOG_HYGIENE_SWEEP',$1)",[JSON.stringify(eventData)]);}catch{}
  return {...eventData,findings};
}

export function extractPcOperatorInstruction(body){
  const text=String(body||'');
  const match=text.match(/(?:^|\n)(?:##\s*)?ASSIGNED_ACTION\s*\n([\s\S]*?)(?=\n(?:##\s*)?ACCEPTANCE\s*\n|$)/i);
  return String(match?.[1]||'').trim();
}

const PC_OPERATOR_DIRECT_READ_ONLY_ACTIONS=new Set(['task_status','task_list','process_list','tcp_probe','file_read','file_list','file_stat','core_status_read','coding_issue_status_read','android_worker_gate_c_v020_status','android_worker_gate_c_v021_status','android_worker_live_v022_status','paperclip_lab_preflight','paperclip_lab_health']);
const PC_OPERATOR_DIRECT_MUTATING_ACTIONS=new Set(['task_start','task_stop','task_restart','android_worker_release_build','android_worker_sign_current_ci_artifact','android_worker_sign_v020_ci_artifact','android_worker_sign_v020_user_context','android_worker_sign_v021_ci_artifact','android_worker_grant_v020_signer_read_acl','android_worker_export_v020_signed_apk_chunk','android_worker_publish_v020_manifest','android_worker_export_v021_signed_apk_chunk','android_worker_publish_v021_manifest','android_worker_export_current_signed_apk_chunk','android_worker_publish_current_manifest','android_worker_gate_c_v020_enqueue_10','android_worker_gate_c_v021_enqueue_10','tigeriq_live_3150_production_deploy','chrome_ui_reconcile_cancelled_job','paperclip_lab_broker_install','paperclip_openai_device_auth_start','paperclip_lab_install','paperclip_lab_start','paperclip_lab_stop']);

export function parsePcOperatorDirectAction(body,ownerDirect=false){
  const text=String(body||'');
  const raw=text.match(/^PC_OPERATOR_DIRECT_ACTION_JSON=(\{.*\})$/m)?.[1];
  if(raw==null)return {present:false,valid:true,action:null};
  let parsed;
  try{parsed=JSON.parse(raw)}catch{return {present:true,valid:false,action:null,reason:'JSON_INVALID'}}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return {present:true,valid:false,action:null,reason:'OBJECT_REQUIRED'};
  const action=String(parsed.action||'');
  if(action==='shell_exec'||action==='file_write'||action.startsWith('pad_'))return {present:true,valid:false,action:null,reason:'ACTION_FORBIDDEN'};
  const readOnly=PC_OPERATOR_DIRECT_READ_ONLY_ACTIONS.has(action);
  const mutating=PC_OPERATOR_DIRECT_MUTATING_ACTIONS.has(action);
  if(!readOnly&&!mutating)return {present:true,valid:false,action:null,reason:'ACTION_NOT_ALLOWLISTED'};
  if(mutating&&!ownerDirect)return {present:true,valid:false,action:null,reason:'OWNER_DIRECT_REQUIRED'};
  let normalized;
  if(action.startsWith('task_')&&action!=='task_list'){
    const taskName=String(parsed.taskName||'').trim();
    if(!/^TigerIQ [A-Za-z0-9 ._()#-]{1,100}$/.test(taskName))return {present:true,valid:false,action:null,reason:'TASK_NOT_ALLOWLISTED'};
    normalized={action,taskName};
  }else if(action==='coding_issue_status_read'){
    const issueNumber=Number(parsed.issueNumber);
    if(!Number.isInteger(issueNumber)||issueNumber<1||issueNumber>999999)return {present:true,valid:false,action:null,reason:'ISSUE_NUMBER_INVALID'};
    normalized={action,issueNumber};
  }else if(action==='core_status_read'){
    normalized={action};
  }else if(action==='tcp_probe'){
    normalized={action,host:String(parsed.host||'127.0.0.1'),port:Number(parsed.port)};
  }else if(action==='paperclip_openai_device_auth_start'){
    const sessionId=String(parsed.sessionId||'').trim().toLowerCase();
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(sessionId))return {present:true,valid:false,action:null,reason:'SESSION_ID_INVALID'};
    normalized={action,sessionId};
  }else if(action==='android_worker_export_v020_signed_apk_chunk'||action==='android_worker_export_v021_signed_apk_chunk'||action==='android_worker_export_current_signed_apk_chunk'){
    const chunkIndex=Number(parsed.chunkIndex);
    const maxIndex=action==='android_worker_export_current_signed_apk_chunk'?255:31;
    if(!Number.isInteger(chunkIndex)||chunkIndex<0||chunkIndex>maxIndex)return {present:true,valid:false,action:null,reason:'CHUNK_INDEX_INVALID'};
    normalized={action,chunkIndex};
  }else if(action==='android_worker_publish_v021_manifest'||action==='android_worker_publish_current_manifest'){
    const driveFileId=String(parsed.driveFileId||'').trim();
    if(!/^[A-Za-z0-9_-]{10,200}$/.test(driveFileId))return {present:true,valid:false,action:null,reason:'DRIVE_FILE_ID_INVALID'};
    normalized={action,driveFileId};
  }else if(action==='chrome_ui_reconcile_cancelled_job'){
    const workerId=String(parsed.workerId||'').trim().toUpperCase();
    if(!['NV03','NV04'].includes(workerId))return {present:true,valid:false,action:null,reason:'CORE_UI_WORKER_INVALID'};
    normalized={action,workerId};
  }else if(action==='tigeriq_live_3150_production_deploy'){
    const expectedSha=String(parsed.expectedSha||'').trim().toLowerCase();
    if(!/^[0-9a-f]{40}$/.test(expectedSha))return {present:true,valid:false,action:null,reason:'EXPECTED_SHA_INVALID'};
    if(!hasExactFlag(text,'OWNER_RELEASE_AUTHORIZED'))return {present:true,valid:false,action:null,reason:'OWNER_RELEASE_AUTH_REQUIRED'};
    const releaseReason=bodyValue(text,'VERCEL_RELEASE_REASON').trim();
    if(!releaseReason)return {present:true,valid:false,action:null,reason:'RELEASE_REASON_REQUIRED'};
    normalized={action,expectedSha,releaseClass:'WEB_LIVE',ownerAuthorized:true,releaseReason};
  }else if(action.startsWith('file_')){
    normalized={action,path:String(parsed.path||'')};
  }else{
    normalized={action};
  }
  return {present:true,valid:true,action:normalized,mutating};
}

export function isManualOnlyAppChromeMaintenance(title,body){
  const t=String(title||'');
  const b=String(body||'');
  return /\[APP-CHROME\]/i.test(t)
    || /^RESOURCE_SCOPE=APP_CHROME_/mi.test(b)
    || /^ALLOW_PATH_PREFIX=apps\/chrome-controller(?:\/|$)/mi.test(b)
    || /apps\/chrome-controller\//i.test(b)
    || /^APP_CHROME_REQUEST_ONLY=true$/mi.test(b)
    || /appchrome-install-request\.json/i.test(b);
}

const SAFE_AUTO_WORK_PRIORITIES=new Set(['P1','P2','P3','P4','P5']);
const SAFE_AUTO_RELEASED_OWNERS=new Set(['','NONE','NONE_TERMINAL','RELEASED','UNASSIGNED','CORE_DYNAMIC_LEASE']);

export function githubDependencyAdmissionBlocked(body){
  const text=String(body||'');
  const state=bodyValue(text,'CURRENT_STATE').toUpperCase();
  if(/(?:WAITING|WAIT|BLOCKED).*?(?:DEPENDENCY|PARENT_GATE)|(?:DEPENDENCY|PARENT_GATE).*?(?:WAITING|WAIT|BLOCKED)/.test(state))return true;
  const blockedBy=bodyValue(text,'BLOCKED_BY').trim().toUpperCase();
  if(blockedBy&&!['NONE','NO','CLEAR','CLEARED'].includes(blockedBy))return true;
  const dependency=bodyValue(text,'DEPENDENCY_STATUS').trim().toUpperCase();
  if(dependency&&!['PASS','DONE','COMPLETED','SATISFIED','CLEAR','CLEARED'].includes(dependency))return true;
  return false;
}

export function explicitAutoExecutionExclusion(body=''){
  const text=String(body||'');
  const executable=bodyValue(text,'TIGERIQ_EXECUTABLE').trim().toLowerCase();
  if(executable==='false')return 'EXPLICIT_EXECUTION_DISABLED';
  const autoQueue=bodyValue(text,'AUTO_QUEUE').trim().toUpperCase();
  if(autoQueue==='EXCLUDED'||autoQueue.startsWith('EXCLUDED_'))return 'AUTO_QUEUE_EXCLUDED';
  return '';
}

export function androidProductAutoExecutionExclusion(issue){
  const body=String(issue?.body||'');
  const title=String(issue?.title||'');
  const resourceScope=bodyValue(body,'RESOURCE_SCOPE').trim().toUpperCase();
  if(/\[ANDROID\]/i.test(title)||resourceScope.startsWith('ANDROID_'))return 'ANDROID_PRODUCT_OWNER_DIRECT';
  if(!/\[MOBILE-WORKER\]/i.test(title))return '';
  if(/^NV\d+_REAL_WORK_/i.test(resourceScope))return '';
  const syntheticScope=/^NV\d+_(?:V\d+_|REMOTE_NO_USB_)/i.test(resourceScope);
  const syntheticInstruction=/TRẢ LỜI ĐÚNG MỘT DÒNG:/i.test(body);
  const syntheticTitle=/\b(?:SMOKE TEST|COMPATIBILITY SMOKE|END-TO-END ACCEPTANCE)\b/i.test(title);
  return syntheticScope||syntheticInstruction||syntheticTitle?'ANDROID_PRODUCT_OWNER_DIRECT':'';
}

export function safeAutoWorkAdmission(issue){
  if(!issue||issue.pull_request||issue.state!=='open')return {eligible:false,reason:'NOT_OPEN_ISSUE'};
  const body=String(issue.body||'');
  const title=String(issue.title||'');
  const explicitExclusion=explicitAutoExecutionExclusion(body);
  if(explicitExclusion)return {eligible:false,reason:explicitExclusion};
  const publicEvidenceRequest=validatePublicEvidenceKeys(body);
  if(publicEvidenceRequest.unsupported.length)return {eligible:false,reason:'PUBLIC_EVIDENCE_KEYS_UNSUPPORTED',unsupportedPublicEvidenceKeys:publicEvidenceRequest.unsupported};
  const androidProductExclusion=androidProductAutoExecutionExclusion(issue);
  if(androidProductExclusion)return {eligible:false,reason:androidProductExclusion};
  const priority=bodyValue(body,'PRIORITY').toUpperCase();
  if(!SAFE_AUTO_WORK_PRIORITIES.has(priority)||isOwnerOnlyP0(body,title))return {eligible:false,reason:'P0_OR_INVALID_PRIORITY'};
  const ownerPolicy=bodyValue(body,'OWNER_POLICY').toUpperCase();
  if(ownerPolicy&&!['AUTO','AUTO_AFTER_GATE'].includes(ownerPolicy))return {eligible:false,reason:'OWNER_POLICY_NOT_AUTO'};
  if(backlogOwnerControlled(body)
    ||hasExactFlag(body,'OWNER_ACCEPTANCE_REQUIRED')
    ||hasExactFlag(body,'OWNER_REVIEW_REQUIRED')
    ||hasExactFlag(body,'MANUAL_GATE'))return {eligible:false,reason:'OWNER_OR_HOLD_GATE'};
  if(isManualOnlyAppChromeMaintenance(title,body))return {eligible:false,reason:'APP_CHROME_EXCLUDED'};
  if(githubDependencyAdmissionBlocked(body))return {eligible:false,reason:'DEPENDENCY_BLOCKED'};
  const state=bodyValue(body,'CURRENT_STATE').toUpperCase();
  if(/(?:WAITING|WAIT|CHỜ).*OWNER|OWNER_REVIEW_REQUIRED|OWNER_ACCEPTANCE_REQUIRED|HOLD/.test(state))return {eligible:false,reason:'OWNER_WAIT_STATE'};
  if(issueLabelNames(issue).some((name)=>name.toLowerCase()==='tigeriq:terminal-blocked'))return {eligible:false,reason:'TERMINAL_BLOCKED'};
  const classification=classifyWorkOrder(body);
  if(['HOLD_OWNER','UI'].includes(classification.route))return {eligible:false,reason:'OWNER_OR_UI_ROUTE'};
  if(classification.route==='OPENCLAW')return {eligible:false,reason:'SPECIALIST_CONTRACT_REQUIRED'};
  const resourceScope=bodyValue(body,'RESOURCE_SCOPE');
  if(!resourceScope)return {eligible:false,reason:'RESOURCE_SCOPE_REQUIRED'};
  const mutationOwner=bodyValue(body,'MUTATION_OWNER').toUpperCase();
  const ownerReleased=SAFE_AUTO_RELEASED_OWNERS.has(mutationOwner)||/_WHEN_CLAIMED$/.test(mutationOwner);
  if(!ownerReleased)return {eligible:false,reason:'MUTATION_OWNER_CONFLICT'};
  const safeFlags=['NO_PRODUCTION_RELEASE','NO_PAID_COST','NO_CREDENTIAL_CHANGE','NO_SECURITY_BOUNDARY_CHANGE','NO_DESTRUCTIVE'];
  if(safeFlags.some((key)=>!hasExactFlag(body,key)))return {eligible:false,reason:'HARD_GATE_SAFETY_FLAGS_INCOMPLETE'};
  const requiresCodingHandoff=classification.route==='CODING';
  if(requiresCodingHandoff&&!hasExactFlag(body,'NO_DIRECT_MAIN'))return {eligible:false,reason:'DIRECT_MAIN_GUARD_REQUIRED'};
  return {eligible:true,reason:'SAFE_P1_P5_POLICY',classification,resourceScope,requiresCodingHandoff};
}

export function parseExecutableIssue(issue){
  if(!issue||issue.pull_request||issue.state!=='open')return null;
  const body=String(issue.body||'');
  const title=String(issue.title||'');
  if(chatMutationOwnerPlan(body,title).owner==='VY')return null;
  if(isOwnerOnlyP0(body,title))return null;
  if(androidProductAutoExecutionExclusion(issue))return null;
  const legacyExecutable=hasExactFlag(body,'TIGERIQ_EXECUTABLE')
    &&hasExactFlag(body,'OWNER_POLICY','AUTO')
    &&hasExactFlag(body,'NO_CODE_CHANGE')
    &&hasExactFlag(body,'NO_PC01_SHELL');
  const policyAdmission=safeAutoWorkAdmission(issue);
  if(!legacyExecutable&&!policyAdmission.eligible)return null;
  if(isManualOnlyAppChromeMaintenance(issue.title,body))return null;
  const classification=policyAdmission.classification||classifyWorkOrder(body);
  if(['HOLD_OWNER','UI'].includes(classification.route))return null;
  if(classification.route==='CODING'&&!policyAdmission.eligible)return null;
  const requiresCodingHandoff=classification.route==='CODING'&&policyAdmission.eligible;
  const capability=classification.route==='OPENCLAW'?'pc_operator':requiresCodingHandoff?'reasoning':classification.capability;
  const resourceScope=bodyValue(body,'RESOURCE_SCOPE');
  if(classification.route==='OPENCLAW'&&(!resourceScope||!extractPcOperatorInstruction(body)))return null;
  const sourceRevision=githubIssueSourceRevision(issue);
  const dispatchLane=classification.route==='OPENCLAW'?'PC_OPERATOR':requiresCodingHandoff?'CORE_REASONING':classification.route;
  const directAction=parsePcOperatorDirectAction(body,backlogOwnerDirect(body));
  if(directAction.present&&!directAction.valid)return null;
  const publicEvidenceRequest=validatePublicEvidenceKeys(body);
  if(publicEvidenceRequest.unsupported.length)return null;
  if(directAction.action?.action==='tigeriq_live_3150_production_deploy'){
    directAction.action.releaseIssue=String(Number(issue.number));
  }
  const strictCoreTarget=hasExactFlag(body,'CORE_TARGET_STRICT');
  const dynamicCoreLane=policyAdmission.eligible&&['CORE_REASONING','CORE_REVIEW'].includes(dispatchLane)&&!strictCoreTarget;
  return {
    number:Number(issue.number),title,body,priority:classification.priority,sourcePriority:classification.sourcePriority,
    legacyP0Autonomous:classification.legacyP0Autonomous,ownerControlled:classification.ownerControlled,
    capability,requestedCapability:classification.capability,dispatchLane,resourceScope,preferredWorker:classification.preferredEmployee||'',requestedWorker:classification.workerId||null,targetWorker:requiresCodingHandoff?null:(dynamicCoreLane?null:(classification.workerId||null)),
    url:String(issue.html_url||''),ownerDirect:backlogOwnerDirect(body),sourceRevision,updatedAt:String(issue.updated_at||''),
    commentCount:Math.max(0,Number(issue.comments||0)),labels:Array.isArray(issue.labels)?issue.labels:[],route:classification.route,publicEvidenceKeys:publicEvidenceRequest.requested,publicEvidenceDiagnostic:hasExactFlag(body,'PUBLIC_EVIDENCE_DIAGNOSTIC'),
    pcOperatorDirectAction:directAction.action||null,
    keepOpenOnStepComplete:hasExactFlag(body,'KEEP_OPEN_ON_STEP_COMPLETE')||requiresCodingHandoff,
    liveAcceptanceRequired:hasExactFlag(body,'LIVE_ACCEPTANCE_REQUIRED'),
    finalReviewRequired:hasExactFlag(body,'FINAL_REVIEW_REQUIRED')||hasExactFlag(body,'FINAL_LIVE_REVIEW_REQUIRED'),
    admissionMode:legacyExecutable?'LEGACY_EXECUTION_FLAGS':'SAFE_P1_P5_POLICY',
    requiresCodingHandoff,
  };
}

export function extractIssueRefs(body,currentNumber){
  const out=[]; const seen=new Set([Number(currentNumber)]);
  for(const m of String(body||'').matchAll(/#(\d{1,6})/g)){
    const n=Number(m[1]); if(!n||seen.has(n)) continue; seen.add(n); out.push(n); if(out.length>=5) break;
  }
  return out;
}

export function extractExplicitContextIssues(body,currentNumber,maxRefs=16){
  const line=String(body||'').match(/^CONTEXT_ISSUES=(.+)$/mi)?.[1];
  if(line==null)return null;
  const limit=Math.max(1,Math.min(16,Number(maxRefs)||16));
  const out=[]; const seen=new Set([Number(currentNumber)]);
  for(const token of String(line).split(',')){
    const match=token.trim().match(/^#?(\d{1,6})$/);
    if(!match)continue;
    const n=Number(match[1]);
    if(!n||seen.has(n))continue;
    seen.add(n); out.push(n);
    if(out.length>=limit)break;
  }
  return out;
}

export function contextIssueRefs(body,currentNumber){
  const explicit=extractExplicitContextIssues(body,currentNumber,16);
  return explicit===null
    ? {explicit:false,refs:extractIssueRefs(body,currentNumber)}
    : {explicit:true,refs:explicit};
}

export function extractRepoPaths(body){
  const out=[]; const seen=new Set();
  for(const m of String(body||'').matchAll(/`([^`]+)`/g)){
    const p=m[1].trim(); if(!SAFE_PATH_RE.test(p)||seen.has(p)) continue; seen.add(p); out.push(p); if(out.length>=5) break;
  }
  return out;
}

export function formatResultComment(row){
  const completed=row?.status==='completed';
  const status=ownerStatusLabel(completed?'COMPLETED':'BLOCKED');
  const summary=localizeOwnerFacingText(String(row?.summary||'Công việc đã kết thúc.').trim().slice(0,5000));
  return `${ownerStatusIcon(completed?'COMPLETED':'BLOCKED')} [KẾT QUẢ] TigerIQ Core ${completed?'đã hoàn tất':'bị chặn'} ${row?.id}.\n\n${summary}\n\nBằng chứng: Core objective \`${row?.id}\` · Trạng thái: ${status}.`;
}

export const EXTERNAL_ROLE_CLAIMED_LABEL='tigeriq:role-claimed';
const EXTERNAL_ROLE_WORKER_PREFIX='tigeriq:role-worker-';

function issueLabelNames(issue){
  return (Array.isArray(issue?.labels)?issue.labels:[])
    .map((label)=>typeof label==='string'?label:String(label?.name||''))
    .filter(Boolean);
}

export function hasExternalRoleClaimLabel(issue){
  return issueLabelNames(issue).some((name)=>name.toLowerCase()===EXTERNAL_ROLE_CLAIMED_LABEL);
}

export function externalRoleClaimedWorkerId(issue){
  for(const name of issueLabelNames(issue)){
    const match=String(name).toLowerCase().match(/^tigeriq:role-worker-(nv\d{2})$/);
    if(match)return match[1].toUpperCase();
  }
  return null;
}

function externalRoleWorkerLabel(workerId){
  const id=String(workerId||'').trim().toLowerCase();
  return /^nv\d{2}$/.test(id)?EXTERNAL_ROLE_WORKER_PREFIX+id:'';
}

async function ensureExternalRoleLabel(fetchImpl,owner,repo,token,label,color,description){
  if(!token)return false;
  try{
    await ghJson(fetchImpl,`https://api.github.com/repos/${owner}/${repo}/labels`,token,{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({name:label,color,description})
    });
  }catch(error){
    const text=JSON.stringify(error?.body||{})+' '+String(error?.message||'');
    if(Number(error?.status)!==422||!/(already_exists|already exists|validation failed)/i.test(text))throw error;
  }
  return true;
}

async function addExternalRoleLabel(fetchImpl,owner,repo,issueNumber,token,label,color,description){
  await ensureExternalRoleLabel(fetchImpl,owner,repo,token,label,color,description);
  await ghJson(fetchImpl,`https://api.github.com/repos/${owner}/${repo}/issues/${Number(issueNumber)}/labels`,token,{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({labels:[label]})
  });
}

async function clearExternalRoleLabel(fetchImpl,owner,repo,issueNumber,token,label){
  try{
    await ghJson(fetchImpl,`https://api.github.com/repos/${owner}/${repo}/issues/${Number(issueNumber)}/labels/${encodeURIComponent(label)}`,token,{method:'DELETE'});
  }catch(error){
    if(Number(error?.status)!==404)throw error;
  }
}

export async function syncExternalRoleClaimLabels({fetchImpl=fetch,owner=DEFAULT_OWNER,repo=DEFAULT_REPO,token='',issue,workerId=null,active=false}={}){
  if(!issue||!token)return {changed:false};
  const number=Number(issue.number);
  const labels=issueLabelNames(issue);
  const hasClaim=hasExternalRoleClaimLabel(issue);
  const currentWorker=externalRoleClaimedWorkerId(issue);
  const desiredWorker=externalRoleWorkerLabel(workerId);
  let changed=false;

  if(active){
    if(!hasClaim){
      await addExternalRoleLabel(fetchImpl,owner,repo,number,token,EXTERNAL_ROLE_CLAIMED_LABEL,'1d76db','TigerIQ external role claim is active; queue projection must not dispatch this Work Order.');
      changed=true;
    }
    if(desiredWorker&&currentWorker!==String(workerId||'').toUpperCase()){
      for(const label of labels.filter((name)=>/^tigeriq:role-worker-nv\d{2}$/i.test(name))){
        await clearExternalRoleLabel(fetchImpl,owner,repo,number,token,label);
      }
      await addExternalRoleLabel(fetchImpl,owner,repo,number,token,desiredWorker,'5319e7','TigerIQ external role claim worker identity for Live projection.');
      changed=true;
    }
    return {changed,active:true,workerId:String(workerId||'').toUpperCase()||null};
  }

  if(hasClaim){
    await clearExternalRoleLabel(fetchImpl,owner,repo,number,token,EXTERNAL_ROLE_CLAIMED_LABEL);
    changed=true;
  }
  for(const label of labels.filter((name)=>/^tigeriq:role-worker-nv\d{2}$/i.test(name))){
    await clearExternalRoleLabel(fetchImpl,owner,repo,number,token,label);
    changed=true;
  }
  return {changed,active:false,workerId:null};
}

async function ghJson(fetchImpl,url,token='',init={}){
  const opts=String(init.method||'GET').toUpperCase()==='GET'&&init.freshMs==null?{...init,freshMs:0}:init;
  return githubRequestJson(fetchImpl,url,token,opts);
}

export async function resolveGithubSourceIssue(fetchImpl,owner,repo,token,issueNumber,openIssueIndex=null){
  const n=Number(issueNumber);
  if(openIssueIndex instanceof Map&&openIssueIndex.has(n))return openIssueIndex.get(n);
  return ghJson(fetchImpl,`https://api.github.com/repos/${owner}/${repo}/issues/${n}`,token);
}

export async function hydrateContext(fetchImpl,owner,repo,spec,token){
  const chunks=[`SOURCE ISSUE #${spec.number}: ${spec.title}\nURL: ${spec.url}\n\n${spec.body}`];
  const contextRefs=contextIssueRefs(spec.body,spec.number);
  for(const n of contextRefs.refs){
    try{
      const x=await ghJson(fetchImpl,`https://api.github.com/repos/${owner}/${repo}/issues/${n}`,token);
      chunks.push(`REFERENCED ISSUE #${n}: ${x.title||''}\n${x.body||''}`);
    }catch(error){
      if(githubRateLimitCooldownMs(error)>0)throw error;
      if(contextRefs.explicit)chunks.push(`REFERENCED ISSUE #${n}: UNAVAILABLE\nERROR: ${String(error?.message||error).slice(0,160)}`);
    }
  }
  for(const path of extractRepoPaths(spec.body)){
    try{
      const x=await ghJson(fetchImpl,`https://api.github.com/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=main`,token);
      if(x?.encoding==='base64'&&x?.content){chunks.push(`REPOSITORY FILE ${path}:\n${Buffer.from(x.content,'base64').toString('utf8')}`);}
    }catch(error){
      if(githubRateLimitCooldownMs(error)>0)throw error;
    }
  }
  return chunks.join('\n\n---\n\n').slice(0,MAX_CONTEXT_CHARS);
}

async function commentIssue(fetchImpl,owner,repo,issueNumber,body,token){
  if(!token) return false;
  await ghJson(fetchImpl,`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`,token,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({body})});
  return true;
}

async function closeIssue(fetchImpl,owner,repo,issueNumber,token){
  if(!token) return false;
  await ghJson(fetchImpl,`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`,token,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({state:'closed',state_reason:'completed'})});
  return true;
}

export async function reconcileStaleChatMutationOwner({fetchImpl=fetch,owner=DEFAULT_OWNER,repo=DEFAULT_REPO,token='',issue,nowMs=Date.now()}={}){
  if(!issue||issue.pull_request||issue.state!=='open')return {changed:false,reason:'NOT_OPEN_ISSUE',issue};
  const applied=applyChatMutationOwnerHandoff(issue.body||'',issue.title||'',nowMs);
  if(!applied.changed)return {changed:false,reason:applied.plan.reason,issue};
  if(!token)return {changed:false,reason:'TOKEN_REQUIRED',issue};
  const updated=await ghJson(fetchImpl,`https://api.github.com/repos/${owner}/${repo}/issues/${Number(issue.number)}`,token,{
    method:'PATCH',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({body:applied.body})
  });
  return {changed:true,reason:applied.plan.reason,issue:{...issue,...updated,body:applied.body}};
}


export async function cleanupTerminalObjectiveJobs({pool}={}){
  if(!pool)throw new Error('CORE_GITHUB_POOL_REQUIRED');
  const reason={kind:'ORPHANED_BY_TERMINAL_OBJECTIVE',message:'Parent objective is terminal; queued/waiting_resource job cannot remain claimable.'};
  const q=await pool.query(`update tigeriq_jobs j
    set status='failed',lease_until=null,completed_at=coalesce(completed_at,now()),failure=coalesce(failure,'{}'::jsonb)||$1::jsonb
    where j.status in ('queued','waiting_resource')
      and exists(select 1 from tigeriq_objectives o where o.id=j.objective_id and o.status in ('completed','blocked'))
    returning j.id,j.objective_id`,[JSON.stringify(reason)]);
  return {cleaned:q.rowCount||0,jobs:q.rows||[]};
}

function rearmKey(spec){
  const stamp=String(spec.updatedAt||'').replace(/\D/g,'').slice(0,14)||'nostamp';
  return `${spec.sourceRevision}-${stamp}`;
}

export function githubPcOperatorJobId(objectiveId,issueNumber){
  const number=Number(issueNumber);
  const base=`OBJ-GH-${number}`;
  if(String(objectiveId)===base)return `JOB-GH-${number}-PC`;
  const suffix=createHash('sha256').update(String(objectiveId)).digest('hex').slice(0,12);
  return `JOB-GH-${number}-PC-${suffix}`;
}

export function buildGithubPcOperatorPrompt(assignedAction,publicEvidenceKeys=[],{directAction=false}={}){
  const assigned=String(assignedAction||'').trim();
  const allowed=new Set(SUPPORTED_PUBLIC_EVIDENCE_KEYS);
  const keys=[...new Set((Array.isArray(publicEvidenceKeys)?publicEvidenceKeys:[]).map(String).filter((key)=>allowed.has(key)))];
  const lines=directAction
    ? [
        'Execute ONLY the pre-admitted typed local PC action. Do not invoke model reasoning, select backlog/P0/new work, or infer a different action.',
        '',
        'ASSIGNED ACTION:',
        assigned,
      ]
    : [
        'Execute ONLY this bounded PC action through NV06/OpenClaw. Do not choose backlog, P0, or new work. Use approved tigeriq_pc/tigeriq_runtime tools only.',
        '',
        'ASSIGNED ACTION:',
        assigned,
      ];
  if(keys.length){
    lines.push(
      '',
      'PUBLIC EVIDENCE CONTRACT:',
      `REQUESTED_PUBLIC_EVIDENCE_KEYS=${keys.join(',')}`,
      'If the assigned tool returns JSON/file content, parse it and copy ONLY the requested keys that are actually present into the final structured evidence object.',
      'Do not echo raw file content, contentSnippet/content_snippet, stdout/stderr, environment, secrets, credentials, tokens, passwords, API keys, cookies, sessions, or unrequested fields.',
      'If a requested key is absent, omit it; never invent a value.',
    );
  }
  const prompt=lines.join('\n');
  if(!directAction&&prompt.length>6000)throw new Error('OPENCLAW_INSTRUCTION_INVALID');
  return prompt;
}

async function readActiveExternalRoleClaim(fetchImpl,owner,repo,token,spec){
  if(Number(spec?.commentCount||0)<=0)return null;
  try{
    const comments=await ghJson(fetchImpl,`https://api.github.com/repos/${owner}/${repo}/issues/${spec.number}/comments?per_page=100`,token);
    return activeRoleClaim(comments);
  }catch(error){
    if(githubRateLimitCooldownMs(error)>0)throw error;
    return null;
  }
}

async function recordRoutingFault(pool,data){
  try{
    await pool.query("insert into tigeriq_events(type,data) values('ROUTING_FAULT',$1)",[JSON.stringify(data)]);
    return true;
  }catch{
    return false;
  }
}

async function githubMutationRetryable(task){
  try{return await task();}
  catch(error){
    if(githubRateLimitCooldownMs(error)>0)throw error;
    return false;
  }
}

function blockedNoticeMarker(reason,sourceRevision=''){
  return `[TIGERIQ_BLOCKED_V1:${String(reason)}:${String(sourceRevision||'')}]`;
}

async function blockedNoticeAlreadyPosted(fetchImpl,owner,repo,token,issueNumber,commentCount,marker){
  if(!token||Number(commentCount||0)<=0)return false;
  const lastPage=Math.max(1,Math.ceil(Number(commentCount||0)/100));
  try{
    const comments=await ghJson(fetchImpl,`https://api.github.com/repos/${owner}/${repo}/issues/${Number(issueNumber)}/comments?per_page=100&page=${lastPage}`,token);
    return (Array.isArray(comments)?comments:[]).some((comment)=>String(comment?.body||'').includes(marker));
  }catch(error){
    if(githubRateLimitCooldownMs(error)>0)throw error;
    return false;
  }
}

async function routingFaultRecorded(pool,issueNumber,reason,sourceRevision=''){
  const result=await pool.query("select 1 from tigeriq_events where type='ROUTING_FAULT' and data->>'issueNumber'=$1 and data->>'reason'=$2 and ($3='' or data->>'sourceRevision'=$3) limit 1",[String(issueNumber),String(reason),String(sourceRevision||'')]).catch(()=>({rowCount:0}));
  return Number(result?.rowCount||0)>0;
}

async function routingFaultOwnerVisibleRecorded(pool,issueNumber,reason,sourceRevision=''){
  const result=await pool.query("select 1 from tigeriq_events where type='ROUTING_FAULT' and data->>'issueNumber'=$1 and data->>'reason'=$2 and ($3='' or data->>'sourceRevision'=$3) and data->>'ownerVisible'='true' limit 1",[String(issueNumber),String(reason),String(sourceRevision||'')]).catch(()=>({rowCount:0}));
  return Number(result?.rowCount||0)>0;
}

function terminalRoutingKey(issueNumber,sourceRevision=''){
  return `${String(issueNumber)}:${String(sourceRevision||'')}`;
}

async function loadOpenClawTerminalState(pool,reason='OPENCLAW_INSTRUCTION_INVALID'){
  const result=await pool.query(`select type,data from tigeriq_events
    where data->>'reason'=$1
      and (
        (type='ROUTING_FAULT' and data->>'terminalBlocked'='true')
        or type='ROUTING_FAULT_CLEAR'
      )`,[String(reason)]);
  const terminalByIssue=new Set();
  const terminalByRevision=new Set();
  const clearedByRevision=new Set();
  for(const row of result?.rows||[]){
    const data=row?.data||{};
    const issueNumber=String(data?.issueNumber||'');
    if(!issueNumber)continue;
    const key=terminalRoutingKey(issueNumber,data?.sourceRevision||'');
    if(row?.type==='ROUTING_FAULT'&&data?.terminalBlocked===true){
      terminalByIssue.add(issueNumber);
      terminalByRevision.add(key);
    }else if(row?.type==='ROUTING_FAULT_CLEAR'){
      clearedByRevision.add(key);
    }
  }
  return {terminalByIssue,terminalByRevision,clearedByRevision};
}

async function recordRoutingFaultClear(pool,data){
  try{
    await pool.query("insert into tigeriq_events(type,data) values('ROUTING_FAULT_CLEAR',$1)",[JSON.stringify(data)]);
    return true;
  }catch{
    return false;
  }
}
export async function reconcileStaleTerminalBlockedRearms({pool,fetchImpl=fetch,owner=DEFAULT_OWNER,repo=DEFAULT_REPO,token='',issues=[]}={}){
  const out=[];
  for(const issue of Array.isArray(issues)?issues:[]){
    const terminalBlocked=issueLabelNames(issue).some((name)=>name.toLowerCase()==='tigeriq:terminal-blocked');
    if(!terminalBlocked){out.push(issue);continue;}
    // pc_operator has a stricter terminal/rearm state machine below. Generic stale-label
    // reconciliation must never pre-clear its durable label or duplicate that lifecycle.
    if(bodyValue(issue?.body||'','CAPABILITY').trim().toLowerCase()==='pc_operator'){
      out.push(issue);
      continue;
    }
    const labelsWithoutTerminal=(Array.isArray(issue.labels)?issue.labels:[]).filter((label)=>{
      const name=typeof label==='string'?label:String(label?.name||'');
      return name.toLowerCase()!=='tigeriq:terminal-blocked';
    });
    const candidate={...issue,labels:labelsWithoutTerminal};
    // Never clear a machine terminal label for an issue that is explicitly non-executable,
    // dependency-held, owner-gated, unsafe, or otherwise ineligible even without the label.
    const admission=safeAutoWorkAdmission(candidate);
    if(!admission.eligible){out.push(issue);continue;}
    const currentRevision=githubIssueSourceRevision(issue);
    const prior=(await pool.query("select id,status,metadata from tigeriq_objectives where metadata->>'source'='github' and metadata->>'issueNumber'=$1 order by created_at desc limit 1",[String(issue.number)])).rows[0]||null;
    const priorRevision=String(prior?.metadata?.sourceRevision||'');
    const stale=Boolean(prior&&prior.status!=='active'&&priorRevision&&priorRevision!==currentRevision);
    if(!stale){out.push(issue);continue;}
    const cleared=await githubMutationRetryable(()=>clearTerminalBlockedLabel({fetchImpl,owner,repo,issueNumber:issue.number,token}));
    if(!cleared){out.push(issue);continue;}
    await recordRoutingFaultClear(pool,{
      source:'github-intake',
      issueNumber:Number(issue.number),
      resourceScope:admission.resourceScope||null,
      reason:'STALE_TERMINAL_LABEL_REARM',
      priorSourceRevision:priorRevision,
      sourceRevision:currentRevision,
      terminalBlockedCleared:true,
    });
    out.push(candidate);
  }
  return out;
}

export const MAX_SAME_REVISION_FALLBACK_REARMS=2;

export function sameRevisionFallbackRearmDecision({prior,spec,rearmCount=0}={}){
  if(!prior||prior.status!=='blocked')return {eligible:false,reason:'PRIOR_NOT_BLOCKED'};
  if(prior.metadata?.coreFallbackReleased!==true)return {eligible:false,reason:'FALLBACK_NOT_RELEASED'};
  if(prior.metadata?.admissionMode!=='SAFE_P1_P5_POLICY')return {eligible:false,reason:'NOT_SAFE_P1_P5'};
  if(!['CORE_REASONING','CORE_REVIEW'].includes(String(prior.metadata?.dispatchLane||'')))return {eligible:false,reason:'LANE_NOT_RETRYABLE'};
  if(String(prior.metadata?.sourceRevision||'')!==String(spec?.sourceRevision||''))return {eligible:false,reason:'REVISION_CHANGED'};
  const count=Math.max(0,Number(rearmCount)||0);
  if(count>=MAX_SAME_REVISION_FALLBACK_REARMS)return {eligible:false,reason:'REARM_BUDGET_EXHAUSTED',count};
  return {eligible:true,reason:'TRANSIENT_FALLBACK_RELEASED',count,ordinal:count+1};
}

async function sameRevisionFallbackRearmPlan(pool,prior,spec){
  if(!prior||String(prior.metadata?.sourceRevision||'')!==String(spec?.sourceRevision||''))return {eligible:false,reason:'REVISION_CHANGED'};
  const count=Number((await pool.query(
    "select count(*)::int as count from tigeriq_objectives where metadata->>'source'='github' and metadata->>'issueNumber'=$1 and metadata->>'sourceRevision'=$2 and coalesce(metadata->>'sameRevisionFallbackRearm','false')='true'",
    [String(spec.number),String(spec.sourceRevision||'')]
  )).rows[0]?.count||0);
  return sameRevisionFallbackRearmDecision({prior,spec,rearmCount:count});
}

async function insertGithubObjectiveIfScopeFree(pool,{id,objective,priority,metadata,resourceScope}){
  const scope=String(resourceScope||'').trim();
  if(!scope){
    const q=await pool.query("insert into tigeriq_objectives(id,objective,priority,status,metadata) values($1,$2,$3,'active',$4) on conflict(id) do nothing returning id",[id,objective,priority,JSON.stringify(metadata)]);
    return q.rowCount===1;
  }
  const q=await pool.query(
    "with locked as materialized (select pg_advisory_xact_lock(hashtext($1)) as guard), inserted as ("+
    "insert into tigeriq_objectives(id,objective,priority,status,metadata) "+
    "select $2,$3,$4,'active',$5 from locked "+
    "where not exists (select 1 from tigeriq_objectives where status='active' and metadata->>'resourceScope'=$1) "+
    "on conflict(id) do nothing returning id) select id from inserted",
    [scope,id,objective,priority,JSON.stringify(metadata)]
  );
  return q.rowCount===1;
}

export async function materializeGithubIssues({pool,fetchImpl=fetch,owner=DEFAULT_OWNER,repo=DEFAULT_REPO,token='',openIssues=null}){
  const cleanup=await cleanupTerminalObjectiveJobs({pool});
  const fetchedRows=Array.isArray(openIssues)?openIssues:await ghJson(fetchImpl,`https://api.github.com/repos/${owner}/${repo}/issues?state=open&per_page=100&sort=updated&direction=desc`,token);
  const rows=await reconcileStaleTerminalBlockedRearms({pool,fetchImpl,owner,repo,token,issues:fetchedRows});
  const specs=sortBacklogSpecs(dedupeBacklogWorkOrders(rows.map(parseExecutableIssue).filter(Boolean)));
  const openIssueIndex=indexOpenGithubIssues(rows);
  const activeRows=(await pool.query("select metadata from tigeriq_objectives where metadata->>'source'='github' and status='active'")).rows||[];
  const activeMetadata=activeRows.map((row)=>row?.metadata||{});
  const hasPcOperator=specs.some((spec)=>spec.capability==='pc_operator');
  const openClawTerminalState=hasPcOperator?await loadOpenClawTerminalState(pool):null;
  let skipped=0,externalClaims=0;
  const createdItems=[];
  const skipReasons={dependency:0,terminalSameRevision:0,activeScope:0,externalClaim:0,existingObjective:0,terminalPcOperator:0,scopeRace:0,other:0};
  for(const spec of specs){
    if(createdItems.length>=DEFAULT_MATERIALIZE_BATCH)break;
    const dependencyGate=await githubTerminalDependencyGate(fetchImpl,owner,repo,token,{number:spec.number,body:spec.body},openIssueIndex);
    if(!dependencyGate.allow){skipped++;skipReasons.dependency++;continue;}
    if(spec.capability==='pc_operator'){
      const reason='OPENCLAW_INSTRUCTION_INVALID';
      const issueKey=String(spec.number);
      const revisionKey=terminalRoutingKey(spec.number,spec.sourceRevision);
      if(openClawTerminalState.terminalByRevision.has(revisionKey)){skipped++;skipReasons.terminalPcOperator++;continue;}
      if(openClawTerminalState.terminalByIssue.has(issueKey)&&!openClawTerminalState.clearedByRevision.has(revisionKey)){
        const cleared=await githubMutationRetryable(()=>clearTerminalBlockedLabel({fetchImpl,owner,repo,issueNumber:spec.number,token}));
        if(!cleared){skipped++;skipReasons.terminalPcOperator++;continue;}
        const clearRecorded=await recordRoutingFaultClear(pool,{source:'github-intake',issueNumber:spec.number,resourceScope:spec.resourceScope||null,reason,sourceRevision:String(spec.sourceRevision||''),terminalBlockedCleared:true});
        if(!clearRecorded){skipped++;skipReasons.terminalPcOperator++;continue;}
        openClawTerminalState.clearedByRevision.add(revisionKey);
      }
    }
    if(githubSpecBlockedByActive(spec,activeMetadata)){skipped++;skipReasons.activeScope++;continue;}
    const prior=(await pool.query("select id,status,metadata from tigeriq_objectives where metadata->>'source'='github' and metadata->>'issueNumber'=$1 order by created_at desc limit 1",[String(spec.number)])).rows[0]||null;
    const roleClaimLabeled=hasExternalRoleClaimLabel(spec);
    const labeledWorker=externalRoleClaimedWorkerId(spec);
    if(prior?.status==='active'){
      if(roleClaimLabeled)await syncExternalRoleClaimLabels({fetchImpl,owner,repo,token,issue:spec,active:false});
      skipped++;continue;
    }
    const sourceChanged=Boolean(prior&&String(prior.metadata?.sourceRevision||'')!==spec.sourceRevision);
    let fallbackRearm={eligible:false,reason:'NOT_APPLICABLE',ordinal:0};
    if(prior&&!sourceChanged){
      fallbackRearm=await sameRevisionFallbackRearmPlan(pool,prior,spec);
      if(!fallbackRearm.eligible){skipped++;skipReasons.terminalSameRevision++;continue;}
    }
    const externalClaim=await readActiveExternalRoleClaim(fetchImpl,owner,repo,token,spec);
    if(externalClaim){
      if(!roleClaimLabeled||labeledWorker!==externalClaim.workerId){
        if(roleClaimLabeled)await syncExternalRoleClaimLabels({fetchImpl,owner,repo,token,issue:spec,active:false});
        await syncExternalRoleClaimLabels({fetchImpl,owner,repo,token,issue:spec,workerId:externalClaim.workerId,active:true});
      }
      externalClaims++;skipped++;skipReasons.externalClaim++;continue;
    }
    if(roleClaimLabeled)await syncExternalRoleClaimLabels({fetchImpl,owner,repo,token,issue:spec,active:false});
    const id=fallbackRearm.eligible?`OBJ-GH-${spec.number}-F${fallbackRearm.ordinal}-${String(spec.sourceRevision||'').slice(0,12)}`:(prior?`OBJ-GH-${spec.number}-R${rearmKey(spec)}`:`OBJ-GH-${spec.number}`);
    const exists=(await pool.query('select 1 from tigeriq_objectives where id=$1',[id])).rowCount>0;
    if(exists){skipped++;skipReasons.existingObjective++;continue;}
    let pcOperatorPrompt=null;
    if(spec.capability==='pc_operator'){
      try{
        pcOperatorPrompt=buildGithubPcOperatorPrompt(
          extractPcOperatorInstruction(spec.body),
          spec.publicEvidenceKeys,
          {directAction:Boolean(spec.pcOperatorDirectAction)},
        );
      }catch(error){
        if(String(error?.message||'')==='OPENCLAW_INSTRUCTION_INVALID'){
          const reason='OPENCLAW_INSTRUCTION_INVALID';
          const sourceRevision=String(spec.sourceRevision||'');
          const marker=blockedNoticeMarker(reason,sourceRevision);
          let ownerVisibleAlready=await routingFaultOwnerVisibleRecorded(pool,spec.number,reason,sourceRevision);
          if(!ownerVisibleAlready){
            ownerVisibleAlready=await blockedNoticeAlreadyPosted(fetchImpl,owner,repo,token,spec.number,spec.commentCount,marker);
            if(ownerVisibleAlready){
              await recordRoutingFault(pool,{source:'github-intake',issueNumber:spec.number,resourceScope:spec.resourceScope||null,reason,sourceRevision,ownerVisible:true,terminalBlocked:false});
            }
          }
          if(!ownerVisibleAlready){
            const ownerVisible=await githubMutationRetryable(()=>commentIssue(fetchImpl,owner,repo,spec.number,`${marker}\n[BLOCKED] TigerIQ Core rejected this Work Order before objective/job materialization because the fully built OpenClaw pc_operator instruction exceeds the 6000-character limit. Shorten ASSIGNED_ACTION/public-evidence instructions, then update the issue to rearm. Reason: ${reason}.`,token));
            if(ownerVisible){
              ownerVisibleAlready=true;
              await recordRoutingFault(pool,{source:'github-intake',issueNumber:spec.number,resourceScope:spec.resourceScope||null,reason,sourceRevision,ownerVisible:true,terminalBlocked:false});
            }else if(!(await routingFaultRecorded(pool,spec.number,reason,sourceRevision))){
              await recordRoutingFault(pool,{source:'github-intake',issueNumber:spec.number,resourceScope:spec.resourceScope||null,reason,sourceRevision,ownerVisible:false,terminalBlocked:false});
            }
          }
          if(ownerVisibleAlready){
            const labelSynced=await githubMutationRetryable(()=>addTerminalBlockedLabel({fetchImpl,owner,repo,issueNumber:spec.number,token}));
            if(labelSynced){
              const terminalRecorded=await recordRoutingFault(pool,{source:'github-intake',issueNumber:spec.number,resourceScope:spec.resourceScope||null,reason,sourceRevision,ownerVisible:true,terminalBlocked:true});
              if(terminalRecorded&&openClawTerminalState){
                openClawTerminalState.terminalByIssue.add(String(spec.number));
                openClawTerminalState.terminalByRevision.add(terminalRoutingKey(spec.number,sourceRevision));
              }
            }
          }
          skipped++;
          continue;
        }
        throw error;
      }
    }
    const context=await hydrateContext(fetchImpl,owner,repo,spec,token);
    const objective=spec.capability==='pc_operator'
      ? (spec.pcOperatorDirectAction
          ? `GitHub bounded PC operator work item #${spec.number}. Core must execute only the pre-admitted typed local action from PC_OPERATOR_DIRECT_ACTION_JSON. Do not invoke model reasoning or infer any different action. NO arbitrary shell, repository source edit, Production/main mutation, paid action, credential/security change, reboot/shutdown, or destructive action. Return structured verified evidence and complete only when that exact action is satisfied.\n\n${context}`
          : `GitHub bounded PC operator work item #${spec.number}. Core must dispatch only the assigned pc_operator action through NV06/OpenClaw. Use approved bounded TigerIQ/OpenClaw tools; NO arbitrary PC01 shell, repository source edit, Production/main mutation, paid action, credential/security change, reboot/shutdown, or destructive action. Return structured verified evidence and complete only when the assigned bounded action is satisfied.\n\n${context}`)
      : spec.requiresCodingHandoff
        ? `GitHub autonomous CORE_REASONING coordination work item #${spec.number}. Analyze and coordinate only. Repository/source mutation must be handed off to the bounded coding executor lane; this API worker must not mutate source or claim coding/review ownership. Do not use PC01 shell, deploy, change credentials/security, spend money, reboot, or perform destructive actions. Preserve one-resource-one-writer and require independent review after implementation.\n\n${context}`
        : `GitHub autonomous ${spec.dispatchLane} work item #${spec.number}. Execute only the read-only task below. Do not edit repository source, use PC01 shell, deploy, change credentials/security, spend money, reboot, or perform destructive actions. Ground conclusions only in supplied GitHub context.\n\n${context}`;
    const metadata={
      source:'github',issueNumber:spec.number,issueUrl:spec.url,capability:spec.capability,requestedCapability:spec.requestedCapability||spec.capability,requestedWorker:spec.requestedWorker||null,preferredWorker:spec.preferredWorker||null,dispatchLane:spec.dispatchLane,resourceScope:spec.resourceScope||null,
      ownerDirect:spec.ownerDirect,ownerControlled:spec.ownerControlled,sourcePriority:spec.sourcePriority,legacyP0Autonomous:spec.legacyP0Autonomous,
      targetWorker:spec.targetWorker||null,sourceRevision:spec.sourceRevision,sourceUpdatedAt:spec.updatedAt,rearmedFromObjectiveId:prior?.id||null,
      dispatchReason:`PRIORITY_${spec.priority}`,executionSurface:spec.dispatchLane==='MOBILE_WORKER'?'MOBILE_WORKER':(spec.capability==='pc_operator'?(spec.pcOperatorDirectAction?'PC_OPERATOR_DIRECT_LOCAL':'CORE_OPENCLAW_BOUNDED'):(spec.requiresCodingHandoff?'CORE_REASONING_COORDINATION':'READ_ONLY')),publicEvidenceKeys:spec.publicEvidenceKeys||[],publicEvidenceDiagnostic:spec.publicEvidenceDiagnostic===true,
      pcOperatorDirectAction:spec.pcOperatorDirectAction||null,
      keepOpenOnStepComplete:spec.keepOpenOnStepComplete===true,
      liveAcceptanceRequired:spec.liveAcceptanceRequired===true,
      finalReviewRequired:spec.finalReviewRequired===true,
      liveAcceptancePass:false,
      liveAcceptanceRevision:null,
      liveAcceptanceEvidenceCommentId:null,
      liveAcceptanceCommentCount:(spec.liveAcceptanceRequired===true||spec.finalReviewRequired===true)?-1:spec.commentCount,
      finalReviewPass:false,
      finalReviewRevision:null,
      finalReviewJobId:null,
      finalReviewerEmployeeId:null,
      finalReviewerResourceId:null,
      finalReviewImplementationFingerprint:null,
      finalReviewImplementerEmployeeIds:[],
      finalReviewImplementerResourceIds:[],
      dependencyGateRequired:dependencyGate.required===true,
      dependencyGatePass:dependencyGate.allow===true,
      dependencyGatePolicy:dependencyGate.policy||null,
      dependencyGateDependencies:dependencyGate.dependencies||[],
      dependencyGateReason:dependencyGate.reason||null,
      admissionMode:spec.admissionMode||'LEGACY_EXECUTION_FLAGS',
      requiresCodingHandoff:spec.requiresCodingHandoff===true,
      ...(fallbackRearm.eligible?{sameRevisionFallbackRearm:true,sameRevisionFallbackRearmOrdinal:fallbackRearm.ordinal,sameRevisionFallbackRearmFromObjectiveId:prior?.id||null}:{}),
    };
    if(spec.dispatchLane==='MOBILE_WORKER'){
      const expectedToken=liveMobileCompletionToken(`github:${spec.number}:${spec.sourceRevision}`);
      const idempotencyKey=`github-mobile:${spec.number}:${spec.sourceRevision}`;
      const taskPrompt=liveMobileTaskPrompt({title:spec.title,body:context,expectedToken});
      const client=await pool.connect();
      try{
        await client.query('begin');
        await client.query('select pg_advisory_xact_lock(hashtext($1))',[idempotencyKey]);
        const mobile=await enqueueFreshLiveMobileTask(client,{idempotencyKey,prompt:taskPrompt,expectedToken});
        const mobileMetadata={
          ...metadata,
          executionSurface:'MOBILE_WORKER',
          mobileTaskId:mobile.taskId,
          mobileRunId:mobile.runId,
          mobileNodeId:mobile.nodeId,
          mobileEmployeeId:mobile.employeeId,
          mobileIdempotencyKey:idempotencyKey,
          mobileExpectedToken:expectedToken,
        };
        await client.query('insert into tigeriq_objectives(id,objective,priority,metadata) values($1,$2,$3,$4) on conflict(id) do nothing',[
          id,
          `GitHub Mobile Worker #${spec.number}. Execute exactly one Core-routed task and return a useful response plus deterministic completion token.\n\n${taskPrompt}`,
          spec.priority,
          JSON.stringify(mobileMetadata),
        ]);
        await client.query("insert into tigeriq_events(type,objective_id,task_kind,data) values('GITHUB_MOBILE_TASK_MATERIALIZED',$1,'mobile_worker',$2)",[
          id,
          JSON.stringify({issueNumber:spec.number,taskId:mobile.taskId,runId:mobile.runId,nodeId:mobile.nodeId,employeeId:mobile.employeeId,executionSurface:'MOBILE_WORKER'})
        ]);
        await client.query("insert into tigeriq_events(type,objective_id,data) values('GITHUB_OBJECTIVE_MATERIALIZED',$1,$2)",[
          id,JSON.stringify({issueNumber:spec.number,issueUrl:spec.url,priority:spec.priority,sourcePriority:spec.sourcePriority,dispatchLane:spec.dispatchLane})
        ]);
        await client.query('commit');
        createdItems.push({issueNumber:spec.number,objectiveId:id,dispatchLane:spec.dispatchLane,mobileTaskId:mobile.taskId});
        continue;
      }catch(error){
        try{await client.query('rollback')}catch{}
        if(String(error?.message||error)==='MOBILE_LIVE_WORKER_UNAVAILABLE'){
          skipped++;
          // The pool is max=1 and this transaction still owns its only client.
          // Record the unavailable-device fault through that same client; querying the
          // pool here would deadlock before finally can release the client.
          await recordRoutingFault(client,{source:'github-intake',issueNumber:spec.number,resourceScope:spec.resourceScope||null,reason:'MOBILE_LIVE_WORKER_UNAVAILABLE',sourceRevision:spec.sourceRevision,ownerVisible:false,terminalBlocked:false});
          continue;
        }
        throw error;
      }finally{client.release();}
    }

    const objectiveInserted=await insertGithubObjectiveIfScopeFree(pool,{id,objective,priority:spec.priority,metadata,resourceScope:spec.resourceScope});
    if(!objectiveInserted){skipped++;skipReasons.scopeRace++;continue;}
    if(fallbackRearm.eligible){
      await pool.query("insert into tigeriq_events(type,objective_id,data) values('GITHUB_SAME_REVISION_FALLBACK_REARMED',$1,$2)",[id,JSON.stringify({issueNumber:spec.number,sourceRevision:spec.sourceRevision,ordinal:fallbackRearm.ordinal,fromObjectiveId:prior?.id||null,resourceScope:spec.resourceScope||null})]);
    }
    if(spec.capability==='pc_operator'){
      const jobId=githubPcOperatorJobId(id,spec.number);
      const prompt=pcOperatorPrompt;
      await pool.query("insert into tigeriq_jobs(id,objective_id,title,prompt,capability,kind,status,max_attempts) values($1,$2,$3,$4,'pc_operator','pc_operator','queued',2) on conflict(id) do nothing",[jobId,id,`GitHub #${spec.number} bounded PC operator`,prompt]);
      await pool.query("insert into tigeriq_events(type,objective_id,job_id,task_kind,data) values('GITHUB_PC_OPERATOR_JOB_MATERIALIZED',$1,$2,'pc_operator',$3)",[id,jobId,JSON.stringify({issueNumber:spec.number,executionSurface:'CORE_OPENCLAW_BOUNDED'})]);
    }else if(spec.admissionMode==='SAFE_P1_P5_POLICY'&&spec.dispatchLane==='CORE_REASONING'&&!isStabilityV2ResourceScope(spec.resourceScope)){
      const jobId=fallbackRearm.eligible?`JOB-${id}-API-AUTOWORK`:`JOB-GH-${spec.number}-API-AUTOWORK`;
      const prompt=spec.requiresCodingHandoff
        ? `Coordinate GitHub Work Order #${spec.number} without repository mutation. Determine the bounded implementation handoff needed, preserve RESOURCE_SCOPE=${spec.resourceScope}, and return concrete acceptance/evidence requirements for the coding executor. Do not perform independent review of implementation produced under this Work Order.`
        : `Execute the safe P1-P5 GitHub Work Order #${spec.number} using only the supplied objective context. Remain read-only with respect to repository source and all hard-gated surfaces.`;
      await pool.query("insert into tigeriq_jobs(id,objective_id,title,prompt,capability,kind,status,max_attempts) values($1,$2,$3,$4,'reasoning','github_api_autowork','queued',2) on conflict(id) do nothing",[jobId,id,`GitHub #${spec.number} API auto-work`,prompt]);
      await pool.query("insert into tigeriq_events(type,objective_id,job_id,task_kind,data) values('GITHUB_API_AUTOWORK_JOB_MATERIALIZED',$1,$2,'github_api_autowork',$3)",[id,jobId,JSON.stringify({issueNumber:spec.number,executionSurface:'CORE_REASONING_COORDINATION',requiresCodingHandoff:spec.requiresCodingHandoff===true})]);
    }
    await pool.query("insert into tigeriq_events(type,objective_id,data) values('GITHUB_OBJECTIVE_MATERIALIZED',$1,$2)",[id,JSON.stringify({issueNumber:spec.number,issueUrl:spec.url,priority:spec.priority,sourcePriority:spec.sourcePriority,dispatchLane:spec.dispatchLane})]);
    createdItems.push({issueNumber:spec.number,objectiveId:id,dispatchLane:spec.dispatchLane});
    continue;
  }
  let idleWorkers=0;
  try{idleWorkers=Number((await pool.query("select count(*)::int as count from tigeriq_ai_resources where enabled=true and current_job_id is null and credential_state in ('LOCAL','READY') and health_state in ('ONLINE','READY')")).rows[0]?.count||0);}catch{}
  const created=createdItems.length;
  const actionableBacklogCount=Math.max(0,specs.length-skipped-created);
  const activeWorkCount=activeMetadata.length+externalClaims+created;
  const fault=routingFault({eligibleBacklogCount:actionableBacklogCount,activeWorkCount,eligibleIdleWorkers:idleWorkers});
  if(fault.fault)await recordRoutingFault(pool,{...fault,source:'github-intake',considered:specs.length,skipped,created,skipReasons});
  const first=createdItems[0]||{};
  return {created,createdItems,skipped,externalClaims,active:activeMetadata.length,considered:specs.length,actionableBacklogCount,skipReasons,cleanedOrphans:cleanup.cleaned,routingFault:fault.fault,...(created===1?first:{})};
}


const ACCEPTANCE_INHERIT_KEYS=[
  'liveAcceptancePass','liveAcceptanceRevision','liveAcceptanceEvidenceCommentId','liveAcceptanceCommentCount',
  'finalReviewPass','finalReviewRevision','finalReviewJobId','finalReviewerEmployeeId','finalReviewerResourceId',
  'finalReviewImplementationFingerprint','finalReviewImplementerEmployeeIds','finalReviewImplementerResourceIds',
];

export function reusableAcceptedSiblingMetadata(currentMetadata={},siblingMetadata={},{
  liveRequired=false,
  finalReviewRequired=false,
}={}){
  const revision=String(currentMetadata?.sourceRevision||'');
  if(!revision||String(siblingMetadata?.sourceRevision||'')!==revision)return null;
  if(String(currentMetadata?.resourceScope||'')!==String(siblingMetadata?.resourceScope||''))return null;
  if(liveRequired&&(siblingMetadata?.liveAcceptancePass!==true||String(siblingMetadata?.liveAcceptanceRevision||'')!==revision))return null;
  if(finalReviewRequired&&(siblingMetadata?.finalReviewPass!==true||String(siblingMetadata?.finalReviewRevision||'')!==revision))return null;
  const patch={};
  for(const key of ACCEPTANCE_INHERIT_KEYS){
    if(Object.prototype.hasOwnProperty.call(siblingMetadata||{},key))patch[key]=siblingMetadata[key];
  }
  return patch;
}

async function inheritClosedAcceptedSiblingCompletion(pool,row,{sourceIssue=null,liveRequired=false,finalReviewRequired=false}={}){
  if(row?.status!=='active'||sourceIssue?.state!=='closed'||String(sourceIssue?.state_reason||'')!=='completed')return null;
  const issueNumber=String(row?.metadata?.issueNumber||'');
  const sourceRevision=String(row?.metadata?.sourceRevision||'');
  if(!issueNumber||!sourceRevision)return null;
  const siblings=(await pool.query(`select id,metadata from tigeriq_objectives
    where id<>$1
      and status='completed'
      and metadata->>'source'='github'
      and metadata->>'issueNumber'=$2
      and metadata->>'sourceRevision'=$3
    order by updated_at desc
    limit 10`,[row.id,issueNumber,sourceRevision])).rows||[];
  for(const sibling of siblings){
    const inherited=reusableAcceptedSiblingMetadata(row.metadata,sibling.metadata,{liveRequired,finalReviewRequired});
    if(!inherited)continue;
    const sourceReason=String(sourceIssue.state_reason||'completed');
    const summary=`duplicate current-revision objective terminalized from accepted sibling ${sibling.id}`;
    const metadataPatch={
      ...inherited,
      acceptanceInheritedFromObjectiveId:sibling.id,
      githubSourceState:'closed',
      githubSourceStateReason:sourceReason,
      githubSourceClosedAt:String(sourceIssue.closed_at||''),
    };
    await pool.query("update tigeriq_objectives set status='completed',summary=$2,metadata=metadata||$3::jsonb,updated_at=now() where id=$1",[row.id,summary,JSON.stringify(metadataPatch)]);
    await cleanupTerminalObjectiveJobs({pool});
    return {siblingId:sibling.id,summary,metadataPatch};
  }
  return null;
}

async function coreFallbackReleaseEligible(pool,row){
  if(row?.status!=='blocked')return false;
  if(row?.metadata?.admissionMode!=='SAFE_P1_P5_POLICY')return false;
  if(!['CORE_REASONING','CORE_REVIEW'].includes(String(row?.metadata?.dispatchLane||'')))return false;
  const job=(await pool.query(
    "select status,failure from tigeriq_jobs where objective_id=$1 and kind='github_api_autowork' order by created_at desc limit 1",
    [row.id]
  )).rows[0]||null;
  return String(job?.status||'').toLowerCase()==='failed';
}

export async function syncGithubOutcomes({pool,fetchImpl=fetch,owner=DEFAULT_OWNER,repo=DEFAULT_REPO,token='',openIssues=null,issueNumbers=null}){
  if(!token) return {claims:0,results:0};
  const openIssueIndex=Array.isArray(openIssues)?indexOpenGithubIssues(openIssues):null;
  const rows=(await pool.query(`select id,status,summary,metadata from tigeriq_objectives
    where metadata->>'source'='github'
      and (
        status='active'
        or coalesce(metadata->>'githubClaimReported','false')<>'true'
        or (status in ('completed','blocked') and coalesce(metadata->>'githubResultReported','false')<>'true')
        or (status='blocked' and coalesce(metadata->>'githubTerminalLabelSynced','false')<>'true')
      )
    order by case when status='active' then 0 else 1 end, updated_at desc, created_at desc
    limit 100`)).rows;
  const issueFilter=Array.isArray(issueNumbers)&&issueNumbers.length?new Set(issueNumbers.map(Number)):null;
  let claims=0,results=0;
  for(const row of rows){
    const number=Number(row.metadata?.issueNumber); if(!number) continue;
    if(issueFilter&&!issueFilter.has(number))continue;
    let sourceIssueForGate=null;
    try{
      sourceIssueForGate=await resolveGithubSourceIssue(fetchImpl,owner,repo,token,number,openIssueIndex);
    }catch(error){
      if(githubRateLimitCooldownMs(error)>0)throw error;
      console.error(JSON.stringify({event:'GITHUB_LIVE_ACCEPTANCE_POLICY_SYNC_ERROR',objectiveId:row.id,issueNumber:number,error:String(error?.message||error)}));
      continue;
    }
    const sourceBody=String(sourceIssueForGate?.body||'');
    const currentSourceRevision=githubIssueSourceRevision(sourceIssueForGate||{});
    const sourceExecutionExclusion=explicitAutoExecutionExclusion(sourceBody);
    if(row.status==='active'&&sourceExecutionExclusion){
      const summary=`source is non-executable (${sourceExecutionExclusion}); retired stale active objective without mutating GitHub source`;
      const exclusionPatch={
        sourceRevision:currentSourceRevision||String(row.metadata?.sourceRevision||''),
        githubSourceExecutionExcluded:true,
        githubSourceExecutionExclusionReason:sourceExecutionExclusion,
        githubResultReported:true,
        githubTerminalLabelSynced:true,
      };
      await pool.query("update tigeriq_objectives set status=$2,summary=$3,metadata=metadata||$4::jsonb,updated_at=now() where id=$1",[row.id,'blocked',summary,JSON.stringify(exclusionPatch)]);
      row.status='blocked';
      row.summary=summary;
      row.metadata={...row.metadata,...exclusionPatch};
      await cleanupTerminalObjectiveJobs({pool});
      continue;
    }
    const sourceLiveRequired=hasExactFlag(sourceBody,'LIVE_ACCEPTANCE_REQUIRED');
    const sourceFinalReviewRequired=hasExactFlag(sourceBody,'FINAL_REVIEW_REQUIRED')||hasExactFlag(sourceBody,'FINAL_LIVE_REVIEW_REQUIRED');
    let dependencyGate;
    try{
      dependencyGate=await githubTerminalDependencyGate(fetchImpl,owner,repo,token,sourceIssueForGate,openIssueIndex);
    }catch(error){
      if(githubRateLimitCooldownMs(error)>0)throw error;
      console.error(JSON.stringify({event:'GITHUB_DEPENDENCY_TERMINAL_GATE_ERROR',objectiveId:row.id,issueNumber:number,error:String(error?.message||error)}));
      continue;
    }
    const revisionChanged=Boolean(currentSourceRevision)&&currentSourceRevision!==String(row.metadata?.sourceRevision||'');
    const policyPatch={
      dependencyGateRequired:dependencyGate.required===true,
      dependencyGatePass:dependencyGate.allow===true,
      dependencyGatePolicy:dependencyGate.policy||null,
      dependencyGateDependencies:dependencyGate.dependencies||[],
      dependencyGateReason:dependencyGate.reason||null,
    };
    if(sourceLiveRequired&&row.metadata?.liveAcceptanceRequired!==true)policyPatch.liveAcceptanceRequired=true;
    if(sourceFinalReviewRequired&&row.metadata?.finalReviewRequired!==true)policyPatch.finalReviewRequired=true;
    // A blocked objective must keep the source revision it actually executed. Otherwise
    // outcome sync can consume a fresh revision before intake sees it and deadlock rearm.
    // Completed objectives intentionally retain legacy backfill/reopen semantics for live/final gates.
    if((sourceLiveRequired||sourceFinalReviewRequired)&&revisionChanged&&row.status!=='blocked'){
      policyPatch.sourceRevision=currentSourceRevision;
      policyPatch.liveAcceptancePass=false;
      policyPatch.liveAcceptanceRevision=null;
      policyPatch.liveAcceptanceEvidenceCommentId=null;
      policyPatch.liveAcceptanceCommentCount=-1;
      policyPatch.finalReviewPass=false;
      policyPatch.finalReviewRevision=null;
      policyPatch.finalReviewJobId=null;
      policyPatch.finalReviewerEmployeeId=null;
      policyPatch.finalReviewerResourceId=null;
      policyPatch.finalReviewImplementationFingerprint=null;
    }else if((sourceLiveRequired||sourceFinalReviewRequired)&&(row.metadata?.liveAcceptanceRequired!==true||row.metadata?.finalReviewRequired!==true)){
      policyPatch.liveAcceptanceCommentCount=-1;
      policyPatch.finalReviewPass=false;
      policyPatch.finalReviewRevision=null;
      policyPatch.finalReviewJobId=null;
      policyPatch.finalReviewerEmployeeId=null;
      policyPatch.finalReviewerResourceId=null;
      policyPatch.finalReviewImplementationFingerprint=null;
    }
    if(Object.keys(policyPatch).length){
      await pool.query("update tigeriq_objectives set metadata=metadata||$2::jsonb,updated_at=now() where id=$1",[row.id,JSON.stringify(policyPatch)]);
      row.metadata={...row.metadata,...policyPatch};
    }

    if(row.status==='completed'&&dependencyGate.required&&!dependencyGate.allow){
      const summary=`completion rejected: dependency gate pending (${dependencyGate.reason}${dependencyGate.dependency?` #${dependencyGate.dependency}`:''})`;
      await pool.query("update tigeriq_objectives set status='active',summary=$2,next_check_at=now()+interval '1 minute',updated_at=now() where id=$1",[row.id,summary]);
      row.status='active';
      row.summary=summary;
    }

    const inheritedAcceptedSibling=dependencyGate.allow?await inheritClosedAcceptedSiblingCompletion(pool,row,{
      sourceIssue:sourceIssueForGate,
      liveRequired:row.metadata?.liveAcceptanceRequired===true,
      finalReviewRequired:row.metadata?.finalReviewRequired===true,
    }):null;
    if(inheritedAcceptedSibling){
      row.status='completed';
      row.summary=inheritedAcceptedSibling.summary;
      row.metadata={...row.metadata,...inheritedAcceptedSibling.metadataPatch};
    }

    if(!inheritedAcceptedSibling&&(row.metadata?.liveAcceptanceRequired===true||row.metadata?.finalReviewRequired===true)){
      try{
        const commentCount=Math.max(0,Number(sourceIssueForGate?.comments||0));
        const checkedCount=Math.max(-1,Number(row.metadata?.liveAcceptanceCommentCount??-1));
        const implementationContext=row.metadata?.finalReviewRequired===true
          ? await implementationReviewContext(pool,{objectiveId:row.id,metadata:row.metadata,sourceBody})
          : null;
        const implementationChanged=Boolean(implementationContext)&&String(row.metadata?.finalReviewImplementationFingerprint||'')!==implementationContext.fingerprint;
        if(row.status==='completed'||commentCount!==checkedCount||row.metadata?.finalReviewRequired===true&&(row.metadata?.finalReviewPass!==true||implementationChanged)){
          const lastPage=Math.max(1,Math.ceil(commentCount/100));
          const comments=await ghJson(fetchImpl,`https://api.github.com/repos/${owner}/${repo}/issues/${number}/comments?per_page=100&page=${lastPage}`,token);
          const evidence=parseLiveAcceptanceEvidence(comments,{sourceRevision:row.metadata?.sourceRevision||'',finalReviewRequired:false});
          const liveRequired=row.metadata?.liveAcceptanceRequired===true;
          const liveSatisfied=!liveRequired||evidence.accepted===true;
          const livePatch={
            liveAcceptancePass:liveRequired&&evidence.accepted===true,
            liveAcceptanceRevision:liveRequired&&evidence.accepted?evidence.revision:null,
            liveAcceptanceEvidenceCommentId:liveRequired&&evidence.accepted?evidence.commentId:null,
            liveAcceptanceCommentCount:commentCount,
            ...(implementationContext?{
              finalReviewImplementerEmployeeIds:implementationContext.implementerEmployeeIds,
              finalReviewImplementerResourceIds:implementationContext.implementerResourceIds,
            }:{}),
          };
          if(row.metadata?.finalReviewRequired===true){
            const reviewTriggerKey=liveRequired
              ? (evidence.accepted?String(evidence.commentId):'')
              : `SOURCE-${row.metadata?.sourceRevision||''}`;
            if(!liveSatisfied){
              Object.assign(livePatch,{finalReviewPass:false,finalReviewRevision:null,finalReviewJobId:null,finalReviewerEmployeeId:null,finalReviewerResourceId:null,finalReviewImplementationFingerprint:null});
            }else if(implementationContext?.implementationTerminal!==true){
              Object.assign(livePatch,{finalReviewPass:false,finalReviewRevision:null,finalReviewJobId:null,finalReviewerEmployeeId:null,finalReviewerResourceId:null,finalReviewImplementationFingerprint:null});
            }else{
              const trusted=await trustedFinalLiveReviewEvidence(pool,{objectiveId:row.id,sourceRevision:row.metadata?.sourceRevision||'',evidenceKey:reviewTriggerKey,implementationContext});
              if(!trusted.accepted){
                const ensured=await ensureFinalLiveReviewJob(pool,row,{comments,sourceRevision:row.metadata?.sourceRevision||'',evidenceKey:reviewTriggerKey,evidenceCommentId:liveRequired?evidence.commentId:null,implementationContext,sourceBody});
                Object.assign(livePatch,{finalReviewPass:false,finalReviewRevision:null,finalReviewJobId:ensured.jobId,finalReviewerEmployeeId:null,finalReviewerResourceId:null,finalReviewImplementationFingerprint:implementationContext.fingerprint});
              }else{
                Object.assign(livePatch,{finalReviewPass:true,finalReviewRevision:row.metadata?.sourceRevision||'',finalReviewJobId:trusted.jobId,finalReviewerEmployeeId:trusted.employeeId,finalReviewerResourceId:trusted.resourceId,finalReviewImplementationFingerprint:implementationContext.fingerprint});
              }
            }
          }
          await pool.query("update tigeriq_objectives set metadata=metadata||$2::jsonb,updated_at=now() where id=$1",[row.id,JSON.stringify(livePatch)]);
          row.metadata={...row.metadata,...livePatch};
        }
      }catch(error){
        if(githubRateLimitCooldownMs(error)>0)throw error;
        console.error(JSON.stringify({event:'GITHUB_LIVE_ACCEPTANCE_SYNC_ERROR',objectiveId:row.id,issueNumber:number,error:String(error?.message||error)}));
        continue;
      }
    }
    const completionGate=objectiveCompletionGate(row.metadata);
    if(row.status==='completed'&&!completionGate.allow){
      const summary='completion rejected: durable LIVE_ACCEPTANCE_PASS for current source revision is missing';
      await pool.query("update tigeriq_objectives set status='active',summary=$2,next_check_at=now()+interval '1 minute',updated_at=now() where id=$1",[row.id,summary]);
      row.status='active';
      row.summary=summary;
    }
    if(row.status==='active'){
      try{
        const sourceIssue=sourceIssueForGate||await resolveGithubSourceIssue(fetchImpl,owner,repo,token,number,openIssueIndex);
        if(sourceIssue?.state==='closed'){
          const sourceReason=String(sourceIssue.state_reason||'closed');
          if(sourceReason==='completed'&&dependencyGate.required&&!dependencyGate.allow){
            const summary=`source close ignored until dependency gate passes (${dependencyGate.reason}${dependencyGate.dependency?` #${dependencyGate.dependency}`:''})`;
            await pool.query("update tigeriq_objectives set status='active',summary=$2,next_check_at=now()+interval '1 minute',updated_at=now() where id=$1",[row.id,summary]);
            row.status='active';
            row.summary=summary;
            continue;
          }
          const terminalStatus=sourceReason==='completed'?'completed':'blocked';
          const terminalSummary=terminalStatus==='completed'
            ? `Source GitHub issue #${number} closed completed; terminalized stale active objective.`
            : `Source GitHub issue #${number} closed (${sourceReason}); terminalized stale active objective fail-closed.`;
          await pool.query("update tigeriq_objectives set status=$2,summary=$3,metadata=metadata||$4::jsonb,updated_at=now() where id=$1",[row.id,terminalStatus,terminalSummary,JSON.stringify({githubSourceState:'closed',githubSourceStateReason:sourceReason,githubSourceClosedAt:String(sourceIssue.closed_at||'')})]);
          row.status=terminalStatus;
          row.summary=terminalSummary;
          row.metadata={...row.metadata,githubSourceState:'closed',githubSourceStateReason:sourceReason,githubSourceClosedAt:String(sourceIssue.closed_at||'')};
        }
      }catch(error){
        if(githubRateLimitCooldownMs(error)>0)throw error;
        console.error(JSON.stringify({event:'GITHUB_SOURCE_STATE_RECONCILE_ERROR',objectiveId:row.id,issueNumber:number,error:String(error?.message||error)}));
      }
    }
    if(row.status==='active'&&row.metadata?.executionSurface==='MOBILE_WORKER'){
      const taskId=String(row.metadata?.mobileTaskId||'').trim();
      if(!taskId){
        row.status='blocked';
        row.summary='mobile worker objective missing bound task id';
        await pool.query("update tigeriq_objectives set status='blocked',summary=$2,updated_at=now() where id=$1",[row.id,row.summary]);
      }else{
        const task=(await pool.query(
          'select task_id,status,employee_id,result,completed_at from tigeriq_mobile_tasks where task_id=$1 limit 1',
          [taskId]
        )).rows[0]||null;
        if(!task){
          row.status='blocked';
          row.summary=`mobile worker task missing; taskId=${taskId}`;
          await pool.query("update tigeriq_objectives set status='blocked',summary=$2,updated_at=now() where id=$1",[row.id,row.summary]);
        }else if(['completed','failed'].includes(String(task.status||'').toLowerCase())){
          const terminal=String(task.status).toLowerCase();
          const output=task.result?.output&&typeof task.result.output==='object'?task.result.output:{};
          const responseText=String(output.responseText||'').trim().slice(0,4000);
          const expectedToken=String(row.metadata?.mobileExpectedToken||'');
          const tokenValid=terminal==='completed'&&expectedToken&&String(output.validatedToken||'')===expectedToken&&responseText.includes(expectedToken);
          if(terminal==='completed'&&!tokenValid){
            row.status='blocked';
            row.summary=`mobile worker completion rejected: deterministic token/response evidence invalid; taskId=${taskId}`;
          }else{
            row.status=terminal==='completed'?'completed':'blocked';
            row.summary=terminal==='completed'
              ? `mobile worker completed via ${String(task.employee_id||row.metadata?.mobileEmployeeId||'').trim()}; task=${taskId}; response=${responseText}`
              : `mobile worker failed; task=${taskId}; error=${String(output.lastError||task.result?.error||'terminal_failure').slice(0,300)}`;
          }
          await pool.query('update tigeriq_objectives set status=$2,summary=$3,updated_at=now() where id=$1',[row.id,row.status,row.summary]);
        }
      }
    }
    if(row.status==='active'&&['CORE_OPENCLAW_BOUNDED','PC_OPERATOR_DIRECT_LOCAL'].includes(row.metadata?.executionSurface)){
      const job=(await pool.query("select id,status,employee_id,resource_id,provider,result,failure,completed_at from tigeriq_jobs where objective_id=$1 and capability='pc_operator' order by created_at desc limit 1",[row.id])).rows[0];
      if(job?.status==='done'){
        row.status='completed';
        const transport=job.provider==='local-direct'?'local-direct':`${job.employee_id||'NV06'}/${job.provider||'openclaw'}`;
        row.summary=appendPublicEvidenceToSummary(`bounded pc_operator completed via ${transport}; job=${job.id}`,job.result,row.metadata?.publicEvidenceKeys||[],{diagnostic:row.metadata?.publicEvidenceDiagnostic===true,metadataPublicEvidenceKeysPresent:Object.prototype.hasOwnProperty.call(row.metadata||{},'publicEvidenceKeys'),metadataPublicEvidenceKeyCount:Array.isArray(row.metadata?.publicEvidenceKeys)?row.metadata.publicEvidenceKeys.length:0});
        await pool.query("update tigeriq_objectives set status='completed',summary=$2,updated_at=now() where id=$1",[row.id,row.summary]);
      }else if(job?.status==='failed'){
        row.status='blocked';
        row.summary=`bounded pc_operator failed; job=${job.id}; failure=${String(job.failure?.message||job.failure?.kind||'terminal_failure').slice(0,300)}`;
        await pool.query("update tigeriq_objectives set status='blocked',summary=$2,updated_at=now() where id=$1",[row.id,row.summary]);
      }
    }
    if(!row.metadata?.githubClaimReported){
      await clearTerminalBlockedLabel({fetchImpl,owner,repo,issueNumber:number,token});
      await commentIssue(fetchImpl,owner,repo,number,`${ownerStatusIcon('WORKING')} [TIẾP NHẬN] TigerIQ Core đã nhận công việc này dưới mã ${row.id}. Hệ thống đang tự xử lý.`,token);
      await pool.query("update tigeriq_objectives set metadata=metadata||$2::jsonb,updated_at=now() where id=$1",[row.id,JSON.stringify({githubClaimReported:true})]);
      row.metadata={...row.metadata,githubClaimReported:true}; claims++;
    }
    if(row.status==='blocked'&&row.metadata?.githubTerminalLabelSynced!==true){
      const codingHandoffNonTerminal=row.metadata?.requiresCodingHandoff===true;
      const fallbackReleased=await coreFallbackReleaseEligible(pool,row);
      if(codingHandoffNonTerminal||fallbackReleased)await clearTerminalBlockedLabel({fetchImpl,owner,repo,issueNumber:number,token});
      else await addTerminalBlockedLabel({fetchImpl,owner,repo,issueNumber:number,token});
      const labelPatch={
        githubTerminalLabelSynced:true,
        ...(codingHandoffNonTerminal?{githubCodingHandoffBlockedNonTerminal:true}:{}),
        ...(fallbackReleased?{
          coreFallbackReleased:true,
          coreFallbackReleasedAt:new Date().toISOString(),
          coreFallbackPolicy:'UNCLAIMED_BACKLOG_SELF_PULL',
          githubTerminalBlockedSuppressed:true,
        }:{})
      };
      await pool.query("update tigeriq_objectives set metadata=metadata||$2::jsonb,updated_at=now() where id=$1",[row.id,JSON.stringify(labelPatch)]);
      row.metadata={...row.metadata,...labelPatch};
    }
    const terminalCompletionGate=objectiveCompletionGate(row.metadata);
    if(row.status==='completed'&&!terminalCompletionGate.allow){
      const summary='completion rejected: durable LIVE_ACCEPTANCE_PASS for current source revision is missing';
      await pool.query("update tigeriq_objectives set status='active',summary=$2,next_check_at=now()+interval '1 minute',updated_at=now() where id=$1",[row.id,summary]);
      row.status='active';
      row.summary=summary;
    }
    if(['completed','blocked'].includes(row.status)&&!row.metadata?.githubResultReported){
      await commentIssue(fetchImpl,owner,repo,number,formatResultComment(row),token);
      if(row.status==='completed'){
        if(row.metadata?.keepOpenOnStepComplete===true){
          await clearTerminalBlockedLabel({fetchImpl,owner,repo,issueNumber:number,token});
        }else{
          // Close first so a failed clear cannot expose a completed OPEN issue as QUEUED.
          await closeIssue(fetchImpl,owner,repo,number,token);
          await clearTerminalBlockedLabel({fetchImpl,owner,repo,issueNumber:number,token});
        }
      }
      await pool.query("update tigeriq_objectives set metadata=metadata||$2::jsonb,updated_at=now() where id=$1",[row.id,JSON.stringify({githubResultReported:true,githubClosed:row.status==='completed'&&row.metadata?.keepOpenOnStepComplete!==true})]);
      results++;
    }
  }
  return {claims,results};
}

export function startGithubIntake({databaseUrl=process.env.DATABASE_URL,fetchImpl=fetch,owner=process.env.TIGERIQ_GITHUB_OWNER||DEFAULT_OWNER,repo=process.env.TIGERIQ_GITHUB_REPO||DEFAULT_REPO,token=process.env.TIGERIQ_GITHUB_TOKEN||process.env.GITHUB_TOKEN||'',intervalMs=Number(process.env.TIGERIQ_GITHUB_RECONCILE_MS||DEFAULT_INTERVAL_MS),initialDelayMs=1000}={}){
  if(!databaseUrl)return {enabled:false,stop(){}};
  const pool=new Pool({connectionString:databaseUrl,max:1});
  const reconcileMs=Math.max(GITHUB_RECONCILE_INTERVAL_MS,Number(intervalMs)||GITHUB_RECONCILE_INTERVAL_MS);
  let stopped=false,busy=false,timer=null,interval=null,githubCooldownUntil=0;
  const hygieneStartedAt=Date.now();
  let lastLightHygieneMs=hygieneStartedAt,lastDeepHygieneMs=hygieneStartedAt,hygieneRunning=false;
  const pendingEvents=[];

  const applyError=(e,kind)=>{
    const delayMs=githubRateLimitCooldownMs(e,Date.now());
    if(delayMs>0){
      githubCooldownUntil=Date.now()+delayMs;
      if(kind==='event')console.warn(JSON.stringify({event:'GITHUB_EVENT_RATE_LIMIT_COOLDOWN',delayMs,until:new Date(githubCooldownUntil).toISOString(),error:String(e?.message||e)}));
      else console.warn(JSON.stringify({event:'GITHUB_RATE_LIMIT_COOLDOWN',delayMs,until:new Date(githubCooldownUntil).toISOString(),error:String(e?.message||e)}));
    }else{
      console.error(JSON.stringify({event:kind==='event'?'GITHUB_EVENT_INTAKE_ERROR':'GITHUB_INTAKE_ERROR',error:String(e?.message||e)}));
    }
  };

  const processEvent=async(event)=>{
    if(stopped)return;
    if(busy||githubCooldownUntil>Date.now()){pendingEvents.push(event);return}
    const issue=githubEventIssue(event?.payload);
    if(!issue)return;
    // Enforce WAITING_PROJECT bounded lease of 60 seconds
    if(issue.labels?.some(l=>l.name==='WAITING_PROJECT')){
      const age=Date.now()-new Date(issue.created_at||0).getTime();
      if(age>60000){
        console.log(JSON.stringify({event:'WAITING_PROJECT_TIMEOUT',issueNumber:issue.number,ageMs:age}));
        // Skip processing to avoid indefinite lease
        return;
      }
    }
    busy=true;
    try{
      const n=Number(issue.number);
      const handoff=await reconcileStaleChatMutationOwner({fetchImpl,owner,repo,token,issue});
      if(handoff.changed){
        console.log(JSON.stringify({event:'GITHUB_CHAT_OWNER_AUTO_HANDOFF',deliveryId:event.deliveryId,issueNumber:n,reason:handoff.reason}));
        return;
      }
      const openIssues=await ghJson(fetchImpl,`https://api.github.com/repos/${owner}/${repo}/issues?state=open&per_page=100&sort=updated&direction=desc`,token,{freshMs:0});
      const eventIssue=openIssues.find((row)=>Number(row?.number)===n)||issue;
      const eventSpec=hygieneSpecFromIssue(eventIssue);
      const allSpecs=openIssues.map(hygieneSpecFromIssue).filter(Boolean);
      const dedupe=eventBacklogDedupeDecision(eventSpec,allSpecs);
      let intakeIssue=eventIssue;
      if(dedupe.duplicate&&dedupe.canonical){
        const canonicalIssue=openIssues.find((row)=>Number(row?.number)===Number(dedupe.canonical.number));
        if(canonicalIssue)intakeIssue=canonicalIssue;
        const activeWriter=mutationOwnerHasActiveLease(eventIssue.body||'',Date.now());
        if(!activeWriter){
          await patchIssueBody(fetchImpl,owner,repo,token,n,duplicateSupersedeBody(eventIssue.body||'',dedupe.canonical.number));
        }
        const evidence={source:'github-event',issueNumber:n,canonicalIssueNumber:Number(dedupe.canonical.number),dedupeKey:dedupe.key,deliveryId:String(event.deliveryId||'')};
        try{await pool.query("insert into tigeriq_events(type,data) values('GITHUB_BACKLOG_DUPLICATE_REUSED',$1)",[JSON.stringify(evidence)]);}catch{}
        console.log(JSON.stringify({event:'GITHUB_BACKLOG_DUPLICATE_REUSED',...evidence}));
      }
      const issues=[intakeIssue];
      const b=await syncGithubOutcomes({pool,fetchImpl,owner,repo,token,openIssues:issues,issueNumbers:[Number(intakeIssue.number)]});
      const a=await materializeGithubIssues({pool,fetchImpl,owner,repo,token,openIssues:issues});
      console.log(JSON.stringify({event:'GITHUB_EVENT_INTAKE_SYNC',deliveryId:event.deliveryId,eventName:event.eventName,issueNumber:n,canonicalIssueNumber:Number(intakeIssue.number),created:a.created,claims:b.claims,results:b.results}));
    }catch(e){applyError(e,'event')}
    finally{
      busy=false;
      if(pendingEvents.length&&githubCooldownUntil<=Date.now())queueMicrotask(()=>void processEvent(pendingEvents.shift()));
    }
  };

  const unsubscribe=subscribeGithubEvents(event=>{
    const fullName=String(event?.payload?.repository?.full_name||'');
    if(fullName&&fullName!==owner+'/'+repo)return;
    if(githubEventIssue(event?.payload))void processEvent(event);
  });

  const tick=async()=>{
    if(stopped||busy)return;
    if(githubCooldownUntil>Date.now())return;
    busy=true;
    try{
      const openIssues=await ghJson(fetchImpl,`https://api.github.com/repos/${owner}/${repo}/issues?state=open&per_page=100&sort=updated&direction=desc`,token,{freshMs:30000});
      const handedOff=new Set();
      for(const issue of openIssues){
        if(handedOff.size>=5)break;
        const handoff=await reconcileStaleChatMutationOwner({fetchImpl,owner,repo,token,issue});
        if(handoff.changed)handedOff.add(Number(issue.number));
      }
      const stableIssues=openIssues.filter(issue=>!handedOff.has(Number(issue.number)));
      const sweepPlan=githubBacklogHygieneSweepPlan({nowMs:Date.now(),lastLightMs:lastLightHygieneMs,lastDeepMs:lastDeepHygieneMs,running:hygieneRunning});
      if(sweepPlan.kind!=='NONE'){
        hygieneRunning=true;
        try{
          const sweep=await runGithubBacklogHygieneSweep({pool,fetchImpl,owner,repo,token,openIssues:stableIssues,kind:sweepPlan.kind,nowMs:Date.now()});
          const completedAt=Date.now();
          lastLightHygieneMs=completedAt;
          if(sweepPlan.kind==='DEEP')lastDeepHygieneMs=completedAt;
          console.log(JSON.stringify({event:'GITHUB_BACKLOG_HYGIENE_SWEEP',kind:sweepPlan.kind,counts:sweep.counts,actions:sweep.actions}));
        }finally{hygieneRunning=false}
      }
      const b=await syncGithubOutcomes({pool,fetchImpl,owner,repo,token,openIssues:stableIssues});
      let created=0,lastIssueNumber=null,lastActive=0;
      for(let i=0;i<DEFAULT_MATERIALIZE_BATCH;i++){
        const a=await materializeGithubIssues({pool,fetchImpl,owner,repo,token,openIssues:stableIssues});
        lastActive=a.active||lastActive;
        if(!a.created)break;
        created+=Number(a.created||0);
        lastIssueNumber=a.issueNumber||lastIssueNumber;
      }
      if(handedOff.size)console.log(JSON.stringify({event:'GITHUB_CHAT_OWNER_FALLBACK_HANDOFF',count:handedOff.size,issueNumbers:[...handedOff]}));
      if(created||b.claims||b.results)console.log(JSON.stringify({event:'GITHUB_INTAKE_SYNC',created,claims:b.claims,results:b.results,active:lastActive||0,issueNumber:lastIssueNumber||null,materializeBatch:DEFAULT_MATERIALIZE_BATCH}));
    }catch(e){applyError(e,'fallback')}
    finally{
      busy=false;
      if(pendingEvents.length&&githubCooldownUntil<=Date.now())queueMicrotask(()=>void processEvent(pendingEvents.shift()));
    }
  };
  timer=setTimeout(()=>{void tick();interval=setInterval(()=>void tick(),reconcileMs);interval.unref?.();},Math.max(1000,initialDelayMs)); timer.unref?.();
  return {enabled:true,reconcileMs,async stop(){stopped=true;unsubscribe();if(timer)clearTimeout(timer);if(interval)clearInterval(interval);await pool.end();}};
}
