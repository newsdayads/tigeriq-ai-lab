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

export function evaluateIdleWithBacklogPolicy({ status, activeCount, backlogItems } = {}) {
  const isIdle = String(status || '').toUpperCase() === 'IDLE';
  const hasBacklog = Array.isArray(backlogItems) && backlogItems.length > 0;
  const idleWithBacklog = (isIdle || status === 'IDLE') && Number(activeCount || 0) === 0 && hasBacklog;
  return {
    idleWithBacklog,
    nextEligibleItem: hasBacklog ? sortBacklogSpecs(backlogItems)[0] : null,
    autoDispatched: idleWithBacklog
  };
}
