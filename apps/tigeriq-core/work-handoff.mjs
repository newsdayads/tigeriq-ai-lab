import { createHash } from 'node:crypto';
import { localizeOwnerFacingText, ownerStatusIcon, ownerStatusVectorIcon, ownerStatusLabel, verifiedOwnerProgress } from './owner-facing-vietnamese.mjs';
import { isAppChromeLocalOnlyPath, isProtectedControlPlanePath } from '../shared/control-plane-lock.mjs';

const CAPABILITIES=new Set(['general','reasoning','review']);
const CODING_PREFIX=/^\s*\[(?:CODING|SOURCE_MUTATION|SOURCE)\]\s*/i;

function hash(value){return createHash('sha256').update(String(value||'')).digest('hex');}
function clip(value,max){return String(value||'').trim().slice(0,max);}
function taggedLine(prompt,label){
  const match=String(prompt||'').match(new RegExp('^\\s*'+label+'\\s*:\\s*(.+)$','im'));
  return match?clip(match[1],2000):'';
}
function scopeFallback(title){
  return clip(title,160).toLowerCase().replace(/[^a-z0-9._/-]+/g,'-').replace(/^-+|-+$/g,'')||'general';
}

export function normalizeTerminalWorkItems(parentObjectiveId,jobs=[]){
  const parentId=clip(parentObjectiveId,200);
  if(!parentId)throw new Error('HANDOFF_PARENT_REQUIRED');
  const seenScopes=new Set();
  const out=[];
  for(const raw of Array.isArray(jobs)?jobs.slice(0,3):[]){
    if(!raw||!raw.title||!raw.prompt)continue;
    const originalTitle=clip(raw.title,200);
    const coding=CODING_PREFIX.test(originalTitle);
    const title=clip(originalTitle.replace(CODING_PREFIX,''),200)||'Next work';
    const prompt=clip(raw.prompt,12000);
    const capability=CAPABILITIES.has(raw.capability)?raw.capability:'general';
    const kind=coding?'source_mutation':(capability==='review'?'review':capability==='reasoning'?'research':'general');
    const acceptance=taggedLine(prompt,'ACCEPTANCE')||'Produce concrete evidence that this work is complete.';
    const scopeResourceKey=taggedLine(prompt,'SCOPE')||scopeFallback(title);
    if(seenScopes.has(scopeResourceKey))continue;
    seenScopes.add(scopeResourceKey);
    const idempotencyKey=hash([parentId,kind,scopeResourceKey,title,prompt].join('\n'));
    out.push({
      parentObjectiveId:parentId,
      kind,title,prompt,acceptance,capability,scopeResourceKey,
      idempotencyKey,
      authorityClass:coding?'coding_handoff_only':'api_auto',
      childObjectiveId:coding?null:`OBJ-CHILD-${idempotencyKey.slice(0,24)}`,
    });
  }
  return out;
}

