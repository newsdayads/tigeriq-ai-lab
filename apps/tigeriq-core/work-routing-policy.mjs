import {backlogAssignedExecutor,bodyValue,effectiveBacklogPriority,exactBodyFlag,isReviewOnlySpec} from './github-backlog-policy.mjs';

export const UI_ROLE_WORKERS=Object.freeze(['NV02','NV03','NV04']);
export const CORE_ROUTED_UI_WORKERS=Object.freeze(['NV03','NV04']);
export const ROLE_CLAIM_MARKER='[TIGERIQ_ROLE_CLAIM_V1]';
export const ROLE_RELEASE_MARKER='[TIGERIQ_ROLE_RELEASE_V1]';

function employee(value){const v=String(value||'').trim().toUpperCase();return /^NV\d{2}$/.test(v)?v:'';}
function capability(body){
  const explicit=String(bodyValue(body,'CAPABILITY')||'').trim().toLowerCase();
  if(explicit)return explicit;
  if(isReviewOnlySpec(body))return 'review';
  if(exactBodyFlag(body,'FINAL_REVIEW_REQUIRED','true')&&exactBodyFlag(body,'NO_CODE_CHANGE','true'))return 'review';
  if(exactBodyFlag(body,'AUTONOMOUS_CODE','true'))return 'coding';
  return 'general';
}

export function preferredEmployee(body){return employee(bodyValue(body,'PREFERRED_REVIEWER'));}

function isNv04SecondOpinion(body,cap=''){
  const text=String(body||'');
  const capabilityName=String(cap||'').trim().toLowerCase();
  const mode=String(bodyValue(text,'REVIEW_MODE')||'').trim().toUpperCase();
  const specialty=String(bodyValue(text,'REVIEW_SPECIALTY')||'').trim().toUpperCase();
  return capabilityName==='second_opinion'||exactBodyFlag(text,'SECOND_OPINION','true')||mode==='SECOND_OPINION'||['SECOND_OPINION','FACT_CHECK','EVIDENCE_REVIEW','RESEARCH_VALIDATION'].includes(specialty);
}

function nv04SecondOpinionRoute(priority,surface,requestedReviewer=''){
  return {...priority,capability:'second_opinion',surface:surface||'CORE_UI_REVIEW',assignedExecutor:'',preferredEmployee:'NV04',route:'UI',workerId:'NV04',autonomous:true,requestedReviewer:employee(requestedReviewer)||null,reviewRoutingReason:'NV04_SECOND_OPINION'};
}

function reviewSpecialistRoute(body,workerId){
  const id=employee(workerId);
  if(!id)return {allowed:false,reason:'REVIEWER_INVALID'};
  const specialty=String(bodyValue(body,'REVIEW_SPECIALTY')||'').trim().toUpperCase();
  const ownerReviewer=employee(bodyValue(body,'OWNER_REVIEWER'));
  const fallbackEmployee=employee(bodyValue(body,'REVIEW_FALLBACK_EMPLOYEE'));
  const fallbackReason=String(bodyValue(body,'REVIEW_FALLBACK_REASON')||'').trim();
  if(ownerReviewer===id)return {allowed:true,reason:'OWNER_EXPLICIT_REVIEWER'};
  if(id==='NV10'&&['API_DOCTOR','SRE'].includes(specialty))return {allowed:true,reason:'NV10_SPECIALIZED_'+specialty};
  if(id!=='NV10'&&fallbackEmployee===id&&fallbackReason)return {allowed:true,reason:'NV03_UNAVAILABLE_FALLBACK:'+fallbackReason};
  return {allowed:false,reason:'GENERIC_REVIEW_NV03_PRIMARY'};
}

function primaryReviewRoute(priority,cap,requestedReviewer=''){
  return {
    ...priority,
    capability:cap,
    surface:'CORE_UI_REVIEW',
    assignedExecutor:'',
    preferredEmployee:'NV03',
    route:'UI',
    workerId:'NV03',
    autonomous:true,
    requestedReviewer:employee(requestedReviewer)||null,
    reviewRoutingReason:'NV03_PRIMARY_GENERIC_REVIEW',
  };
}

