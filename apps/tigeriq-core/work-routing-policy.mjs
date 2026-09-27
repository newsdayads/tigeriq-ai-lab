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
    if(assigned==='NV06')return {...priority,capability:cap,surface,assignedExecutor:assigned,preferredEmployee:preferred,route:'OPENCLAW',workerId:assigned,autonomous:priority.priority!=='P0'};
    if(assigned==='NV09')return {...priority,capability:cap,surface,assignedExecutor:assigned,preferredEmployee:preferred,route:'CODING',workerId:assigned,autonomous:priority.priority!=='P0'};
    if(UI_ROLE_WORKERS.includes(assigned))return {...priority,capability:cap,surface,assignedExecutor:assigned,preferredEmployee:preferred,route:'UI',workerId:assigned,autonomous:priority.priority!=='P0'};
    return {...priority,capability:cap,surface,assignedExecutor:assigned,preferredEmployee:preferred,route:cap==='review'?'CORE_REVIEW':'CORE_REASONING',workerId:assigned,autonomous:priority.priority!=='P0'};
  }
  if(cap==='pc_operator')return {...priority,capability:cap,surface,assignedExecutor:'',preferredEmployee:preferred,route:'OPENCLAW',workerId:'NV06',autonomous:true};
  if(surface==='CODING'||cap==='coding'||(exactBodyFlag(text,'AUTONOMOUS_CODE','true')&&!exactBodyFlag(text,'NO_CODE_CHANGE','true'))){
    return {...priority,capability:'coding',surface,assignedExecutor:'',preferredEmployee:preferred,route:'CODING',workerId:null,autonomous:true};
  }
  if(cap==='review'){
    if(preferred==='NV03'||preferred==='NV04')return {...priority,capability:cap,surface,assignedExecutor:'',preferredEmployee:preferred,route:'UI',workerId:preferred,autonomous:true};
    if(preferred)return {...priority,capability:cap,surface,assignedExecutor:'',preferredEmployee:preferred,route:'CORE_REVIEW',workerId:preferred,autonomous:true};
    return {...priority,capability:cap,surface,assignedExecutor:'',preferredEmployee:'',route:'UI',workerId:'NV03',autonomous:true};
  }
  if(cap==='research'||cap==='deep_research'||surface==='RESEARCH'){
    return {...priority,capability:'research',surface,assignedExecutor:'',preferredEmployee:preferred,route:'UI',workerId:'NV04',autonomous:true};
  }
  if(surface==='UI'){
    const worker=cap==='review'?'NV03':(cap==='research'||cap==='deep_research')?'NV04':'NV02';
    return {...priority,capability:cap,surface,assignedExecutor:'',preferredEmployee:preferred,route:'UI',workerId:worker,autonomous:true};
  }
  if(cap==='general'||cap==='ui'){
    return {...priority,capability:'general',surface,assignedExecutor:'',preferredEmployee:preferred,route:'UI',workerId:'NV02',autonomous:true};
  }
  return {...priority,capability:cap||'reasoning',surface,assignedExecutor:'',preferredEmployee:preferred,route:'CORE_REASONING',workerId:preferred||null,autonomous:true};
}

export function roleCanPull(_workerId,_classification){
  // Employees execute explicit system assignments only; they never self-pull GitHub work.
  return false;
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
    'Continue only a valid explicit system assignment for this worker.',
    'If no valid system assignment exists, remain READY_UNASSIGNED and wait. Do not scan, read, claim, or select GitHub work.',
    'P0 is Owner-only: employees must not read, receive, claim, or execute it. P1-P5 are executable only after explicit system assignment.',
    'Never touch App Chrome mutation scope or work owned by another actor/resource lease.',
    'NV02 executes assigned general/reasoning work; NV03 assigned review/QA only; NV04 assigned research/deep-analysis/second-opinion only.',
    'For assigned work, continue until DONE with evidence, BLOCKED, EXTERNAL_WAIT, or mandatory Owner gate.',
  ].join(' ');
}
