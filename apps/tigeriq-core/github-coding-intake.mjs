import {Pool} from 'pg';
import {backlogOwnerDirect,sortBacklogSpecs} from './github-backlog-policy.mjs';
const DEFAULT_OWNER='newsdayads';
const DEFAULT_REPO='tigeriq-ai-lab';
const DEFAULT_CODING_URL='http://100.97.23.87:8797';
const DEFAULT_INTERVAL_MS=120000;
const DEFAULT_CONCURRENCY_CAP=3;
const MAX_AUTO_RETRIES=2;
const PROVIDER_RETRY_BASE_MS=60000;

function exactFlag(body,key,value='true'){
  return new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}=${value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}$`,'m').test(String(body||''));
}

export function extractCodingDependencies(body){
  const raw=String(body||'').match(/^DEPENDS_ON=(.+)$/m)?.[1]||'';
  const values=(raw.match(/#?\d+/g)||[]).map(x=>Number(x.replace(/^#/,''))).filter(n=>Number.isInteger(n)&&n>0);
  return [...new Set(values)].slice(0,16);
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
  const required=[['TIGERIQ_EXECUTABLE','true'],['OWNER_POLICY','AUTO'],['AUTONOMOUS_CODE','true'],['ZERO_COST','true'],['NO_PC01_SHELL','true'],['NO_PAID_COST','true'],['NO_CREDENTIAL_CHANGE','true'],['NO_DESTRUCTIVE','true'],['NO_PRODUCTION_RELEASE','true'],['NO_BROWSER_AUTH','true'],['NO_DIRECT_MAIN','true']];
  if(required.some(([k,v])=>!exactFlag(body,k,v)))return null;
  const sourcePriority=body.match(/^PRIORITY=(P[0-3])$/m)?.[1]||'P1';
  const priority=sourcePriority==='P3'?'P2':sourcePriority;
  return {number:Number(issue.number),title:String(issue.title||''),body,priority,sourcePriority,url:String(issue.html_url||''),dependsOn:extractCodingDependencies(body),ownerDirect:backlogOwnerDirect(body),scopeLease:parseCodingScope(body)};
}

async function jsonFetch(fetchImpl,url,init={}){const res=await fetchImpl(url,{...init,signal:AbortSignal.timeout(12000)});const text=await res.text();let body={};try{body=text?JSON.parse(text):{}}catch{body={text}}if(!res.ok)throw new Error(`HTTP_${res.status}:${String(body?.error||body?.message||text).slice(0,300)}`);return body}
async function gh(fetchImpl,owner,repo,path,token,init={}){const headers={accept:'application/vnd.github+json','content-type':'application/json','user-agent':'TigerIQ-Coding-Intake/1.0','x-github-api-version':'2022-11-28',...(init.headers||{})};if(token)headers.authorization=`Bearer ${token}`;return jsonFetch(fetchImpl,`https://api.github.com/repos/${owner}/${repo}${path}`,{...init,headers})}
async function comment(fetchImpl,owner,repo,n,token,body){if(token)await gh(fetchImpl,owner,repo,`/issues/${n}/comments`,token,{method:'POST',body:JSON.stringify({body})})}
async function close(fetchImpl,owner,repo,n,token){if(token)await gh(fetchImpl,owner,repo,`/issues/${n}`,token,{method:'PATCH',body:JSON.stringify({state:'closed',state_reason:'completed'})})}
async function markerExists(pool,type,n){const q=await pool.query("select 1 from tigeriq_events where type=$1 and data->>'issueNumber'=$2 limit 1",[type,String(n)]);return q.rowCount>0}
async function eventData(pool,type,n){const q=await pool.query("select data from tigeriq_events where type=$1 and data->>'issueNumber'=$2 order by seq desc limit 100",[type,String(n)]);return q.rows.map(row=>row.data||{})}
async function mark(pool,type,data){await pool.query('insert into tigeriq_events(type,data) values($1,$2)',[type,JSON.stringify(data)])}
async function hasCompletedCodingResult(pool,n){return (await eventData(pool,'GITHUB_CODING_RESULT_REPORTED',n)).some(x=>String(x.status||'').toLowerCase()==='completed')}
async function hasEffectiveBlockedFinal(pool,n,fallbackSummary='',currentObjectiveId=null,currentMainSha=''){
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
  if(shouldRearmRecoverableFinal({...latest,terminalReason:terminalSummary},currentMainSha,rearms))return false;
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
export function shouldRearmRecoverableFinal(final,currentMainSha,rearms=[]){
  const mainSha=String(currentMainSha||'').trim();
  const finalReason=String(final?.reason||'').toUpperCase();
  if(!mainSha||!['RETRY_BUDGET_EXHAUSTED','HARD_BLOCKER'].includes(finalReason))return false;
  const terminalReason=String(final?.terminalReason||'');
  if(classifyCodingBlocker(terminalReason).kind!=='RECOVERABLE')return false;
  if(String(final?.mainSha||'').trim()===mainSha)return false;
  const priorObjectiveId=String(final?.codingObjectiveId||'');
  return !(rearms||[]).some(x=>String(x?.mainSha||'').trim()===mainSha&&String(x?.priorObjectiveId||'')===priorObjectiveId);
}
function issueSuperseded(issue){
  if(!issue||issue.state!=='open')return true;
  const body=String(issue.body||'');
  return /^(?:STATE=(?:SUPERSEDED|CANCELLED)|SUPERSEDED(?:_BY)?=|TIGERIQ_EXECUTABLE=false)$/mi.test(body);
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
    try{sourceIssue=await gh(fetchImpl,owner,repo,`/issues/${sourceIssueNumber}`,token)}catch{return true}
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
    }catch{
      // Fail closed: if source truth cannot be verified, keep the lease active.
    }
    active.push({issueNumber:n,codingObjectiveId:objectiveId,scopeLease:data.scopeLease||{resourceScope:'',paths:[],ambiguous:true}});
  }
  return active;
}

