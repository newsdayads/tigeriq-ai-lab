const PRIORITY_RANK={P0:0,P1:1,P2:2,P3:3};

function escapeRe(value){return String(value).replace(/[.*+?^\${}()|[\]\\]/g,'\\$&');}

export function exactBodyFlag(body,key,value='true'){
  return new RegExp(`^${escapeRe(key)}=${escapeRe(value)}$`,'m').test(String(body||''));
}

export function backlogPriority(body,fallback='P2'){
  return String(body||'').match(/^PRIORITY=(P[0-3])$/m)?.[1]||fallback;
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
    if(!new RegExp('^##\\s+'+section+'\\s*
export function compareBacklogSpecs(a,b){
  const ownerA=Boolean(a?.ownerDirect),ownerB=Boolean(b?.ownerDirect);
  if(ownerA!==ownerB)return ownerA?-1:1;
  const pa=PRIORITY_RANK[a?.sourcePriority||a?.priority]??PRIORITY_RANK.P2;
  const pb=PRIORITY_RANK[b?.sourcePriority||b?.priority]??PRIORITY_RANK.P2;
  if(pa!==pb)return pa-pb;
  return Number(a?.number||0)-Number(b?.number||0);
}

export function sortBacklogSpecs(specs){
  return (Array.isArray(specs)?specs:[]).filter(Boolean).slice().sort(compareBacklogSpecs);
}

export function detectIdleWithBacklog(activeCount, pendingQueueCount){
  return Number(activeCount || 0) === 0 && Number(pendingQueueCount || 0) > 0;
}
,'mi').test(text))missing.push(section);
  }
  return missing;
}

export function isActiveExecutionSpec(body){
  if(isReviewOnlySpec(body))return false;
  if(!isExecutionContractV1(body))return true;
  return executionContractV1Missing(body).length===0;
}

export function compareBacklogSpecs(a,b){
  const ownerA=Boolean(a?.ownerDirect),ownerB=Boolean(b?.ownerDirect);
  if(ownerA!==ownerB)return ownerA?-1:1;
  const pa=PRIORITY_RANK[a?.sourcePriority||a?.priority]??PRIORITY_RANK.P2;
  const pb=PRIORITY_RANK[b?.sourcePriority||b?.priority]??PRIORITY_RANK.P2;
  if(pa!==pb)return pa-pb;
  return Number(a?.number||0)-Number(b?.number||0);
}

export function sortBacklogSpecs(specs){
  return (Array.isArray(specs)?specs:[]).filter(Boolean).slice().sort(compareBacklogSpecs);
}

export function detectIdleWithBacklog(activeCount, pendingQueueCount){
  return Number(activeCount || 0) === 0 && Number(pendingQueueCount || 0) > 0;
}
