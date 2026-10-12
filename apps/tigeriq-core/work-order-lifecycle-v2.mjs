// Source-only Work Order Lifecycle V2. This validates declarations; it does not
// create a live lease, verify an external receipt, or authorize protected actions.
export const LIFECYCLE_V2_NEW_WORK_CUTOFF='2026-10-12T00:00:00.000Z';
const SYSTEM_TITLE=/\[(?:CENTRAL|QUẢN TRỊ|REGISTRY|STATE|TÀI NGUYÊN|POLICY|SOT|RESULTS)\]/i;
const TIME_PATTERN=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const WAIT_PATTERN=/^(?:WAIT|WAITING|BLOCKED|PARKED|EXTERNAL_WAIT|OWNER_GATE)/;
const ACTIVE_PATTERN=/(?:^|_)(?:WORKING|RUNNING|IN_PROGRESS|REVIEW|VERIFY|CODING_LANE_ACTIVE|DONE|COMPLETED)(?:_|$)/;
export function lifecycleStage(state=''){
  const s=String(state||'').toUpperCase();
  if(/^(?:READY|QUEUED|PREPARED|SOURCE_READY)(?:_|$)/.test(s))return 'READY';
  if(/^(?:WORKING|RUNNING|IN_PROGRESS|EXECUTING|CODING_LANE_ACTIVE)(?:_|$)/.test(s))return 'WORKING';
  if(/^(?:REVIEW|REVIEWING)(?:_|$)/.test(s))return 'REVIEW';
  if(/^(?:VERIFY|VERIFYING)(?:_|$)/.test(s))return 'VERIFY';
  if(/^(?:WAIT|WAITING|BLOCKED|PARKED|EXTERNAL_WAIT|OWNER_GATE)(?:_|$)/.test(s))return 'WAIT';
  if(/^(?:DONE|COMPLETED)(?:_|$)/.test(s))return 'DONE';
  if(/^(?:NOT_PLANNED|CANCELLED|CANCELED|SUPERSEDED)(?:_|$)/.test(s))return 'STOPPED';
  return 'UNKNOWN';
}

