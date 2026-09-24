export const BACKLOG_PRIORITIES=Object.freeze(['P0','P1','P2','P3','P4','P5']);
export const PRIORITY_RANK=Object.freeze({P0:0,P1:1,P2:2,P3:3,P4:4,P5:5});

function escapeRe(value){return String(value).replace(/[.*+?^\${}()|[\]\\]/g,'\\$&');}

export function bodyValue(body,key){
  return String(body||'').match(new RegExp('^'+escapeRe(key)+'=([^\\r\\n]+)$','m'))?.[1]?.trim()||'';
}

export function exactBodyFlag(body,key,value='true'){
  return new RegExp('^'+escapeRe(key)+'='+escapeRe(value)+'$','m').test(String(body||''));
}

export function backlogPriority(body,fallback='P3'){
  const fallbackPriority=BACKLOG_PRIORITIES.includes(String(fallback||'').toUpperCase())?String(fallback).toUpperCase():'P3';
  return String(body||'').match(/^PRIORITY=(P[0-5])$/m)?.[1]||fallbackPriority;
}

export function backlogAssignedExecutor(body){
  const text=String(body||'');
  for(const key of ['ASSIGNED_EXECUTOR','PRIMARY_EMPLOYEE']){
    const value=bodyValue(text,key).toUpperCase();
    if(/^NV\d{2}$/.test(value))return value;
  }
  return '';
}

export function backlogOwnerControlled(body){
  const text=String(body||'');
  return exactBodyFlag(text,'OWNER_CONTROLLED','true')
    || exactBodyFlag(text,'OWNER_GATE','true')
    || exactBodyFlag(text,'OWNER_APPROVAL_REQUIRED','true')
    || Boolean(backlogAssignedExecutor(text));
}

export function effectiveBacklogPriority(body,fallback='P3'){
  const sourcePriority=backlogPriority(body,fallback);
  const ownerControlled=backlogOwnerControlled(body);
  const legacyP0Autonomous=sourcePriority==='P0'&&!ownerControlled;
  return {
    sourcePriority,
    priority:legacyP0Autonomous?'P1':sourcePriority,
    ownerControlled,
    assignedExecutor:backlogAssignedExecutor(body),
    legacyP0Autonomous,
  };
}

export function backlogOwnerDirect(body){
  return exactBodyFlag(body,'OWNER_DIRECT','true');
}

export function backlogRole(body){
  return String(body||'').match(/^ROLE=(.+)$/m)?.[1]?.trim()||'';
}

export function isReviewOnlySpec(body){
  const role=backlogRole(body).toUpperCase();
  return role==='REVIEW_ONLY'||exactBodyFlag(body,'REVIEW_ONLY','true');
}

export function isExecutionContractV1(body){
  const text=String(body||'');
  return /^EXECUTION_POLICY=#1456$/m.test(text)||
    /^EXECUTION_CONTRACT=(?:V1|VERSION_1)$/m.test(text)||
    /^ACTIVE_EXECUTION=/m.test(text)||
    /^CANONICAL_SPEC=/m.test(text);
}

export function executionContractV1Missing(body){
  const text=String(body||'');
  if(!isExecutionContractV1(text))return [];
  const missing=[];
  if(!exactBodyFlag(text,'ACTIVE_EXECUTION','true'))missing.push('ACTIVE_EXECUTION');
  if(!/^CANONICAL_SPEC=#\d+$/m.test(text))missing.push('CANONICAL_SPEC');
  if(!/^RESOURCE_SCOPE=\S.+$/m.test(text))missing.push('RESOURCE_SCOPE');
  if(!/^MUTATION_OWNER=\S.+$/m.test(text))missing.push('MUTATION_OWNER');
  for(const section of ['GOAL','CURRENT_STATE','IN_SCOPE','OUT_OF_SCOPE','NON_NEGOTIABLE_RULES','DEPENDENCIES','EXECUTION_ORDER','ACCEPTANCE','RECOVERY_RULE','STOP_CONDITIONS','EVIDENCE_FORMAT']){
    const heading='## '+section;
    if(!text.split(/\r?\n/).some(line=>line.trim()===heading))missing.push(section);
  }
  return missing;
}

export function isActiveExecutionSpec(body){
  if(isReviewOnlySpec(body))return false;
  if(!isExecutionContractV1(body))return true;
  return executionContractV1Missing(body).length===0;
}

export function compareBacklogSpecs(a,b){
  const pa=PRIORITY_RANK[a?.priority||a?.effectivePriority||a?.sourcePriority]??PRIORITY_RANK.P3;
  const pb=PRIORITY_RANK[b?.priority||b?.effectivePriority||b?.sourcePriority]??PRIORITY_RANK.P3;
  if(pa!==pb)return pa-pb;
  return Number(a?.number||0)-Number(b?.number||0);
}

export function sortBacklogSpecs(specs){
  return (Array.isArray(specs)?specs:[]).filter(Boolean).slice().sort(compareBacklogSpecs);
}

export function detectIdleWithBacklog(activeCount,pendingQueueCount){
  return Number(activeCount||0)===0&&Number(pendingQueueCount||0)>0;
}

export function routingFault({eligibleBacklogCount=0,activeWorkCount=0,eligibleIdleWorkers=0}={}){
  const backlog=Math.max(0,Number(eligibleBacklogCount)||0);
  const active=Math.max(0,Number(activeWorkCount)||0);
  const idle=Math.max(0,Number(eligibleIdleWorkers)||0);
  const fault=backlog>0&&active===0&&idle>0;
  return {fault,eligibleBacklogCount:backlog,activeWorkCount:active,eligibleIdleWorkers:idle,code:fault?'ROUTING_FAULT':'OK'};
}
