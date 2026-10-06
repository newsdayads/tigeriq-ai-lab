import { bodyValue } from './github-backlog-policy.mjs';

export const BACKLOG_LIGHT_SWEEP_MS=15*60*1000;
export const BACKLOG_DEEP_SWEEP_MS=6*60*60*1000;

function boolFlag(body,key,value='true'){
  return bodyValue(body,key).trim().toLowerCase()===String(value).trim().toLowerCase();
}

function normalize(value=''){
  return String(value||'').trim().toLowerCase()
    .replace(/\[nv\d{2}\]/gi,'')
    .replace(/\b(?:retry|rearm)\b(?:\s*#?\d+)?/gi,'')
    .replace(/\bv\d+\b/gi,'')
    .replace(/[^a-z0-9#._/-]+/g,'-')
    .replace(/-+/g,'-')
    .replace(/^-|-$/g,'');
}

function scopeFamily(value=''){
  return String(value||'').trim().toUpperCase()
    .replace(/(?:_V\d+|_RETRY(?:_\d+)?|_REARM(?:_\d+)?)(?=_|$)/g,'')
    .replace(/_20\d{6}(?:\d{0,6})?$/,'')
    .replace(/_+/g,'_')
    .replace(/^_|_$/g,'');
}

export function backlogHygieneDedupeKey(issue={}){
  const body=String(issue?.body||'');
  const project=normalize(bodyValue(body,'PROJECT_ID')||'tigeriq-ai-lab');
  const workstream=normalize(bodyValue(body,'WORKSTREAM_ID')||bodyValue(body,'WORK_PACKAGE_ID'));
  const family=normalize(bodyValue(body,'OBJECTIVE_FAMILY')||bodyValue(body,'FAMILY')||bodyValue(body,'CANONICAL_SPEC')||issue?.title||'');
  const scope=normalize(scopeFamily(bodyValue(body,'RESOURCE_SCOPE')));
  const artifact=normalize(bodyValue(body,'TARGET_ARTIFACT')||bodyValue(body,'TARGET_PATH')||bodyValue(body,'TARGET_PR'));
  return [project,workstream,family,scope,artifact].join('|');
}

export function createBacklogSweepState(nowMs=Date.now()){
  const now=Number(nowMs)||0;
  return {running:false,lastLightAt:now,lastDeepAt:now,cursor:null};
}

export function backlogSweepDue(state={},nowMs=Date.now()){
  if(state?.running)return {due:false,kind:null,reason:'SWEEP_ALREADY_RUNNING'};
  const now=Number(nowMs)||0;
  const lastDeep=Number(state?.lastDeepAt)||0;
  const lastLight=Number(state?.lastLightAt)||0;
  if(now-lastDeep>=BACKLOG_DEEP_SWEEP_MS)return {due:true,kind:'deep',reason:'DEEP_INTERVAL'};
  if(now-lastLight>=BACKLOG_LIGHT_SWEEP_MS)return {due:true,kind:'light',reason:'LIGHT_INTERVAL'};
  return {due:false,kind:null,reason:'NOT_DUE'};
}

export function beginBacklogSweep(state={},kind,nowMs=Date.now()){
  if(state?.running)return {...state};
  return {...state,running:true,activeKind:kind,startedAt:Number(nowMs)||0};
}

export function finishBacklogSweep(state={},kind,nowMs=Date.now(),cursor=null){
  const now=Number(nowMs)||0;
  return {
    ...state,
    running:false,
    activeKind:null,
    startedAt:null,
    cursor:cursor??state?.cursor??null,
    lastLightAt:kind==='light'||kind==='deep'?now:Number(state?.lastLightAt)||0,
    lastDeepAt:kind==='deep'?now:Number(state?.lastDeepAt)||0,
  };
}

function currentState(body=''){return bodyValue(body,'CURRENT_STATE').trim().toUpperCase();}
function leaseUntil(body=''){
  const raw=bodyValue(body,'LEASE_UNTIL')||bodyValue(body,'CHAT_SESSION_LEASE_UNTIL');
  const ms=Date.parse(raw);
  return Number.isFinite(ms)?ms:null;
}

export function backlogHygieneFindings(issues=[],{nowMs=Date.now(),deep=false}={}){
  const rows=(Array.isArray(issues)?issues:[]).filter((issue)=>issue&&!issue.pull_request);
  const findings=[];
  const canonical=new Map();
  for(const issue of rows){
    const body=String(issue?.body||'');
    const open=String(issue?.state||'open').toLowerCase()==='open';
    const key=backlogHygieneDedupeKey(issue);
    if(open&&key){
      const first=canonical.get(key);
      if(first)findings.push({type:'DUPLICATE_FAMILY',issueNumber:Number(issue.number)||0,canonicalIssueNumber:Number(first.number)||0,key});
      else canonical.set(key,issue);
    }
    const state=currentState(body);
    const executable=bodyValue(body,'TIGERIQ_EXECUTABLE').trim().toLowerCase()==='true';
    const terminal=String(issue?.state||'').toLowerCase()==='closed'||boolFlag(body,'DONE','true')||/^(?:DONE|COMPLETED|TERMINAL)/.test(state);
    if(terminal&&executable)findings.push({type:'TERMINAL_EXECUTABLE_MARKER',issueNumber:Number(issue.number)||0});
    const leaseMs=leaseUntil(body);
    if(open&&leaseMs!==null&&leaseMs<Number(nowMs))findings.push({type:'STALE_LEASE',issueNumber:Number(issue.number)||0,leaseUntil:new Date(leaseMs).toISOString()});
    if(open&&/(?:WAIT|WAITING|BLOCKED|PARKED|EXTERNAL_WAIT)/.test(state)&&leaseMs!==null&&leaseMs>=Number(nowMs)){
      findings.push({type:'PARKED_ITEM_HOLDS_LEASE',issueNumber:Number(issue.number)||0,leaseUntil:new Date(leaseMs).toISOString()});
    }
    if(deep&&open&&(bodyValue(body,'CAPABILITY').toLowerCase()==='review'||boolFlag(body,'REVIEW_ONLY','true'))&&/(?:WAIT|WAITING|BLOCKED|PARKED)/.test(state)&&!bodyValue(body,'TARGET_HEAD')){
      findings.push({type:'ORPHAN_REVIEW',issueNumber:Number(issue.number)||0});
    }
  }
  return findings;
}
