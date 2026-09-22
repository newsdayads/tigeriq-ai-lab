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
  const match = String(body||'').match(/^ROLE=(.+)$/m);
  return match ? match[1].trim() : '';
}

export function isReviewOnlySpec(body){
  const role = backlogRole(body).toUpperCase();
  if(role === 'REVIEW_ONLY') return true;
  return exactBodyFlag(body, 'REVIEW_ONLY', 'true') || exactBodyFlag(body, 'ROLE', 'REVIEW_ONLY');
}

export function isActiveExecutionSpec(body){
  if(isReviewOnlySpec(body)) return false;
  const role = backlogRole(body).toUpperCase();
  if(role && role !== 'ACTIVE' && role !== 'WRITER' && role !== 'EXECUTOR') return false;
  const execStatus = String(body||'').match(/^EXECUTION_STATUS=(.+)$/m)?.[1]?.trim()?.toUpperCase();
  if(execStatus && execStatus !== 'ACTIVE' && execStatus !== 'READY') return false;
  return true;
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
