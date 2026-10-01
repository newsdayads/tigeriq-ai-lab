import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { applyChatMutationOwnerHandoff, backlogOwnerControlled, backlogOwnerDirect, bodyValue as policyBodyValue, chatMutationOwnerPlan, isOwnerOnlyP0, routingFault, sortBacklogSpecs } from './github-backlog-policy.mjs';
import { activeRoleClaim, classifyWorkOrder } from './work-routing-policy.mjs';
import { SUPPORTED_PUBLIC_EVIDENCE_KEYS, appendPublicEvidenceToSummary, parsePublicEvidenceKeys } from './public-evidence.mjs';
import { addTerminalBlockedLabel, clearTerminalBlockedLabel } from './github-lifecycle-label.mjs';
import { githubRequestJson } from './github-shared-client.mjs';
import { githubEventIssue, subscribeGithubEvents } from './github-event-bus.mjs';

const DEFAULT_OWNER='newsdayads';
const DEFAULT_REPO='tigeriq-ai-lab';
export const GITHUB_RECONCILE_INTERVAL_MS=300000;
const DEFAULT_INTERVAL_MS=Number(process.env.TIGERIQ_GITHUB_RECONCILE_MS||GITHUB_RECONCILE_INTERVAL_MS);
const DEFAULT_INITIAL_DELAY_MS=15000;
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