async function dependencyGate(fetchImpl,owner,repo,token,dependsOn){
  for(const depNum of dependsOn){
    let depIssue;
    try{depIssue=await gh(fetchImpl,owner,repo,`/issues/${depNum}`,token)}catch(error){return {ok:false,reason:'DEPENDENCY_LOOKUP_FAILED',dependency:depNum,error:String(error?.message||error)}}
    if(!depIssue||depIssue.pull_request||depIssue.state!=='closed')return {ok:false,reason:'DEPENDENCY_OPEN',dependency:depNum,state:String(depIssue?.state||'unknown')};
  }
  return {ok:true};
}

export async function materializeGithubCodingIssues({pool,fetchImpl=fetch,owner=DEFAULT_OWNER,repo=DEFAULT_REPO,token='',codingLaneUrl=process.env.TIGERIQ_CODING_LANE_URL||DEFAULT_CODING_URL,concurrencyCap=Number(process.env.TIGERIQ_GITHUB_CODING_CONCURRENCY||DEFAULT_CONCURRENCY_CAP)}){
  const cap=Math.max(1,Math.min(8,Number.isFinite(Number(concurrencyCap))?Math.floor(Number(concurrencyCap)):DEFAULT_CONCURRENCY_CAP));
  const issues=await gh(fetchImpl,owner,repo,'/issues?state=open&per_page=100&sort=updated&direction=desc',token);
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
    if(await markerExists(pool,'GITHUB_CODING_DISPATCHED',spec.number)){
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
    const dispatchKey=`GITHUB-ISSUE-${spec.number}`;
    const objective=`GitHub autonomous coding issue #${spec.number}: ${spec.title}\n${spec.url}\n\nDISPATCH_KEY=${dispatchKey}\n\n${spec.body}\n\nExecute only zero-cost reversible repository work. Keep direct main writes, paid cost, credentials/security, destructive actions, production release, browser authentication and PC01 source editing blocked.`;
    let out=(laneStatus?.objectives||[]).find(x=>String(x?.objective||'').includes(`DISPATCH_KEY=${dispatchKey}`));
    let recoveredExisting=false;
    if(out?.id){recoveredExisting=true}
    else{
      out=await jsonFetch(fetchImpl,`${codingLaneUrl.replace(/\/$/,'')}/api/objectives`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({objective,priority:spec.priority})});
      if(!out?.id)throw new Error('CODING_OBJECTIVE_ID_MISSING');
      laneStatus={...(laneStatus||{}),objectives:[...(laneStatus?.objectives||[]),{id:out.id,objective,status:'queued'}]};
    }
    const dispatchReason=spec.ownerDirect?`OWNER_DIRECT>${spec.sourcePriority}`:`PRIORITY_${spec.sourcePriority}`;
    await mark(pool,'GITHUB_CODING_DISPATCHED',{issueNumber:spec.number,issueUrl:spec.url,codingObjectiveId:out.id,ownerDirect:spec.ownerDirect,sourcePriority:spec.sourcePriority,dispatchPriority:spec.priority,dispatchReason,scopeLease:spec.scopeLease,dispatchKey,recoveredExisting});
    await comment(fetchImpl,owner,repo,spec.number,token,recoveredExisting?`[CLAIM_RECOVERED] TigerIQ Coding Lane already had this issue as ${out.id}; durable dispatch state was restored. Dispatch: ${dispatchReason}.`:`[CLAIM] TigerIQ Coding Lane accepted this issue as ${out.id}. Automatic coding pipeline is active. Dispatch: ${dispatchReason}.`);
    activeScopes.push(spec.scopeLease);
    if(recoveredExisting)recovered++;else created++;
  }
  counters.activeSlots=active.length+created+recovered;
  counters.freeSlots=Math.max(0,cap-counters.activeSlots);
  return {created,recovered,active:active.length,considered:specs.length,...counters,skipReason:counters.freeSlots===0?'CAPACITY_FULL':null};
}