function activeText(value=''){
  const all=String(value||'');
  const divider=all.search(/^ {0,3}(?:---+|\*\*\*+|___+)(?:\s+HISTORICAL[^\n]*)?\s*$/m);
  return divider<0?all:all.slice(0,divider);
}
function activeHeader(value=''){
  const text=activeText(value),lines=text.split(/\r?\n/);
  const first=lines.findIndex(s=>/^#{1,6}\s+\S/.test(s));
  const from=first<0?0:first+1;
  const next=lines.findIndex((s,i)=>i>=from&&/^#{1,6}\s+\S/.test(s));
  return lines.slice(from,next<0?lines.length:next).join('\n');
}
function field(block,key){
  const m=String(block||'').match(new RegExp('^'+key+'=([^\\r\\n]*)$','m'));
  return m?m[1].trim():'';
}
function validTime(value){
  const s=String(value||'');
  return TIME_PATTERN.test(s)&&Number.isFinite(Date.parse(s));
}
export function lifecycleSteps(body=''){
  const text=activeText(body);
  const lines=text.split(/\r?\n/);
  const start=lines.findIndex(s=>/^##\s+STRUCTURED_PROGRESS_CHECKLIST\b/i.test(s));
  if(start<0)return [];
  const steps=[],from=lines.slice(start+1);
  let fenced=false;
  for(const line of from){
    if(/^##\s+\S|^ {0,3}---+\s*$/.test(line))break;
    if(/^\s*(?:~~~|`{3,})/.test(line)){fenced=!fenced;continue;}
    if(fenced)continue;
    const match=line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/);
    if(!match)continue;
    const checked=/x/i.test(match[1]),title=match[2].trim();
    const evidence=title.match(/\[[^\]]+\]\((https:\/\/[^\s)]+)\)/)?.[1]||null;
    steps.push({title,checked,evidence});
  }
  return steps;
}
export function requiresLifecycleV2(issue={}){
  if(issue?.pull_request)return false;
  const title=String(issue.title||''),header=activeHeader(issue.body);
  // Explicit opt-in is binding even on legacy tickets; archived flags cannot opt in.
  if(field(header,'WORK_ORDER_LIFECYCLE')==='V2')return true;
  // Title-only exclusions must not let an executable ticket masquerade as metadata.
  const priority=field(header,'PRIORITY').toUpperCase();
  const executable=field(header,'TIGERIQ_EXECUTABLE').toLowerCase()==='true';
  const auto=field(header,'OWNER_POLICY').toUpperCase()==='AUTO';
  const workCandidate=/\[P[0-5]\]/i.test(title)||/^(?:P[0-5])$/.test(priority)||executable||auto;
  if(!workCandidate)return false;
  if(SYSTEM_TITLE.test(title)&&!executable&&!auto)return false;
  const created=Date.parse(String(issue.created_at||''));
  return Number.isFinite(created)&&created>=Date.parse(LIFECYCLE_V2_NEW_WORK_CUTOFF);
}
export function lifecycleTimeSnapshot(issue={}){
  const h=activeHeader(issue.body);
  const started=field(h,'STARTED_AT'),finished=field(h,'FINISHED_AT');
  const eta=field(h,'ETA_STATUS').toUpperCase();
  const target=field(h,'TARGET_FINISH_AT');
  const checkpoint=field(h,'CHECKPOINT_DUE_AT');
  const startedAt=validTime(started)?new Date(started).toISOString():null;
  const finishedAt=validTime(finished)&&issue?.state==='closed'&&issue?.state_reason==='completed'
    ?new Date(finished).toISOString():null;
  const targetFinishAt=validTime(target)&&['ESTIMATED','COMMITTED'].includes(eta)
    ?new Date(target).toISOString():null;
  return {
    startedAt, finishedAt, targetFinishAt,
    checkpointDueAt:validTime(checkpoint)?new Date(checkpoint).toISOString():null,
    etaStatus:eta||'UNVERIFIED',
    startVerified:startedAt!==null&&/^https:\/\//.test(field(h,'START_RECEIPT_URL')),
    finishVerified:finishedAt!==null&&/^https:\/\//.test(field(h,'FINISH_RECEIPT_URL')),
    // Timestamps are declarations until original receipts are independently read.
    timeSource:'GITHUB_DECLARATION_NOT_RUNTIME_ATTESTATION'
  };
}
export function validateWorkOrderLifecycleV2(issue={}){
  const required=requiresLifecycleV2(issue);
  const header=activeHeader(issue.body),body=activeText(issue.body),steps=lifecycleSteps(issue.body);
  const missing=[];
  const f=k=>field(header,k);
  const timestamps=lifecycleTimeSnapshot(issue);
  if(!required)return {required:false,valid:true,missing:[],steps,timestamps,source:'LEGACY_NOT_ENFORCED'};
  if(f('WORK_ORDER_LIFECYCLE')!=='V2')missing.push('WORK_ORDER_LIFECYCLE=V2');
  for(const key of ['PROJECT_ID','WORKSTREAM_ID','CURRENT_STATE','CURRENT_STEP',
    'NEXT_ACTION','LAST_COMPLETED_STEP','BLOCKER','RESOURCE_SCOPE','MUTATION_OWNER',
    'ETA_STATUS','STARTED_AT','FINISHED_AT']){
    if(!f(key))missing.push(key);
  }
  if(!/^##\s+ACCEPTANCE\b/m.test(body))missing.push('ACCEPTANCE_SECTION');
  if(!/^##\s+STOP_CONDITIONS\b/m.test(body))missing.push('STOP_CONDITIONS_SECTION');
  if(steps.length<2||steps.length>64)missing.push('CHECKLIST_2_TO_64');
  if(steps.some(s=>s.checked&&!s.evidence))missing.push('CHECKED_STEP_WITHOUT_EVIDENCE_URL');
  const state=f('CURRENT_STATE').toUpperCase(),start=f('STARTED_AT'),finish=f('FINISHED_AT');
  const stage=lifecycleStage(state);
  if(stage==='UNKNOWN')missing.push('UNRECOGNIZED_LIFECYCLE_STATE');
  const eta=f('ETA_STATUS').toUpperCase();
  if(!['UNVERIFIED','NOT_COMMITTED','ESTIMATED','COMMITTED','NOT_APPLICABLE'].includes(eta))
    missing.push('ETA_STATUS_INVALID');
  if(start&&!['NOT_STARTED','UNVERIFIED'].includes(start)&&!validTime(start))
    missing.push('STARTED_AT_INVALID');
  if(finish&&!['NOT_FINISHED','UNVERIFIED'].includes(finish)&&!validTime(finish))
    missing.push('FINISHED_AT_INVALID');
  if(['ESTIMATED','COMMITTED'].includes(eta)&&!validTime(f('TARGET_FINISH_AT')))
    missing.push('TARGET_FINISH_AT_REQUIRED_FOR_ETA');
  if(f('CHECKPOINT_DUE_AT')&&!validTime(f('CHECKPOINT_DUE_AT')))
    missing.push('CHECKPOINT_DUE_AT_INVALID');
  if(ACTIVE_PATTERN.test(state)&&!timestamps.startedAt)missing.push('ACTIVITY_WITHOUT_START_TIME');
  if(ACTIVE_PATTERN.test(state)&&!timestamps.startVerified)missing.push('ACTIVITY_WITHOUT_START_RECEIPT');
  if(WAIT_PATTERN.test(state)&&['NONE','NULL','NO',''].includes(f('BLOCKER').toUpperCase()))
    missing.push('WAIT_WITHOUT_BLOCKER');
  if(issue.state==='open'&&finish&&validTime(finish))missing.push('OPEN_WITH_FINISHED_AT');
  if(issue.state==='closed'&&issue.state_reason==='completed'){
    if(f('DONE')!=='true'||!timestamps.finishedAt||!timestamps.finishVerified)
      missing.push('COMPLETED_WITHOUT_VERIFIED_FINISH');
    if(steps.length<2||steps.some(s=>!s.checked||!s.evidence))missing.push('COMPLETED_WITHOUT_ALL_RECEIPTS');
  }
  // Metadata may never make a task DONE or grant permission by itself.
  return {required:true,valid:missing.length===0,missing,steps,timestamps,stage,source:'SOURCE_SCHEMA_ONLY_NOT_LIVE_EVIDENCE'};
}
