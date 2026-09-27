import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { applyChatMutationOwnerHandoff, backlogOwnerDirect, bodyValue as policyBodyValue, chatMutationOwnerPlan, isOwnerOnlyP0, routingFault, sortBacklogSpecs } from './github-backlog-policy.mjs';
import { activeRoleClaim, classifyWorkOrder } from './work-routing-policy.mjs';
import { appendPublicEvidenceToSummary, parsePublicEvidenceKeys } from './public-evidence.mjs';
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

export function hasExactFlag(body,key,value='true'){
  return new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}=${value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}$`,'m').test(String(body||''));
}

export function bodyValue(body,key){return policyBodyValue(body,key);}

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

const PC_OPERATOR_DIRECT_READ_ONLY_ACTIONS=new Set(['task_status','process_list','tcp_probe','file_read','file_list','file_stat']);
const PC_OPERATOR_DIRECT_MUTATING_ACTIONS=new Set(['task_start','task_stop']);

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
  if(isBoundedAppChromeRequestOnly(b))return false;
  return /\[APP-CHROME\]/i.test(t)
    || /^RESOURCE_SCOPE=APP_CHROME_/mi.test(b)
    || /^ALLOW_PATH_PREFIX=apps\/chrome-controller(?:\/|$)/mi.test(b)
    || /apps\/chrome-controller\//i.test(b);
}

export function parseExecutableIssue(issue){
  if(!issue||issue.pull_request||issue.state!=='open')return null;
  const body=String(issue.body||'');
  const title=String(issue.title||'');
  if(chatMutationOwnerPlan(body,title).owner==='VY')return null;
  if(isOwnerOnlyP0(body,title))return null;
  if(!hasExactFlag(body,'TIGERIQ_EXECUTABLE')||!hasExactFlag(body,'OWNER_POLICY','AUTO'))return null;
  if(!hasExactFlag(body,'NO_CODE_CHANGE')||!hasExactFlag(body,'NO_PC01_SHELL'))return null;
  if(isManualOnlyAppChromeMaintenance(issue.title,body))return null;
  const classification=classifyWorkOrder(body);
  if(['HOLD_OWNER','UI','CODING'].includes(classification.route))return null;
  const capability=classification.route==='OPENCLAW'?'pc_operator':classification.capability;
  const resourceScope=bodyValue(body,'RESOURCE_SCOPE');
  if(classification.route==='OPENCLAW'&&(!resourceScope||!extractPcOperatorInstruction(body)))return null;
  const sourceRevision=createHash('sha256').update(title).update('\n').update(body).update('\n').update(String(issue.state_reason||'')).digest('hex').slice(0,12);
  const dispatchLane=classification.route==='OPENCLAW'?'PC_OPERATOR':classification.route;
  const directAction=parsePcOperatorDirectAction(body,backlogOwnerDirect(body));
  if(directAction.present&&!directAction.valid)return null;
  return {
    number:Number(issue.number),title,body,priority:classification.priority,sourcePriority:classification.sourcePriority,
    legacyP0Autonomous:classification.legacyP0Autonomous,ownerControlled:classification.ownerControlled,
    capability,dispatchLane,resourceScope,preferredWorker:classification.preferredEmployee||'',targetWorker:classification.workerId||null,
    url:String(issue.html_url||''),ownerDirect:backlogOwnerDirect(body),sourceRevision,updatedAt:String(issue.updated_at||''),
    commentCount:Math.max(0,Number(issue.comments||0)),route:classification.route,publicEvidenceKeys:parsePublicEvidenceKeys(body),publicEvidenceDiagnostic:hasExactFlag(body,'PUBLIC_EVIDENCE_DIAGNOSTIC'),
    pcOperatorDirectAction:directAction.action||null,
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
  await pool.query("insert into tigeriq_events(type,data) values('ROUTING_FAULT',$1)",[JSON.stringify(data)]).catch(()=>{});
}
export async function materializeGithubIssues({pool,fetchImpl=fetch,owner=DEFAULT_OWNER,repo=DEFAULT_REPO,token='',openIssues=null}){
  const cleanup=await cleanupTerminalObjectiveJobs({pool});
  const rows=Array.isArray(openIssues)?openIssues:await ghJson(fetchImpl,`https://api.github.com/repos/${owner}/${repo}/issues?state=open&per_page=100&sort=updated&direction=desc`,token);
  const specs=sortBacklogSpecs(rows.map(parseExecutableIssue).filter(Boolean));
  const activeRows=(await pool.query("select metadata from tigeriq_objectives where metadata->>'source'='github' and status='active'")).rows||[];
  const activeMetadata=activeRows.map((row)=>row?.metadata||{});
  let skipped=0,externalClaims=0;
  for(const spec of specs){
    if(githubSpecBlockedByActive(spec,activeMetadata)){skipped++;continue;}
    const prior=(await pool.query("select id,status,metadata from tigeriq_objectives where metadata->>'source'='github' and metadata->>'issueNumber'=$1 order by created_at desc limit 1",[String(spec.number)])).rows[0]||null;
    if(prior?.status==='active'){skipped++;continue;}
    const sourceChanged=Boolean(prior&&String(prior.metadata?.sourceRevision||'')!==spec.sourceRevision);
    const reopenedAfterCompletion=Boolean(prior?.metadata?.githubClosed===true);
    if(prior&&!sourceChanged&&!reopenedAfterCompletion){skipped++;continue;}
    const externalClaim=await readActiveExternalRoleClaim(fetchImpl,owner,repo,token,spec);
    if(externalClaim){externalClaims++;skipped++;continue;}
    const id=prior?`OBJ-GH-${spec.number}-R${rearmKey(spec)}`:`OBJ-GH-${spec.number}`;
    const exists=(await pool.query('select 1 from tigeriq_objectives where id=$1',[id])).rowCount>0;
    if(exists){skipped++;continue;}
    const context=await hydrateContext(fetchImpl,owner,repo,spec,token);
    const objective=spec.capability==='pc_operator'
      ? (spec.pcOperatorDirectAction
          ? `GitHub bounded PC operator work item #${spec.number}. Core must execute only the pre-admitted typed local action from PC_OPERATOR_DIRECT_ACTION_JSON. Do not invoke model reasoning or infer any different action. NO arbitrary shell, repository source edit, Production/main mutation, paid action, credential/security change, reboot/shutdown, or destructive action. Return structured verified evidence and complete only when that exact action is satisfied.\n\n${context}`
          : `GitHub bounded PC operator work item #${spec.number}. Core must dispatch only the assigned pc_operator action through NV06/OpenClaw. Use approved bounded TigerIQ/OpenClaw tools; NO arbitrary PC01 shell, repository source edit, Production/main mutation, paid action, credential/security change, reboot/shutdown, or destructive action. Return structured verified evidence and complete only when the assigned bounded action is satisfied.\n\n${context}`)
      : `GitHub autonomous ${spec.dispatchLane} work item #${spec.number}. Execute only the read-only task below. Do not edit repository source, use PC01 shell, deploy, change credentials/security, spend money, reboot, or perform destructive actions. Ground conclusions only in supplied GitHub context.\n\n${context}`;
    const metadata={
      source:'github',issueNumber:spec.number,issueUrl:spec.url,capability:spec.capability,dispatchLane:spec.dispatchLane,resourceScope:spec.resourceScope||null,
      ownerDirect:spec.ownerDirect,ownerControlled:spec.ownerControlled,sourcePriority:spec.sourcePriority,legacyP0Autonomous:spec.legacyP0Autonomous,
      targetWorker:spec.targetWorker||null,sourceRevision:spec.sourceRevision,sourceUpdatedAt:spec.updatedAt,rearmedFromObjectiveId:prior?.id||null,
      dispatchReason:`PRIORITY_${spec.priority}`,executionSurface:spec.capability==='pc_operator'?(spec.pcOperatorDirectAction?'PC_OPERATOR_DIRECT_LOCAL':'CORE_OPENCLAW_BOUNDED'):'READ_ONLY',publicEvidenceKeys:spec.publicEvidenceKeys||[],publicEvidenceDiagnostic:spec.publicEvidenceDiagnostic===true,
      pcOperatorDirectAction:spec.pcOperatorDirectAction||null
    };
    await pool.query('insert into tigeriq_objectives(id,objective,priority,metadata) values($1,$2,$3,$4) on conflict(id) do nothing',[id,objective,spec.priority,JSON.stringify(metadata)]);
    if(spec.capability==='pc_operator'){
      const assigned=extractPcOperatorInstruction(spec.body);
      const jobId=githubPcOperatorJobId(id,spec.number);
      const prompt=spec.pcOperatorDirectAction
        ? `Execute ONLY the pre-admitted typed local PC action. Do not invoke model reasoning, select backlog/P0/new work, or infer a different action.\n\nASSIGNED ACTION:\n${assigned}`
        : `Execute ONLY this bounded PC action through NV06/OpenClaw. Do not choose backlog, P0, or new work. Use approved tigeriq_pc/tigeriq_runtime tools only.\n\nASSIGNED ACTION:\n${assigned}`;
      await pool.query("insert into tigeriq_jobs(id,objective_id,title,prompt,capability,kind,status,max_attempts) values($1,$2,$3,$4,'pc_operator','pc_operator','queued',2) on conflict(id) do nothing",[jobId,id,`GitHub #${spec.number} bounded PC operator`,prompt]);
      await pool.query("insert into tigeriq_events(type,objective_id,job_id,task_kind,data) values('GITHUB_PC_OPERATOR_JOB_MATERIALIZED',$1,$2,'pc_operator',$3)",[id,jobId,JSON.stringify({issueNumber:spec.number,executionSurface:'CORE_OPENCLAW_BOUNDED'})]);
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
  let claims=0,results=0;
  for(const row of rows){
    const number=Number(row.metadata?.issueNumber); if(!number) continue;
    if(issueFilter&&!issueFilter.has(number))continue;
    if(row.status==='active'){
      try{
        const sourceIssue=await resolveGithubSourceIssue(fetchImpl,owner,repo,token,number,openIssueIndex);
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
    if(['completed','blocked'].includes(row.status)&&!row.metadata?.githubResultReported){
      await commentIssue(fetchImpl,owner,repo,number,formatResultComment(row),token);
      if(row.status==='completed'){
        // Close first so a failed clear cannot expose a completed OPEN issue as QUEUED.
        await closeIssue(fetchImpl,owner,repo,number,token);
        await clearTerminalBlockedLabel({fetchImpl,owner,repo,issueNumber:number,token});
      }
      await pool.query("update tigeriq_objectives set metadata=metadata||$2::jsonb,updated_at=now() where id=$1",[row.id,JSON.stringify({githubResultReported:true,githubClosed:row.status==='completed'})]);
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
      const a=await materializeGithubIssues({pool,fetchImpl,owner,repo,token,openIssues:issues});
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
      const a=await materializeGithubIssues({pool,fetchImpl,owner,repo,token,openIssues:stableIssues});
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
