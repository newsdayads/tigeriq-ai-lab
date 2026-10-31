import {createHash} from 'node:crypto';
import {Pool} from 'pg';
import {backlogOwnerControlled,backlogOwnerDirect,chatMutationOwnerPlan,effectiveBacklogPriority,isActiveExecutionSpec,isOwnerOnlyP0,isReviewOnlySpec,sortBacklogSpecs} from './github-backlog-policy.mjs';
import {classifyWorkOrder} from './work-routing-policy.mjs';
import {controlPlaneRepairIntent,isAppChromeLocalOnlyPath,isProtectedControlPlanePath} from '../shared/control-plane-lock.mjs';
import {githubRateLimitCooldownMs} from './github-intake.mjs';
import {addTerminalBlockedLabel,clearTerminalBlockedLabel} from './github-lifecycle-label.mjs';
import {githubRequestJson} from './github-shared-client.mjs';
import {githubEventIssue,subscribeGithubEvents} from './github-event-bus.mjs';
import {localizeOwnerFacingText} from './owner-facing-vietnamese.mjs';
import {codingIssueCompletionGate,sourceTerminalDependencyAccepted} from '../shared/work-order-acceptance-sync.mjs';
const DEFAULT_OWNER='newsdayads';
const DEFAULT_REPO='tigeriq-ai-lab';
export const DEFAULT_CODING_URL='http://127.0.0.1:8797';
export const GITHUB_CODING_RECONCILE_INTERVAL_MS=300000;
const DEFAULT_INTERVAL_MS=GITHUB_CODING_RECONCILE_INTERVAL_MS;
const DEFAULT_CONCURRENCY_CAP=3;
const MAX_AUTO_RETRIES=2;
const PROVIDER_RETRY_BASE_MS=60000;