export function githubIssuesAfterOutcomeSync(issues=[],resultIssueNumbers=[]){
  const terminal=new Set((Array.isArray(resultIssueNumbers)?resultIssueNumbers:[]).map(Number).filter(Boolean));
  return (Array.isArray(issues)?issues:[]).filter(issue=>!terminal.has(Number(issue?.number)));
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
  const job=(await pool.query("select id,status,employee_id,resource_id,provider,result,failure,attempts,max_attempts from tigeriq_jobs where id=$1 and objective_id=$2 and capability='review' and kind='github_review'",[jobId,objectiveId])).rows[0]||null;
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
  await pool.query("insert into tigeriq_jobs(id,objective_id,title,prompt,capability,kind,status,max_attempts) values($1,$2,$3,$4,'review','github_review','queued',2) on conflict(id) do nothing",[jobId,row.id,`Final acceptance review GitHub #${Number(row.metadata?.issueNumber)||row.id}`,prompt]);
  const existing=(await pool.query("select status,attempts,max_attempts from tigeriq_jobs where id=$1",[jobId])).rows[0]||null;
  if(existing&&String(existing.status||'').toLowerCase()==='failed'&&Number(existing.attempts||0)<Number(existing.max_attempts||2)){
    await pool.query("update tigeriq_jobs set status='queued',employee_id=null,resource_id=null,provider=null,result=null,failure=null,lease_until=null,started_at=null,completed_at=null,next_attempt_at=null where id=$1",[jobId]);
    return {jobId,state:'REQUEUED'};
  }
  return {jobId,state:String(existing?.status||'queued').toUpperCase()};
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

export function objectiveCompletionGate(metadata={}){
  const sourceRevision=String(metadata?.sourceRevision||'').trim();
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

export function extractPcOperatorInstruction(body){
  const text=String(body||'');
  const match=text.match(/(?:^|\n)(?:##\s*)?ASSIGNED_ACTION\s*\n([\s\S]*?)(?=\n(?:##\s*)?ACCEPTANCE\s*\n|$)/i);
  return String(match?.[1]||'').trim();
}

const PC_OPERATOR_DIRECT_READ_ONLY_ACTIONS=new Set(['task_status','process_list','tcp_probe','file_read','file_list','file_stat','paperclip_lab_preflight','paperclip_lab_health']);
const PC_OPERATOR_DIRECT_MUTATING_ACTIONS=new Set(['task_start','task_stop','paperclip_lab_broker_install','paperclip_openai_device_auth_start','paperclip_lab_install','paperclip_lab_start','paperclip_lab_stop']);

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
  if(action.startsWith('task_')){
    const taskName=String(parsed.taskName||'').trim();
    if(!/^TigerIQ [A-Za-z0-9 ._()#-]{1,100}$/.test(taskName))return {present:true,valid:false,action:null,reason:'TASK_NOT_ALLOWLISTED'};
    normalized={action,taskName};
  }else if(action==='tcp_probe'){
    normalized={action,host:String(parsed.host||'127.0.0.1'),port:Number(parsed.port)};
  }else if(action==='paperclip_openai_device_auth_start'){
    const sessionId=String(parsed.sessionId||'').trim().toLowerCase();
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(sessionId))return {present:true,valid:false,action:null,reason:'SESSION_ID_INVALID'};
    normalized={action,sessionId};
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

export function safeAutoWorkAdmission(issue){
  if(!issue||issue.pull_request||issue.state!=='open')return {eligible:false,reason:'NOT_OPEN_ISSUE'};
  const body=String(issue.body||'');
  const title=String(issue.title||'');
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
  return {
    number:Number(issue.number),title,body,priority:classification.priority,sourcePriority:classification.sourcePriority,
    legacyP0Autonomous:classification.legacyP0Autonomous,ownerControlled:classification.ownerControlled,
    capability,requestedCapability:classification.capability,dispatchLane,resourceScope,preferredWorker:classification.preferredEmployee||'',requestedWorker:classification.workerId||null,targetWorker:requiresCodingHandoff?null:(classification.workerId||null),
    url:String(issue.html_url||''),ownerDirect:backlogOwnerDirect(body),sourceRevision,updatedAt:String(issue.updated_at||''),
    commentCount:Math.max(0,Number(issue.comments||0)),labels:Array.isArray(issue.labels)?issue.labels:[],route:classification.route,publicEvidenceKeys:parsePublicEvidenceKeys(body),publicEvidenceDiagnostic:hasExactFlag(body,'PUBLIC_EVIDENCE_DIAGNOSTIC'),
    pcOperatorDirectAction:directAction.action||null,
    keepOpenOnStepComplete:hasExactFlag(body,'KEEP_OPEN_ON_STEP_COMPLETE'),
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
  const summary=String(row?.summary||'Objective completed.').trim().slice(0,5000);
  return `[RESULT] TigerIQ Core ${row?.status==='completed'?'completed':'blocked'} ${row?.id}.\n\n${summary}\n\nEvidence: Core objective \`${row?.id}\`, status \`${row?.status}\`.`;
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
export async function materializeGithubIssues({pool,fetchImpl=fetch,owner=DEFAULT_OWNER,repo=DEFAULT_REPO,token='',openIssues=null}){
  const cleanup=await cleanupTerminalObjectiveJobs({pool});
  const rows=Array.isArray(openIssues)?openIssues:await ghJson(fetchImpl,`https://api.github.com/repos/${owner}/${repo}/issues?state=open&per_page=100&sort=updated&direction=desc`,token);
  const specs=sortBacklogSpecs(rows.map(parseExecutableIssue).filter(Boolean));
  const activeRows=(await pool.query("select metadata from tigeriq_objectives where metadata->>'source'='github' and status='active'")).rows||[];
  const activeMetadata=activeRows.map((row)=>row?.metadata||{});
  const hasPcOperator=specs.some((spec)=>spec.capability==='pc_operator');
  const openClawTerminalState=hasPcOperator?await loadOpenClawTerminalState(pool):null;
  let skipped=0,externalClaims=0;
  for(const spec of specs){
    if(spec.capability==='pc_operator'){
      const reason='OPENCLAW_INSTRUCTION_INVALID';
      const issueKey=String(spec.number);
      const revisionKey=terminalRoutingKey(spec.number,spec.sourceRevision);
      if(openClawTerminalState.terminalByRevision.has(revisionKey)){skipped++;continue;}
      if(openClawTerminalState.terminalByIssue.has(issueKey)&&!openClawTerminalState.clearedByRevision.has(revisionKey)){
        const cleared=await githubMutationRetryable(()=>clearTerminalBlockedLabel({fetchImpl,owner,repo,issueNumber:spec.number,token}));
        if(!cleared){skipped++;continue;}
        const clearRecorded=await recordRoutingFaultClear(pool,{source:'github-intake',issueNumber:spec.number,resourceScope:spec.resourceScope||null,reason,sourceRevision:String(spec.sourceRevision||''),terminalBlockedCleared:true});
        if(!clearRecorded){skipped++;continue;}
        openClawTerminalState.clearedByRevision.add(revisionKey);
      }
    }
    if(githubSpecBlockedByActive(spec,activeMetadata)){skipped++;continue;}
    const prior=(await pool.query("select id,status,metadata from tigeriq_objectives where metadata->>'source'='github' and metadata->>'issueNumber'=$1 order by created_at desc limit 1",[String(spec.number)])).rows[0]||null;
    const roleClaimLabeled=hasExternalRoleClaimLabel(spec);
    const labeledWorker=externalRoleClaimedWorkerId(spec);
    if(prior?.status==='active'){
      if(roleClaimLabeled)await syncExternalRoleClaimLabels({fetchImpl,owner,repo,token,issue:spec,active:false});
      skipped++;continue;
    }
    const sourceChanged=Boolean(prior&&String(prior.metadata?.sourceRevision||'')!==spec.sourceRevision);
    const reopenedAfterCompletion=Boolean(prior?.metadata?.githubClosed===true);
    if(prior&&!sourceChanged&&!reopenedAfterCompletion){skipped++;continue;}
    const externalClaim=await readActiveExternalRoleClaim(fetchImpl,owner,repo,token,spec);
    if(externalClaim){
      if(!roleClaimLabeled||labeledWorker!==externalClaim.workerId){
        if(roleClaimLabeled)await syncExternalRoleClaimLabels({fetchImpl,owner,repo,token,issue:spec,active:false});
        await syncExternalRoleClaimLabels({fetchImpl,owner,repo,token,issue:spec,workerId:externalClaim.workerId,active:true});
      }
      externalClaims++;skipped++;continue;
    }
    if(roleClaimLabeled)await syncExternalRoleClaimLabels({fetchImpl,owner,repo,token,issue:spec,active:false});
    const id=prior?`OBJ-GH-${spec.number}-R${rearmKey(spec)}`:`OBJ-GH-${spec.number}`;
    const exists=(await pool.query('select 1 from tigeriq_objectives where id=$1',[id])).rowCount>0;
    if(exists){skipped++;continue;}
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
      source:'github',issueNumber:spec.number,issueUrl:spec.url,capability:spec.capability,requestedCapability:spec.requestedCapability||spec.capability,requestedWorker:spec.requestedWorker||null,dispatchLane:spec.dispatchLane,resourceScope:spec.resourceScope||null,
      ownerDirect:spec.ownerDirect,ownerControlled:spec.ownerControlled,sourcePriority:spec.sourcePriority,legacyP0Autonomous:spec.legacyP0Autonomous,
      targetWorker:spec.targetWorker||null,sourceRevision:spec.sourceRevision,sourceUpdatedAt:spec.updatedAt,rearmedFromObjectiveId:prior?.id||null,
      dispatchReason:`PRIORITY_${spec.priority}`,executionSurface:spec.capability==='pc_operator'?(spec.pcOperatorDirectAction?'PC_OPERATOR_DIRECT_LOCAL':'CORE_OPENCLAW_BOUNDED'):(spec.requiresCodingHandoff?'CORE_REASONING_COORDINATION':'READ_ONLY'),publicEvidenceKeys:spec.publicEvidenceKeys||[],publicEvidenceDiagnostic:spec.publicEvidenceDiagnostic===true,
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
      admissionMode:spec.admissionMode||'LEGACY_EXECUTION_FLAGS',
      requiresCodingHandoff:spec.requiresCodingHandoff===true,
    };
    await pool.query('insert into tigeriq_objectives(id,objective,priority,metadata) values($1,$2,$3,$4) on conflict(id) do nothing',[id,objective,spec.priority,JSON.stringify(metadata)]);
    if(spec.capability==='pc_operator'){
      const jobId=githubPcOperatorJobId(id,spec.number);
      const prompt=pcOperatorPrompt;
      await pool.query("insert into tigeriq_jobs(id,objective_id,title,prompt,capability,kind,status,max_attempts) values($1,$2,$3,$4,'pc_operator','pc_operator','queued',2) on conflict(id) do nothing",[jobId,id,`GitHub #${spec.number} bounded PC operator`,prompt]);
      await pool.query("insert into tigeriq_events(type,objective_id,job_id,task_kind,data) values('GITHUB_PC_OPERATOR_JOB_MATERIALIZED',$1,$2,'pc_operator',$3)",[id,jobId,JSON.stringify({issueNumber:spec.number,executionSurface:'CORE_OPENCLAW_BOUNDED'})]);
    }else if(spec.admissionMode==='SAFE_P1_P5_POLICY'&&spec.dispatchLane==='CORE_REASONING'){
      const jobId=`JOB-GH-${spec.number}-API-AUTOWORK`;
      const prompt=spec.requiresCodingHandoff
        ? `Coordinate GitHub Work Order #${spec.number} without repository mutation. Determine the bounded implementation handoff needed, preserve RESOURCE_SCOPE=${spec.resourceScope}, and return concrete acceptance/evidence requirements for the coding executor. Do not perform independent review of implementation produced under this Work Order.`
        : `Execute the safe P1-P5 GitHub Work Order #${spec.number} using only the supplied objective context. Remain read-only with respect to repository source and all hard-gated surfaces.`;
      await pool.query("insert into tigeriq_jobs(id,objective_id,title,prompt,capability,kind,status,max_attempts) values($1,$2,$3,$4,'reasoning','github_api_autowork','queued',2) on conflict(id) do nothing",[jobId,id,`GitHub #${spec.number} API auto-work`,prompt]);
      await pool.query("insert into tigeriq_events(type,objective_id,job_id,task_kind,data) values('GITHUB_API_AUTOWORK_JOB_MATERIALIZED',$1,$2,'github_api_autowork',$3)",[id,jobId,JSON.stringify({issueNumber:spec.number,executionSurface:'CORE_REASONING_COORDINATION',requiresCodingHandoff:spec.requiresCodingHandoff===true})]);
    }
    await pool.query("insert into tigeriq_events(type,objective_id,data) values('GITHUB_OBJECTIVE_MATERIALIZED',$1,$2)",[id,JSON.stringify({issueNumber:spec.number,issueUrl:spec.url,priority:spec.priority,sourcePriority:spec.sourcePriority,dispatchLane:spec.dispatchLane})]);
    return {created:1,skipped,externalClaims,active:activeMetadata.length,considered:specs.length,issueNumber:spec.number,objectiveId:id,dispatchLane:spec.dispatchLane,cleanedOrphans:cleanup.cleaned};
  }
  let idleWorkers=0;
  try{idleWorkers=Number((await pool.query("select count(*)::int as count from tigeriq_ai_resources where enabled=true and current_job_id is null and credential_state in ('LOCAL','READY') and health_state in ('ONLINE','READY')")).rows[0]?.count||0);}catch{}
  const fault=routingFault({eligibleBacklogCount:specs.length,activeWorkCount:activeMetadata.length+externalClaims,eligibleIdleWorkers:idleWorkers});
  if(fault.fault)await recordRoutingFault(pool,{...fault,source:'github-intake',considered:specs.length,skipped});
  return {created:0,skipped,externalClaims,active:activeMetadata.length,considered:specs.length,cleanedOrphans:cleanup.cleaned,routingFault:fault.fault};
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
  let claims=0,results=0;const resultIssueNumbers=[];
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
    const sourceLiveRequired=hasExactFlag(sourceBody,'LIVE_ACCEPTANCE_REQUIRED');
    const sourceFinalReviewRequired=hasExactFlag(sourceBody,'FINAL_REVIEW_REQUIRED')||hasExactFlag(sourceBody,'FINAL_LIVE_REVIEW_REQUIRED');
    const revisionChanged=Boolean(currentSourceRevision)&&currentSourceRevision!==String(row.metadata?.sourceRevision||'');
    const policyPatch={};
    if(sourceLiveRequired&&row.metadata?.liveAcceptanceRequired!==true)policyPatch.liveAcceptanceRequired=true;
    if(sourceFinalReviewRequired&&row.metadata?.finalReviewRequired!==true)policyPatch.finalReviewRequired=true;
    if((sourceLiveRequired||sourceFinalReviewRequired)&&revisionChanged){
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

    if(row.metadata?.liveAcceptanceRequired===true||row.metadata?.finalReviewRequired===true){
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
      await commentIssue(fetchImpl,owner,repo,number,`[CLAIM] TigerIQ Core accepted this issue as ${row.id}. Automatic processing is active.`,token);
      await pool.query("update tigeriq_objectives set metadata=metadata||$2::jsonb,updated_at=now() where id=$1",[row.id,JSON.stringify({githubClaimReported:true})]);
      row.metadata={...row.metadata,githubClaimReported:true}; claims++;
    }
    if(row.status==='blocked'&&row.metadata?.githubTerminalLabelSynced!==true){
      await addTerminalBlockedLabel({fetchImpl,owner,repo,issueNumber:number,token});
      await pool.query("update tigeriq_objectives set metadata=metadata||$2::jsonb,updated_at=now() where id=$1",[row.id,JSON.stringify({githubTerminalLabelSynced:true})]);
      row.metadata={...row.metadata,githubTerminalLabelSynced:true};
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
      results++;resultIssueNumbers.push(number);
    }
  }
  return {claims,results,resultIssueNumbers};
}

export function startGithubIntake({databaseUrl=process.env.DATABASE_URL,fetchImpl=fetch,owner=process.env.TIGERIQ_GITHUB_OWNER||DEFAULT_OWNER,repo=process.env.TIGERIQ_GITHUB_REPO||DEFAULT_REPO,token=process.env.TIGERIQ_GITHUB_TOKEN||process.env.GITHUB_TOKEN||'',intervalMs=Number(process.env.TIGERIQ_GITHUB_RECONCILE_MS||DEFAULT_INTERVAL_MS),initialDelayMs=1000}={}){
  if(!databaseUrl)return {enabled:false,stop(){}};
  const pool=new Pool({connectionString:databaseUrl,max:1});
  const reconcileMs=Math.max(GITHUB_RECONCILE_INTERVAL_MS,Number(intervalMs)||GITHUB_RECONCILE_INTERVAL_MS);
  let stopped=false,busy=false,timer=null,interval=null,githubCooldownUntil=0;
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
    busy=true;
    try{
      const n=Number(issue.number);
      const handoff=await reconcileStaleChatMutationOwner({fetchImpl,owner,repo,token,issue});
      if(handoff.changed){
        console.log(JSON.stringify({event:'GITHUB_CHAT_OWNER_AUTO_HANDOFF',deliveryId:event.deliveryId,issueNumber:n,reason:handoff.reason}));
        return;
      }
      const issues=[issue];
      const b=await syncGithubOutcomes({pool,fetchImpl,owner,repo,token,openIssues:issues,issueNumbers:[n]});
      const materializeIssues=githubIssuesAfterOutcomeSync(issues,b.resultIssueNumbers);
      const a=await materializeGithubIssues({pool,fetchImpl,owner,repo,token,openIssues:materializeIssues});
      console.log(JSON.stringify({event:'GITHUB_EVENT_INTAKE_SYNC',deliveryId:event.deliveryId,eventName:event.eventName,issueNumber:n,created:a.created,claims:b.claims,results:b.results}));
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
      const b=await syncGithubOutcomes({pool,fetchImpl,owner,repo,token,openIssues:stableIssues});
      const materializeIssues=githubIssuesAfterOutcomeSync(stableIssues,b.resultIssueNumbers);
      const a=await materializeGithubIssues({pool,fetchImpl,owner,repo,token,openIssues:materializeIssues});
      if(handedOff.size)console.log(JSON.stringify({event:'GITHUB_CHAT_OWNER_FALLBACK_HANDOFF',count:handedOff.size,issueNumbers:[...handedOff]}));
      if(a.created||b.claims||b.results)console.log(JSON.stringify({event:'GITHUB_INTAKE_SYNC',created:a.created,claims:b.claims,results:b.results,active:a.active||0,issueNumber:a.issueNumber||null}));
    }catch(e){applyError(e,'fallback')}
    finally{
      busy=false;
      if(pendingEvents.length&&githubCooldownUntil<=Date.now())queueMicrotask(()=>void processEvent(pendingEvents.shift()));
    }
  };
  timer=setTimeout(()=>{void tick();interval=setInterval(()=>void tick(),reconcileMs);interval.unref?.();},Math.max(1000,initialDelayMs)); timer.unref?.();
  return {enabled:true,reconcileMs,async stop(){stopped=true;unsubscribe();if(timer)clearTimeout(timer);if(interval)clearInterval(interval);await pool.end();}};
}
