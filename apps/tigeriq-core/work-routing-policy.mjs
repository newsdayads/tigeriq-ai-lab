import {backlogAssignedExecutor,bodyValue,effectiveBacklogPriority,exactBodyFlag,isReviewOnlySpec} from './github-backlog-policy.mjs';

export const UI_ROLE_WORKERS=Object.freeze(['NV02','NV03','NV04']);
export const ROLE_CLAIM_MARKER='[TIGERIQ_ROLE_CLAIM_V1]';
export const ROLE_RELEASE_MARKER='[TIGERIQ_ROLE_RELEASE_V1]';

function employee(value){const v=String(value||'').trim().toUpperCase();return /^NV\d{2}$/.test(v)?v:'';}
function capability(body){
  const explicit=String(bodyValue(body,'CAPABILITY')||'').trim().toLowerCase();
  if(explicit)return explicit;
  if(isReviewOnlySpec(body))return 'review';
  if(exactBodyFlag(body,'AUTONOMOUS_CODE','true'))return 'coding';
  return 'general';
}

export function preferredEmployee(body){return employee(bodyValue(body,'PREFERRED_REVIEWER'));}

export function classifyWorkOrder(body){
  const text=String(body||'');
  const priority=effectiveBacklogPriority(text);
  const cap=capability(text);
  const surface=String(bodyValue(text,'EXECUTION_SURFACE')||'').trim().toUpperCase();
  const assigned=backlogAssignedExecutor(text);
  const preferred=preferredEmployee(text);
  if(priority.sourcePriority==='P0'){
    return {...priority,capability:cap,surface,assignedExecutor:'',preferredEmployee:preferred,route:'HOLD_OWNER',workerId:null,autonomous:false};
  }
  if(assigned){
    if(assigned==='NV06')return {...priority,capability:cap,surface,assignedExecutor:assigned,preferredEmployee:preferred,route:'OPENCLAW',workerId:assigned,autonomous:true};
    if(assigned==='NV09')return {...priority,capability:cap,surface,assignedExecutor:assigned,preferredEmployee:preferred,route:'CODING',workerId:assigned,autonomous:true};
    if(UI_ROLE_WORKERS.includes(assigned))return {...priority,capability:cap,surface,assignedExecutor:assigned,preferredEmployee:preferred,route:'UI',workerId:assigned,autonomous:false};
    return {...priority,capability:cap,surface,assignedExecutor:assigned,preferredEmployee:preferred,route:cap==='review'?'CORE_REVIEW':'CORE_REASONING',workerId:assigned,autonomous:true};
  }
  if(cap==='pc_operator')return {...priority,capability:cap,surface,assignedExecutor:'',preferredEmployee:preferred,route:'OPENCLAW',workerId:'NV06',autonomous:true};
  if(surface==='CODING'||cap==='coding'||(exactBodyFlag(text,'AUTONOMOUS_CODE','true')&&!exactBodyFlag(text,'NO_CODE_CHANGE','true'))){
    return {...priority,capability:'coding',surface,assignedExecutor:'',preferredEmployee:preferred,route:'CODING',workerId:null,autonomous:true};
  }
  if(cap==='review'){
    if(UI_ROLE_WORKERS.includes(preferred))return {...priority,capability:cap,surface,assignedExecutor:'',preferredEmployee:preferred,route:'UI',workerId:preferred,autonomous:false};
    return {...priority,capability:cap,surface,assignedExecutor:'',preferredEmployee:preferred,route:'CORE_REVIEW',workerId:preferred||null,autonomous:true};
  }
  if(cap==='research'||cap==='deep_research'||surface==='RESEARCH'){
    if(UI_ROLE_WORKERS.includes(preferred))return {...priority,capability:'research',surface,assignedExecutor:'',preferredEmployee:preferred,route:'UI',workerId:preferred,autonomous:false};
    return {...priority,capability:'research',surface,assignedExecutor:'',preferredEmployee:preferred,route:'CORE_REASONING',workerId:preferred||null,autonomous:true};
  }
  if(surface==='UI'){
    return {...priority,capability:cap,surface,assignedExecutor:'',preferredEmployee:preferred,route:'UI',workerId:null,autonomous:false};
  }
  if(cap==='general'||cap==='ui'){
    return {...priority,capability:'general',surface,assignedExecutor:'',preferredEmployee:preferred,route:'CORE_REASONING',workerId:null,autonomous:true};
  }
  return {...priority,capability:cap||'reasoning',surface,assignedExecutor:'',preferredEmployee:preferred,route:'CORE_REASONING',workerId:preferred||null,autonomous:true};
}