function canonicalCodingHeader(body){
  // Only the first current contract section can authorize coding work.
  // A leading active Markdown heading is valid; historical headings are not.
  const text=String(body||'');
  const headings=[...text.matchAll(/^ {0,3}#{1,6}[ \t]+\S[^\r\n]*/gm)];
  const first=headings[0];
  if(first?.index===0&&/(?:\b(?:HISTORICAL|HISTORY|SUPERSEDED|ARCHIVED)\b|LỊCH SỬ)/i.test(first[0]))return '';
  const sectionEnd=first?.index===0
    ?(headings[1]?.index??text.length)
    :(first?.index??text.length);
  // A divider also separates the current contract from archived snapshots.
  const divider=text.match(/^ {0,3}(?:-{3,}|\*{3,}|_{3,})(?:[ \t]+(?:HISTORICAL|SUPERSEDED|LỊCH SỬ)[^\r\n]*)?[ \t]*$/mi);
  return text.slice(0,Math.min(sectionEnd,divider?.index??text.length));
}
function currentCodingValue(body,key){
  const escaped=key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return String(canonicalCodingHeader(body).match(new RegExp(`^${escaped}=(.*)$`,'m'))?.[1]||'').trim();
}
function exactFlag(body,key,value='true'){
  return currentCodingValue(body,key)===value;
}

export function codingSourceTruthRevision(issue,comments=[]){
  const body=String(issue?.body||'');
  const title=String(issue?.title||'');
  const ownerLogin=String(issue?.repository_owner||DEFAULT_OWNER).toLowerCase();
  const ownerDirective=(Array.isArray(comments)?comments:[])
    .filter(c=>String(c?.user?.login||'').toLowerCase()===ownerLogin)
    .filter(c=>/^\[(?:OWNER_REARM|OWNERSHIP_HANDOFF|OWNER_DIRECTIVE|OWNER_OVERRIDE)\]/mi.test(String(c?.body||'')))
    .sort((a,b)=>Number(a?.id||0)-Number(b?.id||0))
    .at(-1);
  const digest=createHash('sha256').update(title).update('\n').update(body).digest('hex').slice(0,20);
  return ownerDirective?.id?`body-${digest}:owner-${ownerDirective.id}`:`body-${digest}`;
}

// The execution contract must not change when an operator updates progress,
// receipts or a checklist. Only substantive coding requirements can rearm a
// completed objective that is waiting for product acceptance.
export function codingMaterialSourceSignature(issue={}){
  const volatile=/^(?:CURRENT_STATE|CURRENT_STEP|NEXT_ACTION|LAST_COMPLETED_STEP|BLOCKER|BLOCKED_BY|STARTED_AT|FINISHED_AT|ETA_STATUS|TARGET_FINISH_AT|CHECKPOINT_DUE_AT|DONE|ACTIVE_EXECUTION|PROGRESS_(?:SOURCE|TOTAL|COMPLETED|VERIFIED)|SAME_FAILURE_RETRY_(?:COUNT|MAX)|VERIFICATION_(?:COUNT_CURRENT_HEAD|MAX_PER_HEAD)|LAST_FAILURE_SIGNATURE|RETRY_RESUME_TRIGGER|SOURCE_BRANCH|SOURCE_WRITER_SCOPE|OWNER_APPROVAL|AUTO_QUEUE|MUTATION_OWNER|ASSIGNED_EXECUTOR|TARGET_EMPLOYEE|START_RECEIPT_URL|FINISH_RECEIPT_URL)=/;
  let inChecklist=false;
  const relevant=[];
  for(const line of String(issue?.body||'').replace(/\r/g,'').split('\n')){
    const heading=line.match(/^##\s+([^\r\n]+)/);
    if(heading)inChecklist=/^STRUCTURED_PROGRESS_CHECKLIST\b/i.test(heading[1].trim());
    if(inChecklist||volatile.test(line.trim()))continue;
    relevant.push(line);
  }
  const normalized=relevant.join('\n').trim().replace(/\n{3,}/g,'\n\n');
  return createHash('sha256').update(String(issue?.title||'')).update('\n').update(normalized).digest('hex').slice(0,24);
}

export async function codingSourceRevision(fetchImpl,owner,repo,token,issue){
  let comments=[];
  const issueNumber=Number(issue?.number);
  const totalComments=Math.max(0,Number(issue?.comments||0));
  const lastPage=Math.max(1,Math.ceil(totalComments/100));
  try{
    for(let page=lastPage;page>=1;page--){
      const batch=await gh(fetchImpl,owner,repo,`/issues/${issueNumber}/comments?per_page=100&page=${page}`,token);
      if(Array.isArray(batch))comments.push(...batch);
      const hasOwnerDirective=(Array.isArray(batch)?batch:[]).some(c=>
        String(c?.user?.login||'').toLowerCase()===String(owner||'').toLowerCase()&&
        /^\[(?:OWNER_REARM|OWNERSHIP_HANDOFF|OWNER_DIRECTIVE|OWNER_OVERRIDE)\]/mi.test(String(c?.body||''))
      );
      if(hasOwnerDirective)break;
    }
  }catch(error){
    if(githubRateLimitCooldownMs(error)>0)throw error;
    // Body still gives a stable fail-closed Source-of-Truth revision when comment lookup is unavailable.
  }
  return codingSourceTruthRevision({...issue,repository_owner:owner},comments);
}

export function extractCodingDependencies(body){
  const raw=String(body||'').match(/^DEPENDS_ON=(.+)$/m)?.[1]||'';
  const values=(raw.match(/#?\d+/g)||[]).map(x=>Number(x.replace(/^#/,''))).filter(n=>Number.isInteger(n)&&n>0);
  return [...new Set(values)].slice(0,16);
}

const DEFAULT_CODING_TARGET_REPOSITORIES=new Set([`${DEFAULT_OWNER}/${DEFAULT_REPO}`,'newsdayads/tigeriq-media']);

export function parseCodingTargetRepository(body,{sourceRepository=`${DEFAULT_OWNER}/${DEFAULT_REPO}`,allowedRepositories=DEFAULT_CODING_TARGET_REPOSITORIES}={}){
  const raw=String(String(body||'').match(/^TARGET_REPOSITORY=(.+)$/m)?.[1]||'').trim();
  if(!raw)return {valid:true,reason:null,targetRepository:null};
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(raw))return {valid:false,reason:'TARGET_REPOSITORY_INVALID',targetRepository:null};
  const normalized=raw.toLowerCase();
  const allowed=new Set([String(sourceRepository||'').toLowerCase(),...[...allowedRepositories].map(x=>String(x||'').toLowerCase())]);
  if(!allowed.has(normalized))return {valid:false,reason:'TARGET_REPOSITORY_NOT_ALLOWED',targetRepository:null};
  return {valid:true,reason:null,targetRepository:raw};
}

export function parseCodingRouteMetadata(body){
  const text=String(body||'');
  const targetRaw=String(text.match(/^TARGET_EMPLOYEE=(.+)$/m)?.[1]||'').trim();
  const currentPrRaw=String(text.match(/^CURRENT_PR=(.+)$/m)?.[1]||'').trim();
  const targetHeadRaw=String(text.match(/^TARGET_HEAD=(.+)$/m)?.[1]||'').trim();
  const repository=parseCodingTargetRepository(text);
  if(!repository.valid)return {valid:false,reason:repository.reason,targetEmployee:null,currentPr:null,targetHead:null,targetRepository:null};

  let targetEmployee=null;
  // Work Order V2 uses TARGET_EMPLOYEE=NONE for unassigned dynamic selection.
  // This is not an employee identity or permission to bypass capability/lease gates.
  if(targetRaw&&!/^(?:NONE|NULL)$/i.test(targetRaw)){
    if(!/^NV\d{2,3}$/i.test(targetRaw))return {valid:false,reason:'TARGET_EMPLOYEE_INVALID',targetEmployee:null,currentPr:null,targetHead:null,targetRepository:repository.targetRepository};
    targetEmployee=targetRaw.toUpperCase();
  }

  const currentPrDisabled=/^(?:NONE|NULL)$/i.test(currentPrRaw);
  const hasPr=Boolean(currentPrRaw)&&!currentPrDisabled;

  let currentPr=null,targetHead=null;
  if(hasPr){
    const match=currentPrRaw.match(/^#?(\d+)$/);
    const value=Number(match?.[1]||0);
    if(!match||!Number.isInteger(value)||value<=0)return {valid:false,reason:'CURRENT_PR_INVALID',targetEmployee,currentPr:null,targetHead:null,targetRepository:repository.targetRepository};
    if(!targetHeadRaw)return {valid:false,reason:'CURRENT_PR_TARGET_HEAD_PAIR_REQUIRED',targetEmployee,currentPr:null,targetHead:null,targetRepository:repository.targetRepository};
    if(!/^[0-9a-f]{40}$/i.test(targetHeadRaw))return {valid:false,reason:'TARGET_HEAD_INVALID',targetEmployee,currentPr:null,targetHead:null,targetRepository:repository.targetRepository};
    currentPr=value;
    targetHead=targetHeadRaw.toLowerCase();
  }
  return {valid:true,reason:null,targetEmployee,currentPr,targetHead,targetRepository:repository.targetRepository};
}

export function parseCodingScope(body){
  const text=String(body||'');
  const resourceScope=String(text.match(/^RESOURCE_SCOPE=(.+)$/m)?.[1]||'').trim();
  const rawPaths=String(text.match(/^ALLOW_PATH_PREFIX=(.+)$/m)?.[1]||'');
  const paths=[...new Set(rawPaths.split(',').map(x=>x.trim().replace(/^\.\//,'').replace(/\/+$/,'')).filter(Boolean))].sort();
  const ambiguous=(!resourceScope&&!paths.length)||paths.some(path=>path==='*'||path.includes('..'));
  return {resourceScope,paths,ambiguous};
}
export function codingScopesOverlap(a,b){
  if(!a||!b||a.ambiguous||b.ambiguous)return true;
  if(a.resourceScope&&b.resourceScope&&a.resourceScope===b.resourceScope)return true;
  const overlaps=(leftPaths,rightPaths)=>leftPaths.some(left=>rightPaths.some(right=>left===right||left.startsWith(`${right}/`)||right.startsWith(`${left}/`)));
  if(a.resourceScope&&b.resourceScope&&a.resourceScope!==b.resourceScope){
    const left=(a.paths||[]).filter(path=>!/^tests\/?$/i.test(String(path)));
    const right=(b.paths||[]).filter(path=>!/^tests\/?$/i.test(String(path)));
    return overlaps(left,right);
  }
  return overlaps(a.paths||[],b.paths||[]);
}

export function parseCodingIssue(issue){
  if(!issue||issue.pull_request||issue.state!=='open')return null;
  const body=String(issue.body||'');
  const header=canonicalCodingHeader(body);
  if(chatMutationOwnerPlan(header,issue.title).owner==='VY')return null;
  if(isOwnerOnlyP0(header,issue.title)||backlogOwnerControlled(header))return null;
  // Closed/terminal canonical work and explicit current queue exclusions must
  // not be revived by the presence of historical executable=true flags.
  const autoQueue=currentCodingValue(body,'AUTO_QUEUE').toUpperCase();
  const state=currentCodingValue(body,'CURRENT_STATE').toUpperCase();
  const legacyState=currentCodingValue(body,'STATE').toUpperCase();
  if(autoQueue==='EXCLUDED'||autoQueue.startsWith('EXCLUDED_'))return null;
  const displayState=currentCodingValue(body,'DISPLAY_STATE').toUpperCase();
  // A Canonical Work Order awaiting independent review or physical-device
  // evidence is not eligible for Coding Lane dispatch or retry.
  if(/^(?:EXTERNAL_WAIT|WAIT_EXTERNAL|SOURCE_VERIFIED_WAIT|WAIT_GO_DECISION)(?:_|$)/.test(state)
    ||/^(?:WAIT_DEPENDENCY|EXTERNAL_WAIT)(?:_|$)/.test(displayState))return null;
  if(/^(?:SUPERSEDED|CANCELLED|CANCELED)(?:_|$)/.test(legacyState)
    ||/^(?:DONE|COMPLETED|TERMINAL|FAILED|CANCELLED|CANCELED|CLOSED|SUPERSEDED|NOT_PLANNED)(?:_|$)/.test(state)
    ||currentCodingValue(body,'SUPERSEDED_BY')
    ||currentCodingValue(body,'SUPERSEDED'))return null;
  if(currentCodingValue(body,'NO_SECURITY_BOUNDARY_CHANGE').toLowerCase()==='false')return null;
  const required=[['TIGERIQ_EXECUTABLE','true'],['OWNER_POLICY','AUTO'],['AUTONOMOUS_CODE','true'],['ZERO_COST','true'],['NO_PC01_SHELL','true'],['NO_PAID_COST','true'],['NO_CREDENTIAL_CHANGE','true'],['NO_SECURITY_BOUNDARY_CHANGE','true'],['NO_DESTRUCTIVE','true'],['NO_PRODUCTION_RELEASE','true'],['NO_BROWSER_AUTH','true'],['NO_DIRECT_MAIN','true']];
  if(required.some(([k,v])=>!exactFlag(body,k,v)))return null;
  // Work Order V2 uses READY/WORKING + real leases. Archived V1
  // ACTIVE_EXECUTION/CANONICAL_SPEC lines must not override a current V2 contract.
  // Keep V1's full section gate and the REVIEW_ONLY exclusion unchanged.
  const lifecycleV2=currentCodingValue(body,'WORK_ORDER_LIFECYCLE').toUpperCase()==='V2';
  if(lifecycleV2){
    if(isReviewOnlySpec(header))return null;
  }else if(!isActiveExecutionSpec(body))return null;
  const classification=classifyWorkOrder(header);
  if(classification.route!=='CODING')return null;
  const {sourcePriority,priority,legacyP0Autonomous,ownerControlled,assignedExecutor}=effectiveBacklogPriority(header,'P3');
  const scopeLease=parseCodingScope(header);
  const controlRepair=controlPlaneRepairIntent(header);
  const appChromeLocalOnly=/\[APP-CHROME\]/i.test(String(issue.title||''))
    || /^RESOURCE_SCOPE=APP_CHROME_/mi.test(body)
    || /^APP_CHROME_REQUEST_ONLY=true$/mi.test(body)
    || /appchrome-install-request\.json/i.test(body)
    || scopeLease.paths.some(isAppChromeLocalOnlyPath);
  if(appChromeLocalOnly)return null;
  if(scopeLease.paths.some(isProtectedControlPlanePath)&&!controlRepair.delegated)return null;
  const routing=parseCodingRouteMetadata(header);
  if(!routing.valid)return null;
  return {number:Number(issue.number),title:String(issue.title||''),body,comments:Math.max(0,Number(issue.comments||0)),priority,sourcePriority,legacyP0Autonomous,ownerControlled,assignedExecutor,url:String(issue.html_url||''),dependsOn:extractCodingDependencies(header),ownerDirect:backlogOwnerDirect(header),scopeLease,controlRepair,routing};
}

async function jsonFetch(fetchImpl,url,init={}){
  const res=await fetchImpl(url,{...init,signal:AbortSignal.timeout(12000)});
  const text=await res.text();let body={};try{body=text?JSON.parse(text):{}}catch{body={text}}
  if(!res.ok){
    const error=new Error(`HTTP_${res.status}:${String(body?.error||body?.message||text).slice(0,300)}`);
    error.status=res.status;
    error.retryAfter=res.headers?.get?.('retry-after')||'';
    error.rateLimitRemaining=res.headers?.get?.('x-ratelimit-remaining')||'';
    error.rateLimitReset=res.headers?.get?.('x-ratelimit-reset')||'';
    throw error;
  }
  return body;
}
async function gh(fetchImpl,owner,repo,path,token,init={}){const opts=String(init.method||'GET').toUpperCase()==='GET'&&init.freshMs==null?{...init,freshMs:0}:init;return githubRequestJson(fetchImpl,`https://api.github.com/repos/${owner}/${repo}${path}`,token,opts)}
export function ownerCodingComment(value=''){
  let text=localizeOwnerFacingText(String(value||''));
  const markers=[
    [/^\[DEPENDENCY_WAIT\]/,'[ĐANG CHỜ PHỤ THUỘC]'],
    [/^\[(?:REOPEN_REARMED|CLAIM_RECOVERED|CLAIM)\]/,'[TIẾP NHẬN]'],
    [/^\[PROGRESS\]/,'[TIẾN ĐỘ]'],
    [/^\[STALE_RESULT_REJECTED\]/,'[TỪ CHỐI KẾT QUẢ CŨ]'],
    [/^\[(?:STALE_RESULT_REARMED|RECOVERY_REARMED|RETRY_DISPATCHED)\]/,'[KÍCH HOẠT LẠI]'],
    [/^\[RESULT\]/,'[KẾT QUẢ]'],
    [/^\[BLOCKED_FINAL\]/,'[BỊ CHẶN]'],
    [/^\[RETRY_SCHEDULED\]/,'[LÊN LỊCH THỬ LẠI]'],
  ];
  for(const [pattern,label] of markers){if(pattern.test(text)){text=text.replace(pattern,label);break}}
  return text;
}
export function codingSourceReconcileGate(issue={}){
  const state=String(issue?.state||'').trim().toLowerCase();
  if(state==='open')return {allow:true,state,reason:'SOURCE_WORK_ORDER_OPEN'};
  if(state==='closed')return {allow:false,state,reason:'SOURCE_WORK_ORDER_CLOSED'};
  return {allow:false,state:state||'unknown',reason:'SOURCE_WORK_ORDER_STATE_UNVERIFIED'};
}

async function comment(fetchImpl,owner,repo,n,token,body){if(token)await gh(fetchImpl,owner,repo,`/issues/${n}/comments`,token,{method:'POST',body:JSON.stringify({body:ownerCodingComment(body)})})}
async function close(fetchImpl,owner,repo,n,token){if(token)await gh(fetchImpl,owner,repo,`/issues/${n}`,token,{method:'PATCH',body:JSON.stringify({state:'closed',state_reason:'completed'})})}
async function markerExists(pool,type,n){const q=await pool.query("select 1 from tigeriq_events where type=$1 and data->>'issueNumber'=$2 limit 1",[type,String(n)]);return q.rowCount>0}
async function objectiveMarkerExists(pool,type,n,codingObjectiveId){const q=await pool.query("select 1 from tigeriq_events where type=$1 and data->>'issueNumber'=$2 and data->>'codingObjectiveId'=$3 limit 1",[type,String(n),String(codingObjectiveId||'')]);return q.rowCount>0}
async function eventData(pool,type,n){const q=await pool.query("select data from tigeriq_events where type=$1 and data->>'issueNumber'=$2 order by seq desc limit 100",[type,String(n)]);return q.rows.map(row=>row.data||{})}
async function mark(pool,type,data){await pool.query('insert into tigeriq_events(type,data) values($1,$2)',[type,JSON.stringify(data)])}
async function hasCompletedCodingResult(pool,n){
  const dispatches=await eventData(pool,'GITHUB_CODING_DISPATCHED',n);
  const latestObjectiveId=String(dispatches[0]?.codingObjectiveId||'');
  if(!latestObjectiveId)return false;
  const results=await eventData(pool,'GITHUB_CODING_RESULT_REPORTED',n);
  if(results.some(x=>String(x.status||'').toLowerCase()==='completed'&&String(x.codingObjectiveId||'')===latestObjectiveId))return true;
  // Legacy result markers predating objective correlation remain valid only before any rearm/new dispatch exists.
  return dispatches.length===1&&results.some(x=>String(x.status||'').toLowerCase()==='completed'&&!String(x.codingObjectiveId||''));
}
async function reopenedCompletionKey(fetchImpl,owner,repo,token,issue){
  if(!issue||issue.state!=='open')return '';
  const n=Number(issue.number);if(!n)return '';
  let timeline;
  try{timeline=await gh(fetchImpl,owner,repo,`/issues/${n}/timeline?per_page=100`,token)}catch(error){if(githubRateLimitCooldownMs(error)>0)throw error;return ''}
  const transitions=(Array.isArray(timeline)?timeline:[])
    .filter(x=>['closed','reopened'].includes(String(x?.event||'')))
    .sort((a,b)=>String(a?.created_at||'').localeCompare(String(b?.created_at||''))||Number(a?.id||0)-Number(b?.id||0));
  const latest=transitions.at(-1);
  if(String(latest?.event||'')!=='reopened')return '';
  const lastClose=[...transitions].reverse().find(x=>String(x?.event||'')==='closed');
  if(!lastClose)return '';
  const sourceRevision=await codingSourceRevision(fetchImpl,owner,repo,token,issue);
  const reopenIdentity=String(latest?.id||latest?.created_at||'reopened').replace(/[^0-9A-Za-z]/g,'').slice(-32)||'reopened';
  return `${sourceRevision}:reopen-${reopenIdentity}`;
}
async function hasEffectiveBlockedFinal(pool,n,fallbackSummary='',currentObjectiveId=null,currentMainSha='',currentSourceRevision='',relevantMainChanged=false,currentMaterialSignature=''){
  const finals=await eventData(pool,'GITHUB_CODING_BLOCKED_FINAL',n);
  if(!finals.length)return false;
  const latest=finals[0]||{};
  if(currentObjectiveId&&latest.codingObjectiveId&&String(latest.codingObjectiveId)!==String(currentObjectiveId))return false;
  const legacyHard=String(latest.reason||'').toUpperCase()==='HARD_BLOCKER';
  const terminalSummary=String(latest.terminalReason||fallbackSummary||'');
  if(legacyHard&&classifyCodingBlocker(terminalSummary).kind==='RECOVERABLE'){
    if(!(await markerExists(pool,'GITHUB_CODING_BLOCKED_FINAL_RECLASSIFIED',n))){
      await mark(pool,'GITHUB_CODING_BLOCKED_FINAL_RECLASSIFIED',{issueNumber:n,priorCodingObjectiveId:latest.codingObjectiveId||null,priorReason:latest.reason||null,terminalReason:terminalSummary,reclassifiedAs:'RECOVERABLE'});
    }
    return false;
  }
  const rearms=await eventData(pool,'GITHUB_CODING_RECOVERY_REARMED',n);
  if(shouldRearmRecoverableFinal({...latest,terminalReason:terminalSummary},currentMainSha,rearms,currentSourceRevision,relevantMainChanged,currentMaterialSignature))return false;
  return true;
}
export function classifyCodingBlocker(summary){
  const raw=String(summary||'').trim();
  const text=raw.toUpperCase();
  const hard=/(SECURITY|CREDENTIAL|PAID|DESTRUCTIVE|PRODUCTION|BROWSER_AUTH|AUTHORIZATION_REQUIRED|HUMAN_POLICY|SCOPE_VIOLATION|OUT_OF_SCOPE|POLICY_BLOCK|POLICY_REJECT|REVIEW_(?:REJECTED|CHANGES).*HUMAN)/.test(text);
  if(hard)return {kind:'HARD',transient:false,reason:raw||'HARD_POLICY_BLOCK'};
  const transient=/(HTTP[_ -]?429|RATE[_ -]?LIMIT|PROVIDER|TIMEOUT|TRANSIENT|NETWORK|RESOURCE_EXHAUSTED|WAITING_RESOURCE|AI_RESOURCES_UNAVAILABLE|MANAGER[_ ]DECISION[_ ]EXHAUSTED)/.test(text);
  const recoverable=transient||/(MANAGER_SOFT_BLOCK|CODING_COMPACT_EDIT_INVALID|CODING_COMPACT_REPAIR(?:_MULTI_FILE)?_INVALID|COMPACT_(?:EDIT|REPAIR)|OUTPUT_CONTRACT|OUTPUT_SCHEMA|SCHEMA_INVALID|CI_GATE_REPAIR_EXHAUSTED|CI_REPAIR_EXHAUSTED)/.test(text);
  if(recoverable)return {kind:'RECOVERABLE',transient,reason:raw||'RECOVERABLE_BLOCK'};
  return {kind:'RECOVERABLE',transient:false,reason:raw||'UNCLASSIFIED_RECOVERABLE'};
}
export function shouldRearmRecoverableFinal(final,currentMainSha,rearms=[],currentSourceRevision='',relevantMainChanged=false,currentMaterialSignature=''){
  const mainSha=String(currentMainSha||'').trim();
  const sourceRevision=String(currentSourceRevision||'').trim();
  const finalReason=String(final?.reason||'').toUpperCase();
  if(!mainSha||!['RETRY_BUDGET_EXHAUSTED','NO_PROGRESS_WAIT_MATERIAL_CHANGE','HARD_BLOCKER','ISSUE_CLOSED_OR_SUPERSEDED'].includes(finalReason))return false;
  const terminalReason=String(final?.terminalReason||'');
  if(classifyCodingBlocker(terminalReason).kind!=='RECOVERABLE')return false;
  const sourceChanged=Boolean(sourceRevision)&&String(final?.sourceRevision||'').trim()!==sourceRevision;
  if(!sourceChanged&&!relevantMainChanged)return false;
  if(final?.materialSignature&&currentMaterialSignature&&String(final.materialSignature)===String(currentMaterialSignature)&&!relevantMainChanged)return false;
  const priorObjectiveId=String(final?.codingObjectiveId||'');
  return !(rearms||[]).some(x=>
    String(x?.mainSha||'').trim()===mainSha&&
    String(x?.sourceRevision||'').trim()===sourceRevision&&
    String(x?.priorObjectiveId||'')===priorObjectiveId
  );
}

// The retry budget belongs to the CURRENT dispatched objective's recovery epoch.
// Counting every retry ever dispatched for an issue makes a newly rearmed objective
// immediately exhaust its inherited historical budget (even without a new retry).
export function codingWorkOrderFailureBudget(retries=[],failure='',materialSignature=''){
  const signature=String(failure||'').trim().replace(/\s+/g,' ').toUpperCase();
  const material=String(materialSignature||'').trim();
  if(!signature||!material)return 0;
  return (Array.isArray(retries)?retries:[]).filter(row=>
    String(row?.materialSignature||'')===material&&
    String(row?.failureSignature||row?.reason||'').trim().replace(/\s+/g,' ').toUpperCase()===signature
  ).length;
}

// Global work-order failure budget cannot reset merely by changing objective.
export function codingRetryEpochState(retryEvents=[],recoveryEvents=[],objectiveId=''){
  const id=String(objectiveId||'');
  const byId=new Map();
  for(const retry of Array.isArray(retryEvents)?retryEvents:[]){
    const key=String(retry?.codingObjectiveId||'');
    if(!key)continue;
    if(byId.has(key))return {retryCount:MAX_AUTO_RETRIES,epochRootId:id,recovered:false,reason:'DUPLICATE_RETRY_EVENT'};
    byId.set(key,retry);
  }
  let cursor=id,previous=MAX_AUTO_RETRIES+1;
  const visited=new Set();
  while(cursor&&byId.has(cursor)){
    if(visited.has(cursor))return {retryCount:MAX_AUTO_RETRIES,epochRootId:id,recovered:false,reason:'RETRY_CHAIN_CYCLE'};
    visited.add(cursor);
    const attempt=Number(byId.get(cursor)?.retryAttempt);
    if(!Number.isInteger(attempt)||attempt<1||attempt>=previous||attempt>MAX_AUTO_RETRIES){
      return {retryCount:MAX_AUTO_RETRIES,epochRootId:id,recovered:false,reason:'INVALID_RETRY_CHAIN'};
    }
    previous=attempt;
    cursor=String(byId.get(cursor)?.priorObjectiveId||'');
  }
  const direct=byId.get(id);
  const retryCount=direct?Number(direct.retryAttempt):0;
  const epochRootId=cursor||id;
  // Includes exhausted-budget recovery, stale-result rearm and
  // reopened-completion rearm; every new canonical objective gets unique keys.
  const recovered=(Array.isArray(recoveryEvents)?recoveryEvents:[])
    .some(x=>String(x?.codingObjectiveId||'')===epochRootId);
  return {retryCount,epochRootId,recovered,reason:'CURRENT_OBJECTIVE_EPOCH'};
}

export async function relevantRecoveryMainChangeEvidence(fetchImpl,owner,repo,token,fromSha,toSha,scopeLease,compareCache=null){
  const from=String(fromSha||'').trim(),to=String(toSha||'').trim();
  const paths=[...new Set((scopeLease?.paths||[]).map(x=>String(x||'').trim().replace(/^\.\//,'').replace(/\/+$/,'')).filter(Boolean))];
  const none={relevantMainChanged:false,relevantChangedPaths:[],compareAvailable:false};
  if(!from||!to||from===to||!paths.length)return none;
  const key=`${from}...${to}`;
  let compare=compareCache?.get?.(key);
  if(!compare){
    try{
      compare=await gh(fetchImpl,owner,repo,`/compare/${from}...${to}?per_page=100`,token);
      compareCache?.set?.(key,compare);
    }catch{
      compareCache?.set?.(key,{__compareUnavailable:true});
      return none;
    }
  }
  if(compare?.__compareUnavailable||!Array.isArray(compare?.files)||compare.files.length>=300)return none;
  const changed=[];
  for(const file of compare.files){
    const filename=String(file?.filename||'').trim();
    if(!filename)return none;
    changed.push(filename);
  }
  const relevant=[...new Set(changed.filter(file=>paths.some(scope=>file===scope||file.startsWith(`${scope}/`))))].slice(0,32);
  return {relevantMainChanged:relevant.length>0,relevantChangedPaths:relevant,compareAvailable:true};
}

export async function relevantRecoveryMainChange(fetchImpl,owner,repo,token,fromSha,toSha,scopeLease,compareCache=null){
  return (await relevantRecoveryMainChangeEvidence(fetchImpl,owner,repo,token,fromSha,toSha,scopeLease,compareCache)).relevantMainChanged;
}
function issueSuperseded(issue){
  if(!issue||issue.state!=='open')return true;
  const body=String(issue.body||'');
  const legacyState=currentCodingValue(body,'STATE').toUpperCase();
  const state=currentCodingValue(body,'CURRENT_STATE').toUpperCase();
  const autoQueue=currentCodingValue(body,'AUTO_QUEUE').toUpperCase();
  // Only the canonical first anchored value may retire currently executable
  // work. Historical `TIGERIQ_EXECUTABLE=false` notes are not live denials.
  return /^(?:SUPERSEDED|CANCELLED|CANCELED)(?:_|$)/.test(legacyState)
    ||/^(?:DONE|COMPLETED|TERMINAL|FAILED|CANCELLED|CANCELED|CLOSED|SUPERSEDED|NOT_PLANNED)(?:_|$)/.test(state)
    ||currentCodingValue(body,'TIGERIQ_EXECUTABLE').toLowerCase()==='false'
    ||autoQueue==='EXCLUDED'||autoQueue.startsWith('EXCLUDED_')
    ||Boolean(currentCodingValue(body,'SUPERSEDED_BY')||currentCodingValue(body,'SUPERSEDED'));
}
function objectiveTerminal(objective){return ['completed','blocked'].includes(String(objective?.status||'').toLowerCase())}
function objectiveMentionsIssue(objective,n){return new RegExp(`(?:issue\\s+|#)${n}\\b`,'i').test(String(objective?.objective||''))}
function objectiveIssueNumber(objective){const m=String(objective?.objective||'').match(/\bissue\s+#(\d+)\b/i);const n=Number(m?.[1]||0);return Number.isInteger(n)&&n>0?n:null}
async function activeCodingOwnerBlocksRetry({pool,status,fetchImpl,owner,repo,token,excludeObjectiveIds=[],targetScope=null}){
  const excluded=new Set(excludeObjectiveIds.filter(Boolean));
  for(const active of status.objectives||[]){
    if(excluded.has(active?.id)||objectiveTerminal(active))continue;
    const sourceIssueNumber=objectiveIssueNumber(active);
    if(!sourceIssueNumber)return true;
    let sourceIssue;
    try{sourceIssue=await gh(fetchImpl,owner,repo,`/issues/${sourceIssueNumber}`,token)}catch(error){if(githubRateLimitCooldownMs(error)>0)throw error;return true}
    if(sourceIssue?.state==='open'&&!sourceIssue?.pull_request){
      const activeScope=parseCodingScope(sourceIssue.body);
      if(codingScopesOverlap(targetScope,activeScope))return true;
      continue;
    }
    if(!(await markerExists(pool,'GITHUB_CODING_STALE_OWNER_IGNORED',sourceIssueNumber))){
      await mark(pool,'GITHUB_CODING_STALE_OWNER_IGNORED',{issueNumber:sourceIssueNumber,codingObjectiveId:active.id,sourceState:String(sourceIssue?.state||'unknown')});
    }
  }
  return false;
}
async function activeCodingDispatches(pool,laneStatus,{fetchImpl=fetch,owner=DEFAULT_OWNER,repo=DEFAULT_REPO,token=''}={}){
  const liveObjectiveIds=new Set((laneStatus?.objectives||[]).filter(x=>!objectiveTerminal(x)).map(x=>String(x.id||'')).filter(Boolean));
  for(const job of laneStatus?.jobs||[]){
    if(['done','failed','blocked'].includes(String(job?.status||'').toLowerCase()))continue;
    if(job?.objective_id)liveObjectiveIds.add(String(job.objective_id));
  }
  const rows=(await pool.query("select distinct on ((data->>'issueNumber')::int) data from tigeriq_events where type='GITHUB_CODING_DISPATCHED' and data ? 'issueNumber' order by ((data->>'issueNumber')::int), seq desc")).rows;
  const seen=new Set(),active=[];
  for(const row of rows){
    const data=row.data||{},n=Number(data.issueNumber),objectiveId=String(data.codingObjectiveId||'');
    if(!n||!objectiveId||seen.has(n))continue;
    seen.add(n);
    const liveObjective=(laneStatus?.objectives||[]).find(x=>String(x?.id||'')===objectiveId);
    if(await hasCompletedCodingResult(pool,n)||await hasEffectiveBlockedFinal(pool,n,liveObjective?.summary,objectiveId))continue;
    if(!liveObjectiveIds.has(objectiveId))continue;
    try{
      const sourceIssue=await gh(fetchImpl,owner,repo,`/issues/${n}`,token);
      const sourceState=String(sourceIssue?.state||'').toLowerCase();
      const explicitlySuperseded=sourceState==='open'&&issueSuperseded(sourceIssue);
      if(sourceState==='closed'||explicitlySuperseded){
        if(!(await markerExists(pool,'GITHUB_CODING_STALE_SCOPE_IGNORED',n))){
          await mark(pool,'GITHUB_CODING_STALE_SCOPE_IGNORED',{issueNumber:n,codingObjectiveId:objectiveId,sourceState:sourceState||'unknown'});
        }
        continue;
      }
    }catch(error){
      if(githubRateLimitCooldownMs(error)>0)throw error;
      // Fail closed: if source truth cannot be verified, keep the lease active.
    }
    active.push({issueNumber:n,codingObjectiveId:objectiveId,scopeLease:data.scopeLease||{resourceScope:'',paths:[],ambiguous:true}});
  }
  return active;
}

async function dependencyGate(fetchImpl,owner,repo,token,dependsOn){
  for(const depNum of dependsOn){
    let depIssue;
    try{depIssue=await gh(fetchImpl,owner,repo,`/issues/${depNum}`,token)}catch(error){if(githubRateLimitCooldownMs(error)>0)throw error;return {ok:false,reason:'DEPENDENCY_LOOKUP_FAILED',dependency:depNum,error:String(error?.message||error)}}
    if(!depIssue||depIssue.pull_request||depIssue.state!=='closed')return {ok:false,reason:'DEPENDENCY_OPEN',dependency:depNum,state:String(depIssue?.state||'unknown')};
    if(!sourceTerminalDependencyAccepted(depIssue))return {ok:false,reason:'DEPENDENCY_NOT_TERMINAL_ACCEPTED',dependency:depNum,state:String(depIssue?.state||'unknown'),stateReason:String(depIssue?.state_reason||'')};
  }
  return {ok:true};
}

async function recordDependencyWait(pool,fetchImpl,owner,repo,token,{issueNumber,objectiveId,dependsOn,sourceRevision,stage,gate}){
  const waitKey=[stage||'dispatch',objectiveId||'none',sourceRevision||'unknown',gate?.reason||'DEPENDENCY_WAIT',gate?.dependency||'none'].join(':');
  const prior=await eventData(pool,'GITHUB_CODING_DEPENDENCY_WAIT',issueNumber);
  if(prior.some(x=>String(x.waitKey||'')===waitKey))return false;
  await mark(pool,'GITHUB_CODING_DEPENDENCY_WAIT',{issueNumber,objectiveId:objectiveId||null,dependsOn,sourceRevision:sourceRevision||null,stage:stage||'dispatch',waitKey,...gate});
  await comment(fetchImpl,owner,repo,issueNumber,token,`[DEPENDENCY_WAIT] stage=${stage||'dispatch'} objective=${objectiveId||'none'} dependency=${gate?.dependency||'unknown'} reason=${gate?.reason||'DEPENDENCY_WAIT'} sourceRevision=${sourceRevision||'unknown'}`);
  return true;
}

export async function materializeGithubCodingIssues({pool,fetchImpl=fetch,owner=DEFAULT_OWNER,repo=DEFAULT_REPO,token='',codingLaneUrl=process.env.TIGERIQ_CODING_LANE_URL||DEFAULT_CODING_URL,concurrencyCap=Number(process.env.TIGERIQ_GITHUB_CODING_CONCURRENCY||DEFAULT_CONCURRENCY_CAP),openIssues=null}){
  const cap=Math.max(1,Math.min(8,Number.isFinite(Number(concurrencyCap))?Math.floor(Number(concurrencyCap)):DEFAULT_CONCURRENCY_CAP));
  const issues=Array.isArray(openIssues)?openIssues:await gh(fetchImpl,owner,repo,'/issues?state=open&per_page=100&sort=updated&direction=desc',token,{freshMs:30000});
  const specs=sortBacklogSpecs(issues.map(parseCodingIssue).filter(Boolean));
  const baseCounters={openIssues:issues.filter(x=>x?.state==='open'&&!x?.pull_request).length,codingEligible:specs.length,dependencyBlocked:0,scopeBlocked:0,terminalOrDispatched:0,activeSlots:0,freeSlots:0,skipReasons:[]};
  let laneStatus;
  try{laneStatus=await jsonFetch(fetchImpl,`${codingLaneUrl.replace(/\/$/,'')}/api/status`)}
  catch(error){return {created:0,active:0,considered:specs.length,...baseCounters,skipReason:'LANE_STATUS_UNAVAILABLE',error:String(error?.message||error)}}
  const active=await activeCodingDispatches(pool,laneStatus,{fetchImpl,owner,repo,token});
  const activeScopes=active.map(x=>x.scopeLease);
  const counters={...baseCounters,activeSlots:active.length,freeSlots:Math.max(0,cap-active.length)};
  if(counters.freeSlots<=0)return {created:0,active:active.length,considered:specs.length,...counters,skipReason:'CAPACITY_FULL'};

  let created=0,recovered=0;
  for(const spec of specs){
    if(active.length+created+recovered>=cap){
      counters.skipReasons.push({issueNumber:spec.number,skipReason:'CAPACITY_FULL'});
      continue;
    }
    const hasDispatchMarker=await markerExists(pool,'GITHUB_CODING_DISPATCHED',spec.number);
    let completedReopenKey='';
    if(hasDispatchMarker){
      completedReopenKey=await reopenedCompletionKey(fetchImpl,owner,repo,token,{
        number:spec.number,title:spec.title,body:spec.body,state:'open',html_url:spec.url
      });
      if(completedReopenKey){
        const priorRearms=await eventData(pool,'GITHUB_CODING_COMPLETED_REARMED',spec.number);
        if(priorRearms.some(x=>String(x.reopenKey||'')===completedReopenKey))completedReopenKey='';
      }
    }
    if(hasDispatchMarker&&!completedReopenKey){
      counters.terminalOrDispatched++;
      counters.skipReasons.push({issueNumber:spec.number,skipReason:'ALREADY_DISPATCHED_OR_TERMINAL'});
      continue;
    }
    const gate=await dependencyGate(fetchImpl,owner,repo,token,spec.dependsOn);
    if(!gate.ok){
      counters.dependencyBlocked++;
      counters.skipReasons.push({issueNumber:spec.number,skipReason:gate.reason,dependency:gate.dependency||null});
      if(!(await markerExists(pool,'GITHUB_CODING_DEPENDENCY_WAIT',spec.number)))await mark(pool,'GITHUB_CODING_DEPENDENCY_WAIT',{issueNumber:spec.number,dependsOn:spec.dependsOn,...gate});
      console.warn(JSON.stringify({event:'GITHUB_CODING_DEPENDENCY_WAIT',issueNumber:spec.number,dependsOn:spec.dependsOn,...gate}));
      continue;
    }
    if(activeScopes.some(scope=>codingScopesOverlap(scope,spec.scopeLease))){
      counters.scopeBlocked++;
      counters.skipReasons.push({issueNumber:spec.number,skipReason:'SCOPE_OVERLAP'});
      continue;
    }
    if(spec.dependsOn.length&&await markerExists(pool,'GITHUB_CODING_DEPENDENCY_WAIT',spec.number)&&!(await markerExists(pool,'GITHUB_DEPENDENCY_RELEASED',spec.number))){
      await mark(pool,'GITHUB_DEPENDENCY_RELEASED',{issueNumber:spec.number,dependsOn:spec.dependsOn});
      console.log(JSON.stringify({event:'GITHUB_DEPENDENCY_RELEASED',issueNumber:spec.number,dependsOn:spec.dependsOn}));
    }
    const reopenSuffix=completedReopenKey?'-REOPEN-'+createHash('sha256').update(completedReopenKey).digest('hex').slice(0,12):'';
    const dispatchKey=`GITHUB-ISSUE-${spec.number}${reopenSuffix}`;
    const sourceRevision=await codingSourceRevision(fetchImpl,owner,repo,token,{number:spec.number,title:spec.title,body:spec.body,comments:spec.comments});
    const objective=`GitHub autonomous coding issue #${spec.number}: ${spec.title}\n${spec.url}\n\nDISPATCH_KEY=${dispatchKey}\nSOURCE_REVISION=${sourceRevision}\n${completedReopenKey?`REOPEN_KEY=${completedReopenKey}\n`:''}\n${spec.body}\n\nExecute only zero-cost reversible repository work. Keep direct main writes, paid cost, credentials/security, destructive actions, production release, browser authentication and PC01 source editing blocked.`;
    let out=(laneStatus?.objectives||[]).find(x=>String(x?.objective||'').includes(`DISPATCH_KEY=${dispatchKey}`));
    let recoveredExisting=false;
    if(out?.id){recoveredExisting=true}
    else{
      out=await jsonFetch(fetchImpl,`${codingLaneUrl.replace(/\/$/,'')}/api/objectives`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
        objective,
        priority:spec.priority,
        targetEmployee:spec.routing?.targetEmployee||null,
        currentPr:spec.routing?.currentPr||null,
        targetHead:spec.routing?.targetHead||null,
      })});
      if(!out?.id)throw new Error('CODING_OBJECTIVE_ID_MISSING');
      laneStatus={...(laneStatus||{}),objectives:[...(laneStatus?.objectives||[]),{id:out.id,objective,status:'queued'}]};
    }
    // The Coding objective must exist before the old terminal projection is cleared.
    // The durable GitHub dispatch/rearm markers are written only after clear succeeds.
    // This makes both objective-creation failure and label-mutation failure retry-safe.
    await clearTerminalBlockedLabel({fetchImpl,owner,repo,issueNumber:spec.number,token});
    const dispatchReason=spec.ownerDirect?`OWNER_DIRECT>${spec.sourcePriority}`:`PRIORITY_${spec.sourcePriority}`;
    if(completedReopenKey){
      const priorResultObjectiveId=String((await eventData(pool,'GITHUB_CODING_RESULT_REPORTED',spec.number))[0]?.codingObjectiveId||'');
      const priorDispatchObjectiveId=String((await eventData(pool,'GITHUB_CODING_DISPATCHED',spec.number))[0]?.codingObjectiveId||'');
      await mark(pool,'GITHUB_CODING_COMPLETED_REARMED',{issueNumber:spec.number,priorObjectiveId:priorResultObjectiveId||priorDispatchObjectiveId,codingObjectiveId:out.id,reopenKey:completedReopenKey,dispatchKey});
    }
    await mark(pool,'GITHUB_CODING_DISPATCHED',{issueNumber:spec.number,issueUrl:spec.url,codingObjectiveId:out.id,ownerDirect:spec.ownerDirect,sourcePriority:spec.sourcePriority,dispatchPriority:spec.priority,dispatchReason,scopeLease:spec.scopeLease,dispatchKey,sourceRevision,materialSignature:codingMaterialSourceSignature({title:spec.title,body:spec.body}),recoveredExisting,reopenKey:completedReopenKey||null,routing:spec.routing||null});
    await comment(fetchImpl,owner,repo,spec.number,token,completedReopenKey?`[REOPEN_REARMED] TigerIQ Coding Lane rearmed this reopened Work Order as ${out.id}. Dispatch: ${dispatchReason}.`:recoveredExisting?`[CLAIM_RECOVERED] TigerIQ Coding Lane already had this issue as ${out.id}; durable dispatch state was restored. Dispatch: ${dispatchReason}.`:`[CLAIM] TigerIQ Coding Lane accepted this issue as ${out.id}. Automatic coding pipeline is active. Dispatch: ${dispatchReason}.`);
    activeScopes.push(spec.scopeLease);
    if(recoveredExisting)recovered++;else created++;
  }
  counters.activeSlots=active.length+created+recovered;
  counters.freeSlots=Math.max(0,cap-counters.activeSlots);
  return {created,recovered,active:active.length,considered:specs.length,...counters,skipReason:counters.freeSlots===0?'CAPACITY_FULL':null};
}

export async function syncGithubCodingOutcomes({pool,fetchImpl=fetch,owner=DEFAULT_OWNER,repo=DEFAULT_REPO,token='',codingLaneUrl=process.env.TIGERIQ_CODING_LANE_URL||DEFAULT_CODING_URL,now=()=>Date.now(),issueNumbers=null,yieldIf=null}){
  const rows=(await pool.query("select distinct on ((data->>'issueNumber')::int) data from tigeriq_events where type='GITHUB_CODING_DISPATCHED' and data ? 'issueNumber' order by ((data->>'issueNumber')::int), seq desc")).rows;
  if(!rows.length)return {progress:0,results:0};
  const issueFilter=new Set((Array.isArray(issueNumbers)?issueNumbers:[]).map(Number).filter(n=>Number.isInteger(n)&&n>0));
  const status=await jsonFetch(fetchImpl,`${codingLaneUrl.replace(/\/$/,'')}/api/status`);
  let currentMainSha='';
  try{currentMainSha=String((await gh(fetchImpl,owner,repo,'/git/ref/heads/main',token))?.object?.sha||'').trim()}catch(error){if(githubRateLimitCooldownMs(error)>0)throw error}
  let progress=0,results=0;
  const seenIssues=new Set();
  const recoveryCompareCache=new Map();
  let retryCreatedThisTick=false;
  for(const row of rows){
    if(typeof yieldIf==='function'&&yieldIf())break;
    const n=Number(row.data?.issueNumber),id=String(row.data?.codingObjectiveId||'');
    if(!n||!id||seenIssues.has(n))continue;
    if(issueFilter.size&&!issueFilter.has(n))continue;
    seenIssues.add(n);
    const objective=(status.objectives||[]).find(x=>x.id===id);
    const completedResultReported=await hasCompletedCodingResult(pool,n);
    // A previously reported completion is terminal only for the exact source
    // revision that produced it. Keep historical/missing objectives quiet, but
    // let a still-visible completed objective reach source reconciliation so a
    // later canonical body/Owner revision can use the existing stale-result
    // reject/rearm path instead of being masked forever.
    if(completedResultReported&&String(objective?.status||'').toLowerCase()!=='completed')continue;
    if(!objective){
      // Historical terminal Coding objectives may already be garbage-collected from lane status.
      // Only fetch GitHub for an unsynced blocked-final event; normal historical dispatch rows stay request-free.
      const historicalFinal=(await eventData(pool,'GITHUB_CODING_BLOCKED_FINAL',n))[0]||null;
      const historicalObjectiveId=String(historicalFinal?.codingObjectiveId||id);
      if(!historicalFinal||historicalObjectiveId!==id)continue;
      const terminalLabelSynced=await objectiveMarkerExists(pool,'GITHUB_CODING_TERMINAL_LABEL_SYNCED',n,historicalObjectiveId);
      let historicalIssue;
      try{historicalIssue=await gh(fetchImpl,owner,repo,`/issues/${n}`,token)}
      catch(error){
        if(githubRateLimitCooldownMs(error)>0)throw error;
        console.warn(JSON.stringify({event:'GITHUB_CODING_HISTORICAL_LABEL_SYNC_WAIT',issueNumber:n,codingObjectiveId:historicalObjectiveId,error:String(error?.message||error)}));
        continue;
      }
      const historicalSourceGate=codingSourceReconcileGate(historicalIssue);
      if(!historicalSourceGate.allow){
        if(!(await objectiveMarkerExists(pool,'GITHUB_CODING_SOURCE_QUIETED',n,historicalObjectiveId))){
          await mark(pool,'GITHUB_CODING_SOURCE_QUIETED',{issueNumber:n,codingObjectiveId:historicalObjectiveId,reason:historicalSourceGate.reason,state:historicalSourceGate.state,stateReason:String(historicalIssue?.state_reason||''),historical:true});
        }
        continue;
      }
      const historicalSourceRevision=await codingSourceRevision(fetchImpl,owner,repo,token,historicalIssue);
      const historicalSpec=parseCodingIssue(historicalIssue);
      const historicalEvidence=historicalSpec&&String(historicalFinal?.mainSha||'').trim()!==currentMainSha&&String(historicalFinal?.sourceRevision||'').trim()===String(historicalSourceRevision||'').trim()
        ?await relevantRecoveryMainChangeEvidence(fetchImpl,owner,repo,token,historicalFinal.mainSha,currentMainSha,historicalSpec.scopeLease,recoveryCompareCache)
        :{relevantMainChanged:false};
      // The Coding Lane may have garbage-collected a terminal objective after
      // persisting BLOCKED_FINAL. A durable dispatch marker must not turn
      // a genuinely NEW Owner source revision into a permanent dead-end.
      // Recover only the latest canonical terminal, with the exact same
      // hard-block, material-change, dependency, lease, and idempotency gates
      // used for a still-visible terminal objective.
      const historicalRearms=await eventData(pool,'GITHUB_CODING_RECOVERY_REARMED',n);
      if(historicalSpec&&!issueSuperseded(historicalIssue)&&
         shouldRearmRecoverableFinal(historicalFinal,currentMainSha,historicalRearms,historicalSourceRevision,historicalEvidence.relevantMainChanged,codingMaterialSourceSignature(historicalIssue))){
        if(retryCreatedThisTick)continue;
        const dependency=await dependencyGate(fetchImpl,owner,repo,token,historicalSpec.dependsOn);
        if(!dependency.ok){
          await recordDependencyWait(pool,fetchImpl,owner,repo,token,{issueNumber:n,objectiveId:id,dependsOn:historicalSpec.dependsOn,sourceRevision:historicalSourceRevision,stage:'archived-terminal-rearm',gate:dependency});
          continue;
        }
        if(await activeCodingOwnerBlocksRetry({pool,status,fetchImpl,owner,repo,token,excludeObjectiveIds:[id],targetScope:historicalSpec.scopeLease}))continue;
        const sourceKey=(historicalSourceRevision||'no-source').replace(/[^0-9A-Za-z]/g,'').slice(-20)||'no-source';
        const recoveryKey=`GITHUB-ISSUE-${n}-RECOVERY-${currentMainSha.slice(0,12)}-${sourceKey}`;
        let recovered=(status.objectives||[]).find(x=>String(x.objective||'').includes(`RECOVERY_KEY=${recoveryKey}`));
        if(!recovered){
          const text=`GitHub autonomous coding recovery from archived terminal objective for issue #${n}: ${historicalSpec.title}
${historicalSpec.url}

RECOVERY_KEY=${recoveryKey}
SOURCE_BASE=${currentMainSha}
SOURCE_REVISION=${historicalSourceRevision||'unknown'}
PRIOR_OBJECTIVE_ID=${id}

${historicalSpec.body}

Continue only after the canonical source materially changed. Execute zero-cost reversible repository work only. No direct main, security/credential changes, production release, destructive actions, browser auth or PC01 source edits.`;
          const out=await jsonFetch(fetchImpl,`${codingLaneUrl.replace(/\/$/,'')}/api/objectives`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({objective:text,priority:historicalSpec.priority})});
          if(!out?.id)throw new Error('CODING_ARCHIVED_RECOVERY_OBJECTIVE_ID_MISSING');
          recovered={id:out.id,objective:text,status:'queued'};
        }
        // Write the canonical dispatch marker only AFTER label clearance,
        // then keep a single explicit recovery receipt per material revision.
        await clearTerminalBlockedLabel({fetchImpl,owner,repo,issueNumber:n,token});
        await mark(pool,'GITHUB_CODING_RECOVERY_REARMED',{issueNumber:n,priorObjectiveId:id,codingObjectiveId:recovered.id,mainSha:currentMainSha,sourceRevision:historicalSourceRevision||null,sourceChanged:String(historicalFinal.sourceRevision||'')!==String(historicalSourceRevision||''),recoveryKey,historical:true});
        await mark(pool,'GITHUB_CODING_DISPATCHED',{issueNumber:n,issueUrl:historicalSpec.url,codingObjectiveId:recovered.id,ownerDirect:historicalSpec.ownerDirect,sourcePriority:historicalSpec.sourcePriority,dispatchPriority:historicalSpec.priority,dispatchReason:'ARCHIVED_MATERIAL_RECOVERY',recoveryKey,sourceRevision:historicalSourceRevision||null,materialSignature:codingMaterialSourceSignature(historicalIssue),priorObjectiveId:id,scopeLease:historicalSpec.scopeLease});
        await comment(fetchImpl,owner,repo,n,token,`[ARCHIVED_RECOVERY_REARMED] ${recovered.id} prior=${id} revision=${historicalSourceRevision||'unknown'}`);
        retryCreatedThisTick=true;
        results++;
        continue;
      }
      if(!terminalLabelSynced&&await hasEffectiveBlockedFinal(pool,n,'',historicalObjectiveId,currentMainSha,historicalSourceRevision,historicalEvidence.relevantMainChanged,codingMaterialSourceSignature(historicalIssue))){
        await addTerminalBlockedLabel({fetchImpl,owner,repo,issueNumber:n,token});
        await mark(pool,'GITHUB_CODING_TERMINAL_LABEL_SYNCED',{issueNumber:n,codingObjectiveId:historicalObjectiveId,historical:true});
      }
      continue;
    }
    let currentIssue;
    try{currentIssue=await gh(fetchImpl,owner,repo,`/issues/${n}`,token)}
    catch(error){
      if(githubRateLimitCooldownMs(error)>0)throw error;
      console.warn(JSON.stringify({event:'GITHUB_CODING_SOURCE_RECONCILE_WAIT',issueNumber:n,codingObjectiveId:id,error:String(error?.message||error)}));
      continue;
    }
    const sourceGate=codingSourceReconcileGate(currentIssue);
    if(!sourceGate.allow){
      if(!(await objectiveMarkerExists(pool,'GITHUB_CODING_SOURCE_QUIETED',n,id))){
        await mark(pool,'GITHUB_CODING_SOURCE_QUIETED',{issueNumber:n,codingObjectiveId:id,reason:sourceGate.reason,state:sourceGate.state,stateReason:String(currentIssue?.state_reason||''),historical:false});
      }
      continue;
    }
    const currentSourceRevision=await codingSourceRevision(fetchImpl,owner,repo,token,currentIssue);
    const recoverySpec=parseCodingIssue(currentIssue);
    const recoveryFinal=(await eventData(pool,'GITHUB_CODING_BLOCKED_FINAL',n))[0]||null;
    const recoveryEvidence=recoverySpec&&recoveryFinal&&String(recoveryFinal?.mainSha||'').trim()!==currentMainSha&&String(recoveryFinal?.sourceRevision||'').trim()===String(currentSourceRevision||'').trim()
      ?await relevantRecoveryMainChangeEvidence(fetchImpl,owner,repo,token,recoveryFinal.mainSha,currentMainSha,recoverySpec.scopeLease,recoveryCompareCache)
      :{relevantMainChanged:false,relevantChangedPaths:[],compareAvailable:false};
    const relevantMainChanged=recoveryEvidence.relevantMainChanged;
    if(await hasEffectiveBlockedFinal(pool,n,objective?.summary,id,currentMainSha,currentSourceRevision,relevantMainChanged,codingMaterialSourceSignature(currentIssue))){
      if(!(await objectiveMarkerExists(pool,'GITHUB_CODING_TERMINAL_LABEL_SYNCED',n,id))){
        await addTerminalBlockedLabel({fetchImpl,owner,repo,issueNumber:n,token});
        await mark(pool,'GITHUB_CODING_TERMINAL_LABEL_SYNCED',{issueNumber:n,codingObjectiveId:id});
      }
      continue;
    }
    const job=(status.jobs||[]).find(x=>x.objective_id===id);
    if(job&&!(await objectiveMarkerExists(pool,'GITHUB_CODING_PROGRESS_REPORTED',n,id))){
      const pr=job.pr_number?` PR #${job.pr_number}.`:'';
      await comment(fetchImpl,owner,repo,n,token,`[PROGRESS] ${id} is ${job.status}. Implementer: ${job.employee_id||'pending'}; reviewer: ${job.reviewer_employee_id||'pending'}.${pr}`);
      await mark(pool,'GITHUB_CODING_PROGRESS_REPORTED',{issueNumber:n,codingObjectiveId:id,jobId:job.id,prNumber:job.pr_number||null});
      progress++;
    }
    if(!objectiveTerminal(objective))continue;
    if(String(objective.status).toLowerCase()==='completed'){
      const dispatchSourceRevision=String(row.data?.sourceRevision||'').trim();
      const awaiting=(await eventData(pool,'GITHUB_CODING_AWAITING_ACCEPTANCE',n))
        .find(e=>String(e.codingObjectiveId||'')===id);
      const priorMaterial=String(row.data?.materialSignature||awaiting?.materialSignature||'').trim();
      const materialStable=Boolean(awaiting)&&(!priorMaterial||priorMaterial===codingMaterialSourceSignature(currentIssue));
      // An operational Issue update is not authorization to repeat completed
      // coding. Continue to the product acceptance gate instead of rearming.
      if((!dispatchSourceRevision||dispatchSourceRevision!==currentSourceRevision)&&!materialStable){
        const staleKey=`GITHUB-ISSUE-${n}-STALE-${createHash('sha256').update(currentSourceRevision||'unknown').digest('hex').slice(0,12)}`;
        const rejected=(await eventData(pool,'GITHUB_CODING_STALE_RESULT_REJECTED',n)).some(x=>
          String(x.codingObjectiveId||'')===id&&String(x.currentSourceRevision||'')===currentSourceRevision
        );
        if(!rejected){
          await mark(pool,'GITHUB_CODING_STALE_RESULT_REJECTED',{issueNumber:n,codingObjectiveId:id,dispatchSourceRevision:dispatchSourceRevision||null,currentSourceRevision:currentSourceRevision||null,staleKey});
          await comment(fetchImpl,owner,repo,n,token,`[STALE_RESULT_REJECTED] ${id} completed against sourceRevision=${dispatchSourceRevision||'missing'}; current=${currentSourceRevision||'unknown'}. Result was not allowed to close the Work Order.`);
          results++;
        }
        const spec=parseCodingIssue(currentIssue);
        if(!spec)continue;
        const gate=await dependencyGate(fetchImpl,owner,repo,token,spec.dependsOn);
        if(!gate.ok){
          await recordDependencyWait(pool,fetchImpl,owner,repo,token,{issueNumber:n,objectiveId:id,dependsOn:spec.dependsOn,sourceRevision:currentSourceRevision,stage:'stale-result-rearm',gate});
          continue;
        }
        const priorRearm=(await eventData(pool,'GITHUB_CODING_STALE_RESULT_REARMED',n)).find(x=>String(x.staleKey||'')===staleKey);
        if(priorRearm)continue;
        if(retryCreatedThisTick)continue;
        const blockedByActiveOwner=await activeCodingOwnerBlocksRetry({pool,status,fetchImpl,owner,repo,token,excludeObjectiveIds:[id],targetScope:spec.scopeLease});
        if(blockedByActiveOwner)continue;
        let rearmObjective=(status.objectives||[]).find(x=>String(x.objective||'').includes(`STALE_REARM_KEY=${staleKey}`));
        if(!rearmObjective){
          const objectiveText=`GitHub autonomous coding rearm after stale completed result for issue #${spec.number}: ${spec.title}\n${spec.url}\n\nSTALE_REARM_KEY=${staleKey}\nSOURCE_REVISION=${currentSourceRevision||'unknown'}\nPRIOR_OBJECTIVE_ID=${id}\n\n${spec.body}\n\nThe prior completed result targeted an older canonical source revision. Re-evaluate only the current issue body and Owner directive. Do not close from stale evidence and do not open a duplicate repair issue. Execute only zero-cost reversible repository work. Keep direct main writes, paid cost, credentials/security, destructive actions, production release, browser authentication and PC01 source editing blocked.`;
          const out=await jsonFetch(fetchImpl,`${codingLaneUrl.replace(/\/$/,'')}/api/objectives`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({objective:objectiveText,priority:spec.priority})});
          if(!out?.id)throw new Error('CODING_STALE_REARM_OBJECTIVE_ID_MISSING');
          rearmObjective={id:out.id,objective:objectiveText,status:'queued'};
        }
        await clearTerminalBlockedLabel({fetchImpl,owner,repo,issueNumber:n,token});
        await mark(pool,'GITHUB_CODING_STALE_RESULT_REARMED',{issueNumber:n,priorObjectiveId:id,codingObjectiveId:rearmObjective.id,dispatchSourceRevision:dispatchSourceRevision||null,sourceRevision:currentSourceRevision||null,staleKey});
        const dispatchReason=spec.ownerDirect?`OWNER_DIRECT>${spec.sourcePriority}`:`PRIORITY_${spec.sourcePriority}`;
        await mark(pool,'GITHUB_CODING_DISPATCHED',{issueNumber:n,issueUrl:spec.url,codingObjectiveId:rearmObjective.id,ownerDirect:spec.ownerDirect,sourcePriority:spec.sourcePriority,dispatchPriority:spec.priority,dispatchReason,sourceRevision:currentSourceRevision||null,materialSignature:codingMaterialSourceSignature(currentIssue),staleKey,priorObjectiveId:id,scopeLease:spec.scopeLease});
        await comment(fetchImpl,owner,repo,n,token,`[STALE_RESULT_REARMED] ${rearmObjective.id} currentSourceRevision=${currentSourceRevision||'unknown'} prior=${id}`);
        retryCreatedThisTick=true;
        results++;
        continue;
      }
      if(!completedResultReported){
        // A merged PR and a completed Coding objective are not full Work Order
        // acceptance. Verify the source's Lifecycle V2 receipts BEFORE closure.
        // A missing receipt must never be manufactured by the reconciler.
        const gate=codingIssueCompletionGate(currentIssue);
        if(!gate.canClose){
          if(!(await objectiveMarkerExists(pool,'GITHUB_CODING_AWAITING_ACCEPTANCE',n,id))){
            await comment(fetchImpl,owner,repo,n,token,`[CODE_COMPLETED_AWAITING_ACCEPTANCE] objective=${id} issue=#${n} coding_source_done=true product_done=false reason=${gate.missing.join(',').slice(0,900)}. Keep GitHub open; complete the canonical issue with real Lifecycle V2 start/finish/checklist receipts and downstream acceptance before closing.`);
            await mark(pool,'GITHUB_CODING_AWAITING_ACCEPTANCE',{issueNumber:n,codingObjectiveId:id,sourceRevision:currentSourceRevision||null,materialSignature:codingMaterialSourceSignature(currentIssue),missing:gate.missing});
            results++;
          }
          continue;
        }
        await comment(fetchImpl,owner,repo,n,token,`[RESULT] ${id} completed with verified source Lifecycle V2. ${String(objective.summary||'').slice(0,3000)}`);
        await close(fetchImpl,owner,repo,n,token);
        await clearTerminalBlockedLabel({fetchImpl,owner,repo,issueNumber:n,token});
        await mark(pool,'GITHUB_CODING_RESULT_REPORTED',{issueNumber:n,codingObjectiveId:id,status:'completed',sourceRevision:currentSourceRevision||null});
        results++;
      }
      continue;
    }

    const finalize=async(reason,evidence={})=>{
      if(await hasEffectiveBlockedFinal(pool,n,objective.summary,id,currentMainSha,currentSourceRevision,relevantMainChanged,codingMaterialSourceSignature(currentIssue)))return false;
      await mark(pool,'GITHUB_CODING_BLOCKED_FINAL',{issueNumber:n,codingObjectiveId:id,status:'blocked',reason,mainSha:currentMainSha||null,sourceRevision:currentSourceRevision||null,materialSignature:codingMaterialSourceSignature(currentIssue),...evidence});
      await addTerminalBlockedLabel({fetchImpl,owner,repo,issueNumber:n,token});
      await mark(pool,'GITHUB_CODING_TERMINAL_LABEL_SYNCED',{issueNumber:n,codingObjectiveId:id});
      await comment(fetchImpl,owner,repo,n,token,`[BLOCKED_FINAL] ${id} reason=${reason}. ${String(objective.summary||'').slice(0,2000)}`);
      results++;
      return true;
    };

    if(issueSuperseded(currentIssue)){
      await finalize('ISSUE_CLOSED_OR_SUPERSEDED',{issueState:String(currentIssue?.state||'unknown')});
      continue;
    }
    const spec=parseCodingIssue(currentIssue);
    if(!spec){
      await finalize('ISSUE_NO_LONGER_EXECUTABLE');
      continue;
    }
    const classification=classifyCodingBlocker(objective.summary);
    if(classification.kind==='HARD'){
      await finalize('HARD_BLOCKER',{terminalReason:classification.reason});
      continue;
    }
    const rearmGate=await dependencyGate(fetchImpl,owner,repo,token,spec.dependsOn);
    if(!rearmGate.ok){
      await recordDependencyWait(pool,fetchImpl,owner,repo,token,{issueNumber:n,objectiveId:id,dependsOn:spec.dependsOn,sourceRevision:currentSourceRevision,stage:'terminal-rearm',gate:rearmGate});
      continue;
    }

    const retryDispatched=await eventData(pool,'GITHUB_CODING_RETRY_DISPATCHED',n);
    // All three safe rearm paths begin a new retry epoch. Otherwise the
    // historic deterministic RETRY_KEY may silently resolve an older objective.
    const recoveryHistory=[
      ...await eventData(pool,'GITHUB_CODING_RECOVERY_REARMED',n),
      ...await eventData(pool,'GITHUB_CODING_STALE_RESULT_REARMED',n),
      ...await eventData(pool,'GITHUB_CODING_COMPLETED_REARMED',n),
    ];
    const retryEpoch=codingRetryEpochState(retryDispatched,recoveryHistory,id);
    // A malformed/cyclic/duplicate retry journal is not a valid recovery signal.
    // Failing only the budget count closed would still enter the recovery branch
    // below when main/source changes, and silently re-dispatch corrupt history.
    if(retryEpoch.reason!=='CURRENT_OBJECTIVE_EPOCH'){
      await finalize('RETRY_HISTORY_INVALID',{terminalReason:retryEpoch.reason});
      continue;
    }
    const retryCount=retryEpoch.retryCount;
    const materialSignature=codingMaterialSourceSignature(currentIssue);
    const effectiveRetryCount=Math.max(retryCount,codingWorkOrderFailureBudget(retryDispatched,classification.reason,materialSignature));
    // A Manager that twice failed to produce any accepted child has no useful
    // same-revision retry. Stop immediately; rearm only after a material
    // canonical source change, without burning F1/F2 or blocking other scopes.
    const noProgressStop=/manager attempt stopped:\s*two decisions without accepted child progress/i.test(String(objective.summary||''));
    const terminalReason=noProgressStop?'NO_PROGRESS_WAIT_MATERIAL_CHANGE':'RETRY_BUDGET_EXHAUSTED';
    if(noProgressStop||effectiveRetryCount>=MAX_AUTO_RETRIES){
      const finals=await eventData(pool,'GITHUB_CODING_BLOCKED_FINAL',n);
      const latestFinal=finals[0]||{issueNumber:n,codingObjectiveId:id,reason:terminalReason,terminalReason:classification.reason,mainSha:currentMainSha,sourceRevision:currentSourceRevision};
      const rearms=await eventData(pool,'GITHUB_CODING_RECOVERY_REARMED',n);
      if(shouldRearmRecoverableFinal(latestFinal,currentMainSha,rearms,currentSourceRevision,relevantMainChanged,materialSignature)){
        if(retryCreatedThisTick)continue;
        const blockedByActiveOwner=await activeCodingOwnerBlocksRetry({pool,status,fetchImpl,owner,repo,token,excludeObjectiveIds:[id],targetScope:spec.scopeLease});
        if(blockedByActiveOwner)continue;
        const sourceKey=(currentSourceRevision||'no-source').replace(/[^0-9A-Za-z]/g,'').slice(-20)||'no-source';
        const recoveryKey=`GITHUB-ISSUE-${n}-RECOVERY-${currentMainSha.slice(0,12)}-${sourceKey}`;
        let recoveryObjective=(status.objectives||[]).find(x=>String(x.objective||'').includes(`RECOVERY_KEY=${recoveryKey}`));
        if(!recoveryObjective){
          const objectiveText=`GitHub autonomous coding recovery after Source of Truth or engine update for issue #${spec.number}: ${spec.title}\n${spec.url}\n\nRECOVERY_KEY=${recoveryKey}\nSOURCE_BASE=${currentMainSha}\nSOURCE_REVISION=${currentSourceRevision||'unknown'}\nPRIOR_OBJECTIVE_ID=${id}\nPRIOR_FAILURE=${classification.reason.slice(0,1000)}\n\n${spec.body}\n\nCurrent main or the canonical source issue changed after the prior retry budget was exhausted. Re-evaluate from current main and the current issue body, continue the same canonical issue, and do not open a duplicate repair issue. Execute only zero-cost reversible repository work. Keep direct main writes, paid cost, credentials/security, destructive actions, production release, browser authentication and PC01 source editing blocked.`;
          const out=await jsonFetch(fetchImpl,`${codingLaneUrl.replace(/\/$/,'')}/api/objectives`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({objective:objectiveText,priority:spec.priority})});
          if(!out?.id)throw new Error('CODING_RECOVERY_OBJECTIVE_ID_MISSING');
          recoveryObjective={id:out.id,objective:objectiveText,status:'queued'};
        }
        await clearTerminalBlockedLabel({fetchImpl,owner,repo,issueNumber:n,token});
        const sourceChanged=Boolean(currentSourceRevision)&&String(latestFinal?.sourceRevision||'').trim()!==String(currentSourceRevision||'').trim();
        await mark(pool,'GITHUB_CODING_RECOVERY_REARMED',{issueNumber:n,priorObjectiveId:id,codingObjectiveId:recoveryObjective.id,mainSha:currentMainSha,priorMainSha:String(latestFinal?.mainSha||'').trim()||null,currentMainSha:currentMainSha||null,sourceRevision:currentSourceRevision||null,sourceChanged,relevantChangedPaths:recoveryEvidence.relevantChangedPaths.slice(0,32),recoveryKey,reason:classification.reason});
        const dispatchReason=spec.ownerDirect?`OWNER_DIRECT>${spec.sourcePriority}`:`PRIORITY_${spec.sourcePriority}`;
        await mark(pool,'GITHUB_CODING_DISPATCHED',{issueNumber:n,issueUrl:spec.url,codingObjectiveId:recoveryObjective.id,ownerDirect:spec.ownerDirect,sourcePriority:spec.sourcePriority,dispatchPriority:spec.priority,dispatchReason,recoveryKey,sourceRevision:currentSourceRevision||null,materialSignature:codingMaterialSourceSignature(currentIssue),priorObjectiveId:id,scopeLease:spec.scopeLease});
        await comment(fetchImpl,owner,repo,n,token,`[RECOVERY_REARMED] ${recoveryObjective.id} source=${currentMainSha.slice(0,12)} prior=${id} reason=${classification.reason.slice(0,500)}`);
        retryCreatedThisTick=true;
        results++;
        continue;
      }
      await finalize(terminalReason,{terminalReason:classification.reason,retries:effectiveRetryCount,materialSignature});
      continue;
    }

    const retryAttempt=effectiveRetryCount+1;
    const recoveryTag=retryEpoch.recovered
      ?`-RECOVERY-${createHash('sha256').update(retryEpoch.epochRootId).digest('hex').slice(0,12)}`:'';
    const retryKey=`GITHUB-ISSUE-${n}${recoveryTag}-RETRY-${retryAttempt}`;
    let retryObjective=(status.objectives||[]).find(x=>String(x.objective||'').includes(`RETRY_KEY=${retryKey}`));
    const otherActiveForIssue=(status.objectives||[]).some(x=>x.id!==id&&x.id!==retryObjective?.id&&!objectiveTerminal(x)&&objectiveMentionsIssue(x,n));
    if(otherActiveForIssue)continue;
    if(!retryObjective){
      const blockedByActiveOwner=await activeCodingOwnerBlocksRetry({pool,status,fetchImpl,owner,repo,token,excludeObjectiveIds:[id],targetScope:spec.scopeLease});
      if(blockedByActiveOwner||retryCreatedThisTick)continue;
    }

    let scheduled=(await eventData(pool,'GITHUB_CODING_RETRY_SCHEDULED',n)).find(x=>
      Number(x.retryAttempt)===retryAttempt&&(x.retryKey===retryKey||(!retryEpoch.recovered&&!x.retryKey)));
    if(!scheduled){
      const delayMs=classification.transient?PROVIDER_RETRY_BASE_MS*(2**(retryAttempt-1)):0;
      const nextAt=new Date(Number(now())+delayMs).toISOString();
      scheduled={issueNumber:n,priorObjectiveId:id,retryAttempt,retryKey,reason:classification.reason,transient:classification.transient,nextAt};
      await mark(pool,'GITHUB_CODING_RETRY_SCHEDULED',scheduled);
      await comment(fetchImpl,owner,repo,n,token,`[RETRY_SCHEDULED] prior=${id} attempt=${retryAttempt}/${MAX_AUTO_RETRIES} nextAt=${nextAt} reason=${classification.reason.slice(0,500)}`);
      results++;
    }
    const nextAtMs=Date.parse(String(scheduled.nextAt||''));
    if(Number.isFinite(nextAtMs)&&Number(now())<nextAtMs)continue;

    if(!retryObjective){
      const objectiveText=`GitHub autonomous coding retry ${retryAttempt}/${MAX_AUTO_RETRIES} for issue #${spec.number}: ${spec.title}\n${spec.url}\n\nRETRY_KEY=${retryKey}\nSOURCE_BASE=CURRENT_MAIN\nSOURCE_REVISION=${currentSourceRevision||'unknown'}\nPRIOR_OBJECTIVE_ID=${id}\nPRIOR_FAILURE=${classification.reason.slice(0,1000)}\n\n${spec.body}\n\nStart from current main HEAD. Reuse the same canonical allowed scope and the existing collision-safe mutation envelope. Do not open a parallel repair issue. Execute only zero-cost reversible repository work. Keep direct main writes, paid cost, credentials/security, destructive actions, production release, browser authentication and PC01 source editing blocked.`;
      const out=await jsonFetch(fetchImpl,`${codingLaneUrl.replace(/\/$/,'')}/api/objectives`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({objective:objectiveText,priority:spec.priority})});
      if(!out?.id)throw new Error('CODING_RETRY_OBJECTIVE_ID_MISSING');
      retryObjective={id:out.id,objective:objectiveText,status:'queued'};
      retryCreatedThisTick=true;
    }

    const alreadyDispatched=(await eventData(pool,'GITHUB_CODING_RETRY_DISPATCHED',n)).some(x=>
      Number(x.retryAttempt)===retryAttempt&&(x.retryKey===retryKey||(!retryEpoch.recovered&&!x.retryKey)));
    if(!alreadyDispatched){
      await clearTerminalBlockedLabel({fetchImpl,owner,repo,issueNumber:n,token});
      const dispatchReason=spec.ownerDirect?`OWNER_DIRECT>${spec.sourcePriority}`:`PRIORITY_${spec.sourcePriority}`;
      await mark(pool,'GITHUB_CODING_RETRY_DISPATCHED',{issueNumber:n,codingObjectiveId:retryObjective.id,priorObjectiveId:id,retryAttempt,retryKey,reason:classification.reason,failureSignature:String(classification.reason||'').trim().replace(/\s+/g,' ').toUpperCase(),materialSignature,sourceRevision:currentSourceRevision||null});
      await mark(pool,'GITHUB_CODING_DISPATCHED',{issueNumber:n,issueUrl:spec.url,codingObjectiveId:retryObjective.id,ownerDirect:spec.ownerDirect,sourcePriority:spec.sourcePriority,dispatchPriority:spec.priority,dispatchReason,retryAttempt,retryKey,sourceRevision:currentSourceRevision||null,materialSignature,priorObjectiveId:id,scopeLease:spec.scopeLease});
      await comment(fetchImpl,owner,repo,n,token,`[RETRY_DISPATCHED] ${retryObjective.id} prior=${id} attempt=${retryAttempt}/${MAX_AUTO_RETRIES} reason=${classification.reason.slice(0,500)}`);
      results++;
    }
  }
  return {progress,results};
}

export async function reconcileGithubCodingEvent({pool,fetchImpl=fetch,owner=DEFAULT_OWNER,repo=DEFAULT_REPO,token='',codingLaneUrl=process.env.TIGERIQ_CODING_LANE_URL||DEFAULT_CODING_URL,issue}){
  if(!pool)throw new Error('GITHUB_CODING_EVENT_POOL_REQUIRED');
  const issueNumber=Number(issue?.number);
  if(!Number.isInteger(issueNumber)||issueNumber<=0)throw new Error('GITHUB_CODING_EVENT_ISSUE_REQUIRED');
  // Event-driven Owner/source changes must reconcile the current dispatched
  // objective before materialization. Otherwise a completed source result that
  // is still awaiting product/Lifecycle acceptance is hidden behind the durable
  // dispatch marker until the five-minute fallback tick.
  const b=await syncGithubCodingOutcomes({pool,fetchImpl,owner,repo,token,codingLaneUrl,issueNumbers:[issueNumber]});
  const a=await materializeGithubCodingIssues({pool,fetchImpl,owner,repo,token,codingLaneUrl,openIssues:[issue]});
  return {...a,progress:b.progress,results:b.results};
}

export function githubCodingEventIssue(payload){
  const issue=githubEventIssue(payload);
  return issue&&parseCodingIssue(issue)?issue:null;
}

export function startGithubCodingIntake({databaseUrl=process.env.DATABASE_URL,fetchImpl=fetch,owner=process.env.TIGERIQ_GITHUB_OWNER||DEFAULT_OWNER,repo=process.env.TIGERIQ_GITHUB_REPO||DEFAULT_REPO,token=process.env.TIGERIQ_GITHUB_TOKEN||process.env.GITHUB_TOKEN||'',codingLaneUrl=process.env.TIGERIQ_CODING_LANE_URL||DEFAULT_CODING_URL,intervalMs=Number(process.env.TIGERIQ_GITHUB_CODING_RECONCILE_MS||process.env.TIGERIQ_GITHUB_RECONCILE_MS||DEFAULT_INTERVAL_MS),initialDelayMs=20000}={}){
  if(!databaseUrl)return {enabled:false,stop(){}};
  const pool=new Pool({connectionString:databaseUrl,max:1});
  const reconcileMs=Math.max(GITHUB_CODING_RECONCILE_INTERVAL_MS,Number(intervalMs)||GITHUB_CODING_RECONCILE_INTERVAL_MS);
  let stopped=false,busy=false,timer=null,interval=null,githubCooldownUntil=0;
  const pendingEvents=[];

  const applyError=(e,kind)=>{
    const delayMs=githubRateLimitCooldownMs(e,Date.now());
    if(delayMs>0){
      githubCooldownUntil=Date.now()+delayMs;
      if(kind==='event')console.warn(JSON.stringify({event:'GITHUB_CODING_EVENT_RATE_LIMIT_COOLDOWN',delayMs,until:new Date(githubCooldownUntil).toISOString(),error:String(e?.message||e)}));
      else console.warn(JSON.stringify({event:'GITHUB_CODING_RATE_LIMIT_COOLDOWN',delayMs,until:new Date(githubCooldownUntil).toISOString(),error:String(e?.message||e)}));
    }else{
      console.error(JSON.stringify({event:kind==='event'?'GITHUB_CODING_EVENT_INTAKE_ERROR':'GITHUB_CODING_INTAKE_ERROR',error:String(e?.message||e)}));
    }
  };

  const processEvent=async(event)=>{
    if(stopped)return;
    const issue=githubCodingEventIssue(event?.payload);
    if(!issue)return;
    if(busy||githubCooldownUntil>Date.now()){pendingEvents.push(event);return}
    busy=true;
    try{
      const a=await reconcileGithubCodingEvent({pool,fetchImpl,owner,repo,token,codingLaneUrl,issue});
      console.log(JSON.stringify({event:'GITHUB_CODING_EVENT_INTAKE_SYNC',deliveryId:event.deliveryId,eventName:event.eventName,issueNumber:Number(issue.number),created:a.created,recovered:a.recovered||0,progress:a.progress||0,results:a.results||0,dependencyBlocked:a.dependencyBlocked||0,scopeBlocked:a.scopeBlocked||0,skipReason:a.skipReason||null}));
    }catch(e){applyError(e,'event')}
    finally{
      busy=false;
      if(pendingEvents.length&&githubCooldownUntil<=Date.now())queueMicrotask(()=>void processEvent(pendingEvents.shift()));
    }
  };

  const unsubscribe=subscribeGithubEvents(event=>{
    const fullName=String(event?.payload?.repository?.full_name||'');
    if(fullName&&fullName!==owner+'/'+repo)return;
    if(githubCodingEventIssue(event?.payload))void processEvent(event);
  });

  const tick=async()=>{
    if(stopped||busy)return;
    if(githubCooldownUntil>Date.now())return;
    busy=true;
    try{
      const b=await syncGithubCodingOutcomes({pool,fetchImpl,owner,repo,token,codingLaneUrl,yieldIf:()=>pendingEvents.length>0});
      if(pendingEvents.length){
        console.log(JSON.stringify({event:'GITHUB_CODING_INTAKE_YIELD_PENDING_EVENT',pendingEvents:pendingEvents.length,progress:b.progress,results:b.results}));
        return;
      }
      const a=await materializeGithubCodingIssues({pool,fetchImpl,owner,repo,token,codingLaneUrl});
      console.log(JSON.stringify({event:'GITHUB_CODING_INTAKE_SYNC',created:a.created,recovered:a.recovered||0,progress:b.progress,results:b.results,openIssues:a.openIssues||0,codingEligible:a.codingEligible||0,dependencyBlocked:a.dependencyBlocked||0,scopeBlocked:a.scopeBlocked||0,terminalOrDispatched:a.terminalOrDispatched||0,activeSlots:a.activeSlots||0,freeSlots:a.freeSlots||0,skipReason:a.skipReason||null,skipReasons:a.skipReasons||[]}));
    }catch(e){applyError(e,'fallback')}
    finally{
      busy=false;
      if(pendingEvents.length&&githubCooldownUntil<=Date.now())queueMicrotask(()=>void processEvent(pendingEvents.shift()));
    }
  };
  timer=setTimeout(()=>{void tick();interval=setInterval(()=>void tick(),reconcileMs);interval.unref?.()},Math.max(1000,initialDelayMs));timer.unref?.();
  return {enabled:true,reconcileMs,async stop(){stopped=true;unsubscribe();if(timer)clearTimeout(timer);if(interval)clearInterval(interval);await pool.end()}};
}