export async function syncGithubCodingOutcomes({pool,fetchImpl=fetch,owner=DEFAULT_OWNER,repo=DEFAULT_REPO,token='',codingLaneUrl=process.env.TIGERIQ_CODING_LANE_URL||DEFAULT_CODING_URL,now=()=>Date.now()}){
  const rows=(await pool.query("select distinct on ((data->>'issueNumber')::int) data from tigeriq_events where type='GITHUB_CODING_DISPATCHED' and data ? 'issueNumber' order by ((data->>'issueNumber')::int), seq desc")).rows;
  if(!rows.length)return {progress:0,results:0};
  const status=await jsonFetch(fetchImpl,`${codingLaneUrl.replace(/\/$/,'')}/api/status`);
  let currentMainSha='';
  try{currentMainSha=String((await gh(fetchImpl,owner,repo,'/git/ref/heads/main',token))?.object?.sha||'').trim()}catch{}
  let progress=0,results=0;
  const seenIssues=new Set();
  let retryCreatedThisTick=false;
  for(const row of rows){
    const n=Number(row.data?.issueNumber),id=String(row.data?.codingObjectiveId||'');
    if(!n||!id||seenIssues.has(n))continue;
    seenIssues.add(n);
    const objective=(status.objectives||[]).find(x=>x.id===id);
    if(await hasCompletedCodingResult(pool,n)||await hasEffectiveBlockedFinal(pool,n,objective?.summary,id,currentMainSha))continue;
    if(!objective)continue;
    const job=(status.jobs||[]).find(x=>x.objective_id===id);
    if(job&&!(await markerExists(pool,'GITHUB_CODING_PROGRESS_REPORTED',n))){
      const pr=job.pr_number?` PR #${job.pr_number}.`:'';
      await comment(fetchImpl,owner,repo,n,token,`[PROGRESS] ${id} is ${job.status}. Implementer: ${job.employee_id||'pending'}; reviewer: ${job.reviewer_employee_id||'pending'}.${pr}`);
      await mark(pool,'GITHUB_CODING_PROGRESS_REPORTED',{issueNumber:n,codingObjectiveId:id,jobId:job.id,prNumber:job.pr_number||null});
      progress++;
    }
    if(!objectiveTerminal(objective))continue;
    if(String(objective.status).toLowerCase()==='completed'){
      if(!(await hasCompletedCodingResult(pool,n))){
        await comment(fetchImpl,owner,repo,n,token,`[RESULT] ${id} completed. ${String(objective.summary||'').slice(0,3000)}`);
        await close(fetchImpl,owner,repo,n,token);
        await mark(pool,'GITHUB_CODING_RESULT_REPORTED',{issueNumber:n,codingObjectiveId:id,status:'completed'});
        results++;
      }
      continue;
    }

    let currentIssue;
    try{currentIssue=await gh(fetchImpl,owner,repo,`/issues/${n}`,token)}catch(error){
      console.warn(JSON.stringify({event:'GITHUB_CODING_RETRY_RECONCILE_WAIT',issueNumber:n,codingObjectiveId:id,error:String(error?.message||error)}));
      continue;
    }
    const finalize=async(reason,evidence={})=>{
      if(await hasEffectiveBlockedFinal(pool,n,objective.summary,id,currentMainSha))return false;
      await mark(pool,'GITHUB_CODING_BLOCKED_FINAL',{issueNumber:n,codingObjectiveId:id,status:'blocked',reason,mainSha:currentMainSha||null,...evidence});
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

    const retryDispatched=await eventData(pool,'GITHUB_CODING_RETRY_DISPATCHED',n);
    const retryCount=retryDispatched.length;
    if(retryCount>=MAX_AUTO_RETRIES){
      const finals=await eventData(pool,'GITHUB_CODING_BLOCKED_FINAL',n);
      const latestFinal=finals[0]||{issueNumber:n,codingObjectiveId:id,reason:'RETRY_BUDGET_EXHAUSTED',terminalReason:classification.reason,mainSha:currentMainSha};
      const rearms=await eventData(pool,'GITHUB_CODING_RECOVERY_REARMED',n);
      if(shouldRearmRecoverableFinal(latestFinal,currentMainSha,rearms)){
        if(retryCreatedThisTick)continue;
        const blockedByActiveOwner=await activeCodingOwnerBlocksRetry({pool,status,fetchImpl,owner,repo,token,excludeObjectiveIds:[id],targetScope:spec.scopeLease});
        if(blockedByActiveOwner)continue;
        const recoveryKey=`GITHUB-ISSUE-${n}-RECOVERY-${currentMainSha.slice(0,12)}`;
        let recoveryObjective=(status.objectives||[]).find(x=>String(x.objective||'').includes(`RECOVERY_KEY=${recoveryKey}`));
        if(!recoveryObjective){
          const objectiveText=`GitHub autonomous coding recovery after engine update for issue #${spec.number}: ${spec.title}\n${spec.url}\n\nRECOVERY_KEY=${recoveryKey}\nSOURCE_BASE=${currentMainSha}\nPRIOR_OBJECTIVE_ID=${id}\nPRIOR_FAILURE=${classification.reason.slice(0,1000)}\n\n${spec.body}\n\nThe coding engine changed after the prior retry budget was exhausted. Re-evaluate from the current main head and continue the same canonical issue without opening a duplicate repair issue. Execute only zero-cost reversible repository work. Keep direct main writes, paid cost, credentials/security, destructive actions, production release, browser authentication and PC01 source editing blocked.`;
          const out=await jsonFetch(fetchImpl,`${codingLaneUrl.replace(/\/$/,'')}/api/objectives`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({objective:objectiveText,priority:spec.priority})});
          if(!out?.id)throw new Error('CODING_RECOVERY_OBJECTIVE_ID_MISSING');
          recoveryObjective={id:out.id,objective:objectiveText,status:'queued'};
        }
        await mark(pool,'GITHUB_CODING_RECOVERY_REARMED',{issueNumber:n,priorObjectiveId:id,codingObjectiveId:recoveryObjective.id,mainSha:currentMainSha,recoveryKey,reason:classification.reason});
        const dispatchReason=spec.ownerDirect?`OWNER_DIRECT>${spec.sourcePriority}`:`PRIORITY_${spec.sourcePriority}`;
        await mark(pool,'GITHUB_CODING_DISPATCHED',{issueNumber:n,issueUrl:spec.url,codingObjectiveId:recoveryObjective.id,ownerDirect:spec.ownerDirect,sourcePriority:spec.sourcePriority,dispatchPriority:spec.priority,dispatchReason,recoveryKey,priorObjectiveId:id,scopeLease:spec.scopeLease});
        await comment(fetchImpl,owner,repo,n,token,`[RECOVERY_REARMED] ${recoveryObjective.id} source=${currentMainSha.slice(0,12)} prior=${id} reason=${classification.reason.slice(0,500)}`);
        retryCreatedThisTick=true;
        results++;
        continue;
      }
      await finalize('RETRY_BUDGET_EXHAUSTED',{terminalReason:classification.reason,retries:retryCount});
      continue;
    }

    const retryAttempt=retryCount+1;
    const retryKey=`GITHUB-ISSUE-${n}-RETRY-${retryAttempt}`;
    let retryObjective=(status.objectives||[]).find(x=>String(x.objective||'').includes(`RETRY_KEY=${retryKey}`));
    const otherActiveForIssue=(status.objectives||[]).some(x=>x.id!==id&&x.id!==retryObjective?.id&&!objectiveTerminal(x)&&objectiveMentionsIssue(x,n));
    if(otherActiveForIssue)continue;
    if(!retryObjective){
      const blockedByActiveOwner=await activeCodingOwnerBlocksRetry({pool,status,fetchImpl,owner,repo,token,excludeObjectiveIds:[id],targetScope:spec.scopeLease});
      if(blockedByActiveOwner||retryCreatedThisTick)continue;
    }

    let scheduled=(await eventData(pool,'GITHUB_CODING_RETRY_SCHEDULED',n)).find(x=>Number(x.retryAttempt)===retryAttempt);
    if(!scheduled){
      const delayMs=classification.transient?PROVIDER_RETRY_BASE_MS*(2**(retryAttempt-1)):0;
      const nextAt=new Date(Number(now())+delayMs).toISOString();
      scheduled={issueNumber:n,priorObjectiveId:id,retryAttempt,reason:classification.reason,transient:classification.transient,nextAt};
      await mark(pool,'GITHUB_CODING_RETRY_SCHEDULED',scheduled);
      await comment(fetchImpl,owner,repo,n,token,`[RETRY_SCHEDULED] prior=${id} attempt=${retryAttempt}/${MAX_AUTO_RETRIES} nextAt=${nextAt} reason=${classification.reason.slice(0,500)}`);
      results++;
    }
    const nextAtMs=Date.parse(String(scheduled.nextAt||''));
    if(Number.isFinite(nextAtMs)&&Number(now())<nextAtMs)continue;

    if(!retryObjective){
      const objectiveText=`GitHub autonomous coding retry ${retryAttempt}/${MAX_AUTO_RETRIES} for issue #${spec.number}: ${spec.title}\n${spec.url}\n\nRETRY_KEY=${retryKey}\nSOURCE_BASE=CURRENT_MAIN\nPRIOR_OBJECTIVE_ID=${id}\nPRIOR_FAILURE=${classification.reason.slice(0,1000)}\n\n${spec.body}\n\nStart from current main HEAD. Reuse the same canonical allowed scope and the existing collision-safe mutation envelope. Do not open a parallel repair issue. Execute only zero-cost reversible repository work. Keep direct main writes, paid cost, credentials/security, destructive actions, production release, browser authentication and PC01 source editing blocked.`;
      const out=await jsonFetch(fetchImpl,`${codingLaneUrl.replace(/\/$/,'')}/api/objectives`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({objective:objectiveText,priority:spec.priority})});
      if(!out?.id)throw new Error('CODING_RETRY_OBJECTIVE_ID_MISSING');
      retryObjective={id:out.id,objective:objectiveText,status:'queued'};
      retryCreatedThisTick=true;
    }

    const alreadyDispatched=(await eventData(pool,'GITHUB_CODING_RETRY_DISPATCHED',n)).some(x=>Number(x.retryAttempt)===retryAttempt);
    if(!alreadyDispatched){
      const dispatchReason=spec.ownerDirect?`OWNER_DIRECT>${spec.sourcePriority}`:`PRIORITY_${spec.sourcePriority}`;
      await mark(pool,'GITHUB_CODING_RETRY_DISPATCHED',{issueNumber:n,codingObjectiveId:retryObjective.id,priorObjectiveId:id,retryAttempt,retryKey,reason:classification.reason});
      await mark(pool,'GITHUB_CODING_DISPATCHED',{issueNumber:n,issueUrl:spec.url,codingObjectiveId:retryObjective.id,ownerDirect:spec.ownerDirect,sourcePriority:spec.sourcePriority,dispatchPriority:spec.priority,dispatchReason,retryAttempt,retryKey,priorObjectiveId:id});
      await comment(fetchImpl,owner,repo,n,token,`[RETRY_DISPATCHED] ${retryObjective.id} prior=${id} attempt=${retryAttempt}/${MAX_AUTO_RETRIES} reason=${classification.reason.slice(0,500)}`);
      results++;
    }
  }
  return {progress,results};
}