export function roleCanPull(_workerId,_classification){
  // NV02/NV03/NV04 are external to Core routing and never self-pull through Core role fallback.
  return false;
}

export function buildRoleFallbackPrompt(workerId){
  const id=employee(workerId);
  return [
    id+' — UI_WORKER_EXTERNAL_TO_CORE=true.',
    'Core must not assign, route, claim, revoke, reassign, or select backlog for this worker.',
    'Do not scan or self-claim GitHub work through Core role fallback.',
    'Continue only work already present in the current Owner/UI conversation under the separate local continuity policy.',
    'P0 remains Owner-only and App Chrome remains a separate Owner-controlled scope.',
  ].join(' ');
}

function claimFields(body){
  const text=String(body||'');
  const worker=employee(text.match(/^WORKER=(NV\d{2})$/m)?.[1]);
  const scope=String(text.match(/^RESOURCE_SCOPE=(.+)$/m)?.[1]||'').trim();
  const until=String(text.match(/^LEASE_UNTIL=(.+)$/m)?.[1]||'').trim();
  const untilMs=Date.parse(until);
  return {workerId:worker,resourceScope:scope,leaseUntil:until,leaseUntilMs:Number.isFinite(untilMs)?untilMs:0};
}

export function activeRoleClaim(comments=[],nowMs=Date.now()){
  const ordered=(Array.isArray(comments)?comments:[]).slice().sort((a,b)=>{
    const ta=Date.parse(String(a?.created_at||''))||0,tb=Date.parse(String(b?.created_at||''))||0;
    return ta-tb||Number(a?.id||0)-Number(b?.id||0);
  });
  let active=null;
  for(const comment of ordered){
    const body=String(comment?.body||'');
    if(body.includes(ROLE_CLAIM_MARKER)){
      const claim=claimFields(body);
      if(claim.workerId&&claim.leaseUntilMs>nowMs)active={...claim,commentId:comment?.id||null,createdAt:comment?.created_at||null};
      else if(claim.workerId)active=null;
    }else if(body.includes(ROLE_RELEASE_MARKER)){
      const released=claimFields(body);
      if(!released.workerId||!active||released.workerId===active.workerId)active=null;
    }
  }
  return active&&active.leaseUntilMs>nowMs?active:null;
}

export function buildRoleFallbackPrompt(workerId){
  const id=employee(workerId);
  const role=id==='NV02'?'MAIN_EXECUTOR':id==='NV03'?'INDEPENDENT_REVIEWER':id==='NV04'?'DEEP_RESEARCH_SECOND_OPINION':'UNKNOWN';
  return [
    id+' — ROLE_LOOP='+role+'.',
    'Core assignment has priority. Continue any valid current assignment first.',
    'If there is no valid Core assignment or Core is stale/unavailable, audit canonical GitHub Source of Truth and pull exactly ONE eligible P1-P5 item for this role.',
    'P0 is Owner-only: never read, claim, receive, select, or execute P0 work.',
    'Never touch App Chrome mutation scope. Never take work already owned/leased or with overlapping RESOURCE_SCOPE.',
    'Before fallback work, post [TIGERIQ_ROLE_CLAIM_V1] with WORKER='+id+', RESOURCE_SCOPE=<scope>, LEASE_UNTIL=<ISO within 30 minutes>; renew if still working. On handoff/wait/terminal, post [TIGERIQ_ROLE_RELEASE_V1].',
    'NV02 may take general/reasoning execution; NV03 review/QA only; NV04 research/deep-analysis/second-opinion only.',
    'Work continuously until DONE with evidence, BLOCKED, EXTERNAL_WAIT, or mandatory Owner gate.',
  ].join(' ');
}