export function codingHandoffPathPrefixes(item={}) {
  if(!isCodingHandoff(item))return [];
  const raw=String(item.scopeResourceKey||'');
  const paths=[...new Set(raw.split(/[;,]/).map(value=>value.trim().replace(/^\.\//,'').replace(/\/+$/,'')).filter(Boolean))];
  if(!paths.length||paths.length>6)return [];
  const allowedRoot=/^(?:apps|api|packages|scripts|tests|docs|public|schemas|config|tools)\//;
  if(paths.some(path=>!allowedRoot.test(path)||path.includes('..')||/[\\:*?"<>|]/.test(path)||isAppChromeLocalOnlyPath(path)))return [];
  return paths;
}

export function buildAutonomousCodingHandoffWorkOrder({parentIssueNumber,parentObjectiveId,parentPriority='P3',item}={}) {
  const issueNumber=Number(parentIssueNumber||0);
  const parentId=clip(parentObjectiveId,200);
  const priority=/^P[1-5]$/.test(String(parentPriority||'').toUpperCase())?String(parentPriority).toUpperCase():'P3';
  const paths=codingHandoffPathPrefixes(item);
  if(!Number.isInteger(issueNumber)||issueNumber<=0||!parentId||!item?.idempotencyKey||!paths.length)return null;
  const protectedScope=paths.some(isProtectedControlPlanePath);
  const suffix=String(item.idempotencyKey).slice(0,20);
  const resourceScope='AUTO_CODING_HANDOFF_'+suffix.toUpperCase();
  const title=`[${priority}][CORE][AUTO][CODING] ${clip(item.title||'Source repair',120)}`;
  const executable=!protectedScope;
  const body=[
    'TIGERIQ_JOB_V1',
    'WORK_ORDER_LIFECYCLE=V2',
    'PROJECT_ID=tigeriq-platform',
    'WORKSTREAM_ID=autonomous-coding-handoff',
    'SOURCE=PARENT_GH_'+issueNumber+'_CORE_HANDOFF',
    'PARENT=#'+issueNumber,
    'PARENT_OBJECTIVE='+parentId,
    'AUTONOMOUS_CODING_HANDOFF_KEY='+item.idempotencyKey,
    'OWNER_DIRECT=true',
    'OWNER_POLICY=AUTO',
    'OWNER_HOLD=false',
    'PRIORITY='+priority,
    'TIGERIQ_EXECUTABLE='+(executable?'true':'false'),
    'AUTO_QUEUE='+(executable?'INCLUDED':'EXCLUDED_NV02_CONTROL_PLANE_HANDOFF'),
    'CAPABILITY=coding',
    'EXECUTION_SURFACE='+(executable?'CODING_LANE':'GITHUB_CONNECTOR_ONLY'),
    'ASSIGNED_EXECUTOR='+(executable?'ELIGIBLE_ROLE_DYNAMIC':'NV02'),
    'MUTATION_OWNER='+(executable?'CORE_DYNAMIC_LEASE':'GITHUB_AUTHORIZED_USER_ACTIONS_ONLY'),
    'AUTONOMOUS_CODE='+(executable?'true':'false'),
    'ZERO_COST=true',
    'RESOURCE_SCOPE='+resourceScope,
    'ALLOW_PATH_PREFIX='+paths.join(','),
    'NO_PC01_SHELL=true',
    'NO_BROWSER_AUTH=true',
    'NO_PAID_COST=true',
    'NO_CREDENTIAL_CHANGE=true',
    'NO_SECURITY_BOUNDARY_CHANGE=true',
    'NO_DESTRUCTIVE=true',
    'NO_PRODUCTION_RELEASE=true',
    'NO_DIRECT_MAIN=true',
    'APP_CHROME_MUTATION=FORBIDDEN',
    'CURRENT_STATE=READY_CODING_HANDOFF',
    'CURRENT_STEP=S01 — Implement bounded source repair',
    'LAST_COMPLETED_STEP=CORE_RCA_AND_HANDOFF_MATERIALIZED',
    'NEXT_ACTION='+clip(item.prompt,1000).replace(/\s+/g,' '),
    'BLOCKER=NONE',
    'STARTED_AT=NOT_STARTED',
    'FINISHED_AT=NOT_FINISHED',
    'ETA_STATUS=UNVERIFIED',
    'SAME_FAILURE_RETRY_COUNT=0',
    'SAME_FAILURE_RETRY_MAX=2',
    'VERIFICATION_COUNT_CURRENT_HEAD=0',
    'VERIFICATION_MAX_PER_HEAD=2',
    'LAST_FAILURE_SIGNATURE=NONE',
    'RETRY_RESUME_TRIGGER=NEW_SOURCE_HEAD_OR_TEST_EVIDENCE',
    'PROGRESS_SOURCE=STRUCTURED_PROGRESS_CHECKLIST',
    'PROGRESS_COMPLETED=0',
    'PROGRESS_TOTAL=3',
    'DONE=false',
    '',
    '## GOAL',
    clip(item.prompt,4000),
    '',
    '## ACCEPTANCE',
    '- '+clip(item.acceptance||'Produce concrete evidence that this work is complete.',1000),
    '- Keep source mutation inside ALLOW_PATH_PREFIX and merge only through reviewed CI-green PR.',
    '',
    '## STRUCTURED_PROGRESS_CHECKLIST',
    '- [ ] S01 — Implement bounded repair in declared path scope',
    '- [ ] S02 — Exact-head tests/review pass and PR merged through normal gate',
    '- [ ] S03 — Runtime/source acceptance receipt linked to parent #'+issueNumber,
    '',
    '## STOP_CONDITIONS',
    'REAL_BLOCKER | EXTERNAL_WAIT | DONE_WITH_EVIDENCE',
  ].join('\n');
  return {title,body,paths,protectedScope,resourceScope,executable,marker:'AUTONOMOUS_CODING_HANDOFF_KEY='+item.idempotencyKey};
}

export function handoffGenerationKey(items=[]){
  return hash((Array.isArray(items)?items:[]).map(x=>x.idempotencyKey).filter(Boolean).sort().join('|'));
}

export function evaluateChildObjectiveStates(expectedChildIds=[],rows=[]){
  const ids=[...new Set((Array.isArray(expectedChildIds)?expectedChildIds:[]).map(String).filter(Boolean))];
  const byId=new Map((Array.isArray(rows)?rows:[]).map(row=>[String(row.id),row]));
  if(!ids.length)return {state:'completed',pending:[],blocked:[],completed:[],results:[]};
  const pending=[],blocked=[],completed=[],results=[];
  for(const id of ids){
    const row=byId.get(id);
    if(!row){pending.push(id);continue;}
    if(row.status==='blocked'){blocked.push(id);continue;}
    if(row.status==='completed'){
      completed.push(id);
      results.push({id,status:'completed',summary:clip(row.summary,1000)});
      continue;
    }
    pending.push(id);
  }
  return {
    state:blocked.length?'blocked':pending.length?'waiting':'completed',
    pending,blocked,completed,results,
  };
}

export function isCodingHandoff(item){return item?.kind==='source_mutation'||item?.kind==='coding';}

export function normalizeWorkItemLifecycle(item = {}) {
  const meta = item?.metadata || item || {};
  return {
    issueOrPr: String(meta.issueOrPr || meta.issue_or_pr || meta.pr || meta.issue || '').trim(),
    implementer: String(meta.implementer || meta.assignee || meta.employee_id || '').trim(),
    reviewer: String(meta.reviewer || meta.review_employee_id || '').trim(),
    stage: String(meta.stage || meta.status || item.status || 'coding_lane').trim(),
    timestamps: meta.timestamps || { updated: new Date().toISOString() },
    blocker: String(meta.blocker || meta.blocked_reason || '').trim(),
    nextAction: String(meta.nextAction || meta.next_action || meta.next || '').trim()
  };
}


export function ownerFacingHandoffLifecycle(item = {}) {
  const lifecycle = normalizeWorkItemLifecycle(item);
  const progressPresentation = verifiedOwnerProgress(item?.progress || null);
  return {
    ...lifecycle,
    stage: ownerStatusLabel(lifecycle.stage),
    icon: ownerStatusIcon(lifecycle.stage),
    iconName: ownerStatusVectorIcon(lifecycle.stage),
    blocker: localizeOwnerFacingText(lifecycle.blocker),
    nextAction: localizeOwnerFacingText(lifecycle.nextAction),
    ...(progressPresentation ? { progressPresentation } : {}),
  };
}