export function startGithubCodingIntake({databaseUrl=process.env.DATABASE_URL,fetchImpl=fetch,owner=process.env.TIGERIQ_GITHUB_OWNER||DEFAULT_OWNER,repo=process.env.TIGERIQ_GITHUB_REPO||DEFAULT_REPO,token=process.env.TIGERIQ_GITHUB_TOKEN||process.env.GITHUB_TOKEN||'',codingLaneUrl=process.env.TIGERIQ_CODING_LANE_URL||DEFAULT_CODING_URL,intervalMs=Number(process.env.TIGERIQ_GITHUB_INTAKE_MS||DEFAULT_INTERVAL_MS),initialDelayMs=20000}={}){
  if(!databaseUrl)return {enabled:false,stop(){}};const pool=new Pool({connectionString:databaseUrl,max:1});let stopped=false,busy=false,timer=null,interval=null;const tick=async()=>{if(stopped||busy)return;busy=true;try{const b=await syncGithubCodingOutcomes({pool,fetchImpl,owner,repo,token,codingLaneUrl});const a=await materializeGithubCodingIssues({pool,fetchImpl,owner,repo,token,codingLaneUrl});console.log(JSON.stringify({event:'GITHUB_CODING_INTAKE_SYNC',created:a.created,recovered:a.recovered||0,progress:b.progress,results:b.results,openIssues:a.openIssues||0,codingEligible:a.codingEligible||0,dependencyBlocked:a.dependencyBlocked||0,scopeBlocked:a.scopeBlocked||0,terminalOrDispatched:a.terminalOrDispatched||0,activeSlots:a.activeSlots||0,freeSlots:a.freeSlots||0,skipReason:a.skipReason||null,skipReasons:a.skipReasons||[]}))}catch(e){console.error(JSON.stringify({event:'GITHUB_CODING_INTAKE_ERROR',error:String(e?.message||e)}))}finally{busy=false}};timer=setTimeout(()=>{void tick();interval=setInterval(()=>void tick(),Math.max(60000,intervalMs));interval.unref?.()},Math.max(1000,initialDelayMs));timer.unref?.();return {enabled:true,async stop(){stopped=true;if(timer)clearTimeout(timer);if(interval)clearInterval(interval);await pool.end()}};
}
