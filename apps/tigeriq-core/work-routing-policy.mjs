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
  if(priority.sourcePriority==='P0'&&priority.ownerControlled&&!assigned){
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

export function roleCanPull(workerId,classification,activeLease=null){
  const id=employee(workerId);
  const spec=classification||{};
  if(spec.priority==='P0')return false;
  if(activeLease && activeLease.workerId && activeLease.workerId !== id) return false;
  if(!['P1','P2','P3','P4','P5'].includes(String(spec.priority||'')))return false;
  if(spec.route==='HOLD_OWNER'||spec.route==='CODING'||spec.route==='OPENCLAW')return false;
  if(id==='NV02')return spec.workerId==='NV02'||spec.route==='CORE_REASONING';
  if(id==='NV03')return spec.workerId==='NV03'||spec.route==='CORE_REVIEW';
  if(id==='NV04')return spec.workerId==='NV04';
  return false;
}

export function evaluateAutoDispatch(backlogItems=[], workerLeases={}, faultTracker={}){
  const dispatches=[];
  const faults=[];
  const items = Array.isArray(backlogItems)?backlogItems:[];
  
  for(const item of items){
    const spec = classifyWorkOrder(item.body || item);
    if(spec.priority === 'P0'){
      continue;
    }
    const assignedWorker = spec.workerId || spec.preferredEmployee || 'NV02';
    const lease = workerLeases[assignedWorker];
    const now = Date.now();
    const hasActiveLease = lease && lease.leaseUntilMs > now;
    
    if(hasActiveLease){
      const faultKey = `${assignedWorker}:${item.id || spec.route}`;
      const count = (faultTracker[faultKey] || 0) + 1;
      faults.push({type: 'ROUTING_FAULT', workerId: assignedWorker, itemId: item.id || null, count, message: 'Worker has active lease, preventing duplicate assignment'});
      if(count <= 3){
        continue;
      }
    }
    
    if(roleCanPull(assignedWorker, spec, lease)){
      dispatches.push({workerId: assignedWorker, classification: spec, item});
    }
  }
  return {dispatches, faults};
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
    'Never auto-pull P0. Never touch App Chrome mutation scope. Never take work already owned/leased or with overlapping RESOURCE_SCOPE.',
    'Before fallback work, post [TIGERIQ_ROLE_CLAIM_V1] with WORKER='+id+', RESOURCE_SCOPE=<scope>, LEASE_UNTIL=<ISO within 30 minutes>; renew if still working. On handoff/wait/terminal, post [TIGERIQ_ROLE_RELEASE_V1].',
    'NV02 may take general/reasoning execution; NV03 review/QA only; NV04 research/deep-analysis/second-opinion only.',
    'Work continuously until DONE with evidence, BLOCKED, EXTERNAL_WAIT, or mandatory Owner gate.',
  ].join(' ');
}
