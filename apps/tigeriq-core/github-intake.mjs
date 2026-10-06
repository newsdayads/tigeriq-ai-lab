import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { applyChatMutationOwnerHandoff, backlogOwnerControlled, backlogOwnerDirect, bodyValue as policyBodyValue, chatMutationOwnerPlan, isOwnerOnlyP0, routingFault, sortBacklogSpecs } from './github-backlog-policy.mjs';
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

async function selectUiFinalReviewer(pool,implementationContext={}){
  const excluded=new Set((implementationContext?.implementerEmployeeIds||[]).map((x)=>String(x||'').trim().toUpperCase()).filter(Boolean));
  const active=await pool.query("select employee_id from tigeriq_jobs where kind='ui' and status in ('ui_assigned','ui_running') and employee_id=any($1::text[])",[['NV03','NV04']]);
  const busy=new Set(active.rows.map((row)=>String(row.employee_id||'').trim().toUpperCase()).filter(Boolean));
  for(const workerId of ['NV03','NV04']){
    if(!excluded.has(workerId)&&!busy.has(workerId))return workerId;
  }
  return '';
}
function uiReviewerResourceId(workerId){return 'res:ui:'+String(workerId||'').trim().toLowerCase()+':subscription:chrome';}

async function ensureFinalLiveReviewJob(pool,row,{comments=[],sourceRevision='',evidenceKey='',evidenceCommentId=null,implementationContext=null,sourceBody=''}={}){
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
  const uiReviewer=await selectUiFinalReviewer(pool,context).catch(()=>'');
  if(uiReviewer){
    const resourceId=uiReviewerResourceId(uiReviewer);
    await pool.query("insert into tigeriq_jobs(id,objective_id,title,prompt,capability,kind,status,employee_id,resource_id,provider,routing_profile,routing_decision,max_attempts) values($1,$2,$3,$4,'review','ui','ui_assigned',$5,$6,'ui','UI',$7,2) on conflict(id) do nothing",[jobId,row.id,`Final acceptance review GitHub #${Number(row.metadata?.issueNumber)||row.id}`,prompt,uiReviewer,resourceId,JSON.stringify({authority:'CORE_UI_FINAL_REVIEW',workerId:uiReviewer,reason:uiReviewer==='NV03'?'NV03_PRIMARY_FINAL_REVIEW':'NV04_REVIEW_OVERFLOW',sourceRevision})]);
  }else{
    await pool.query("insert into tigeriq_jobs(id,objective_id,title,prompt,capability,kind,status,max_attempts) values($1,$2,$3,$4,'review','github_review','queued',2) on conflict(id) do nothing",[jobId,row.id,`Final acceptance review GitHub #${Number(row.metadata?.issueNumber)||row.id}`,prompt]);
  }
  const existing=(await pool.query("select status,attempts,max_attempts from tigeriq_jobs where id=$1",[jobId])).rows[0]||null;
  if(existing&&String(existing.status||'').toLowerCase()==='failed'&&Number(existing.attempts||0)<Number(existing.max_attempts||2)){
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
  const title=normalizeWorkOrderIntentTitle(spec?.title||'');
  return `${scope}|${title}`;
}

export function dedupeBacklogWorkOrders(specs=[]){
  const out=[]; const seen=new Set();
  for(const spec of Array.isArray(specs)?specs:[]){
    const key=workOrderDedupIdentity(spec);
    if(key&&seen.has(key))continue;
    if(key)seen.add(key);
    out.push(spec);
  }
  return out;
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