export function classifyWorkOrder(body){
  const text=String(body||'');
  const priority=effectiveBacklogPriority(text);
  const cap=capability(text);
  const surface=String(bodyValue(text,'EXECUTION_SURFACE')||'').trim().toUpperCase();
  const assigned=backlogAssignedExecutor(text);
  const preferred=preferredEmployee(text);
  const ownerP0Reviewer=employee(bodyValue(text,'OWNER_REVIEWER'));
  const ownerP0ReviewDispatch=priority.sourcePriority==='P0'
    &&cap==='review'
    &&exactBodyFlag(text,'OWNER_DIRECT','true')
    &&exactBodyFlag(text,'VY_DIRECT_REVIEW_DISPATCH','true')
    &&exactBodyFlag(text,'REVIEW_ONLY','true')
    &&exactBodyFlag(text,'NO_CODE_CHANGE','true')
    &&exactBodyFlag(text,'NO_PC01_SHELL','true')
    &&exactBodyFlag(text,'NO_DIRECT_MAIN','true')
    &&exactBodyFlag(text,'NO_PRODUCTION_RELEASE','true')
    &&exactBodyFlag(text,'NO_PAID_COST','true')
    &&exactBodyFlag(text,'NO_CREDENTIAL_CHANGE','true')
    &&exactBodyFlag(text,'NO_SECURITY_BOUNDARY_CHANGE','true')
    &&exactBodyFlag(text,'NO_DESTRUCTIVE','true')
    &&['NV03','NV04'].includes(ownerP0Reviewer);
  if(priority.sourcePriority==='P0'){
    if(ownerP0ReviewDispatch){
      return {
        ...priority,capability:'review',surface:'CORE_UI_REVIEW',assignedExecutor:'',preferredEmployee:ownerP0Reviewer,
        route:'UI',workerId:ownerP0Reviewer,autonomous:true,requestedReviewer:ownerP0Reviewer,
        reviewRoutingReason:'OWNER_VY_DIRECT_P0_REVIEW',
      };
    }
    return {...priority,capability:cap,surface,assignedExecutor:'',preferredEmployee:preferred,route:'HOLD_OWNER',workerId:null,autonomous:false};
  }
  if(surface==='MOBILE_WORKER'||cap==='mobile_worker'){
    return {...priority,capability:'mobile_worker',surface:'MOBILE_WORKER',assignedExecutor:'',preferredEmployee:preferred,route:'MOBILE_WORKER',workerId:null,autonomous:true};
  }
  if(assigned){
    if(assigned==='NV06')return {...priority,capability:cap,surface,assignedExecutor:assigned,preferredEmployee:preferred,route:'OPENCLAW',workerId:assigned,autonomous:true};
    if(assigned==='NV09')return {...priority,capability:cap,surface,assignedExecutor:assigned,preferredEmployee:preferred,route:'CODING',workerId:assigned,autonomous:true};
    if(UI_ROLE_WORKERS.includes(assigned))return {...priority,capability:cap,surface,assignedExecutor:assigned,preferredEmployee:preferred,route:'UI',workerId:assigned,autonomous:CORE_ROUTED_UI_WORKERS.includes(assigned)};
    if(cap==='review'){
      const specialist=reviewSpecialistRoute(text,assigned);
      if(!specialist.allowed)return primaryReviewRoute(priority,cap,assigned);
      return {...priority,capability:cap,surface,assignedExecutor:assigned,preferredEmployee:preferred,route:'CORE_REVIEW',workerId:assigned,autonomous:true,reviewRoutingReason:specialist.reason};
    }
    return {...priority,capability:cap,surface,assignedExecutor:assigned,preferredEmployee:preferred,route:'CORE_REASONING',workerId:assigned,autonomous:true};
  }
  if(cap==='pc_operator')return {...priority,capability:cap,surface,assignedExecutor:'',preferredEmployee:preferred,route:'OPENCLAW',workerId:'NV06',autonomous:true};
  if(surface==='CODING'||cap==='coding'||(exactBodyFlag(text,'AUTONOMOUS_CODE','true')&&!exactBodyFlag(text,'NO_CODE_CHANGE','true'))){
    return {...priority,capability:'coding',surface,assignedExecutor:'',preferredEmployee:preferred,route:'CODING',workerId:null,autonomous:true};
  }
  if(cap==='review'){
    if(preferred){
      if(UI_ROLE_WORKERS.includes(preferred))return {...priority,capability:cap,surface,assignedExecutor:'',preferredEmployee:preferred,route:'UI',workerId:preferred,autonomous:CORE_ROUTED_UI_WORKERS.includes(preferred)};
      const specialist=reviewSpecialistRoute(text,preferred);
      if(specialist.allowed)return {...priority,capability:cap,surface,assignedExecutor:'',preferredEmployee:preferred,route:'CORE_REVIEW',workerId:preferred,autonomous:true,reviewRoutingReason:specialist.reason};
      return primaryReviewRoute(priority,cap,preferred);
    }
    return primaryReviewRoute(priority,cap);
  }
  if(cap==='research'||cap==='deep_research'||surface==='RESEARCH'){
    if(preferred){
      if(UI_ROLE_WORKERS.includes(preferred))return {...priority,capability:'research',surface,assignedExecutor:'',preferredEmployee:preferred,route:'UI',workerId:preferred,autonomous:CORE_ROUTED_UI_WORKERS.includes(preferred)};
      return {...priority,capability:'research',surface,assignedExecutor:'',preferredEmployee:preferred,route:'CORE_REASONING',workerId:preferred,autonomous:true};
    }
    return {...priority,capability:'research',surface,assignedExecutor:'',preferredEmployee:'',route:'UI',workerId:'NV04',autonomous:true};
  }
  if(surface==='UI'){
    const worker=cap==='review'?'NV03':(cap==='research'||cap==='deep_research')?'NV04':'NV02';
    return {...priority,capability:cap,surface,assignedExecutor:'',preferredEmployee:preferred,route:'UI',workerId:worker,autonomous:CORE_ROUTED_UI_WORKERS.includes(worker)};
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
  if(CORE_ROUTED_UI_WORKERS.includes(id))return [
    id+' — CORE_ROUTED_UI=true.',
    'Continue the current Core assignment if present; otherwise remain READY for Core to assign the next eligible P1-P5 role-matched Work Order.',
    'Do not scan or self-claim GitHub backlog locally. App Chrome is transport/continuity only.',
    'P0 and hard-gated work remain Owner-only/fail-closed.',
  ].join(' ');
  return [
    id+' — UI_WORKER_EXTERNAL_TO_CORE=true.',
    'Core does not select backlog for this worker.',
    'Command 02: active CURRENT_WORK_ORDER plus checkpoint means resume; terminal/no-current means local GitHub self-pull exactly one eligible P1-P5 item for NV02.',
    'Use NV02_LOCAL_GITHUB_SELF_PULL=P1_P5_ONLY with lease, evidence, release, then continue to the next eligible item.',
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
