import { OWNER_BACKLOG_ISSUE, parseOwnerBacklogOrder } from './owner-backlog-order.mjs';

export { OWNER_BACKLOG_ISSUE };

function priority(row = {}) {
  const value=String(row?.effectivePriority||row?.priority||'P3').toUpperCase();
  return /^P[0-5]$/.test(value)?value:'P3';
}

function fallbackCompare(a,b) {
  const eligibleA=webControlOwnerEligible(a),eligibleB=webControlOwnerEligible(b);
  if(eligibleA!==eligibleB)return eligibleA?-1:1;
  const rank={P0:0,P1:1,P2:2,P3:3,P4:4,P5:5};
  const delta=(rank[priority(a)]??9)-(rank[priority(b)]??9);
  if(delta)return delta;
  return String(b?.updated_at||b?.updatedAt||'').localeCompare(String(a?.updated_at||a?.updatedAt||''))
    || Number(a?.number||0)-Number(b?.number||0);
}

export function parseWebControlOwnerOrder(body='') {
  return parseOwnerBacklogOrder(body);
}

export function webControlOwnerEligible(row = {}) {
  return row?.closed!==true
    && row?.workKind==='WORK'
    && row?.executable===true
    && /^P[1-5]$/.test(priority(row))
    && String(row?.status||'').toUpperCase()==='OPEN'
    && String(row?.state||'').toUpperCase()!=='CHỜ';
}

export function sortWebControlWorkOrders(rows = [], ownerOrder = []) {
  const order=Array.isArray(ownerOrder)?ownerOrder:[];
  return [...(Array.isArray(rows)?rows:[])].sort((left,right)=>{
    const fallback=fallbackCompare(left,right);
    if(!webControlOwnerEligible(left)||!webControlOwnerEligible(right)||order.length===0)return fallback;
    const l=order.indexOf(Number(left?.number)),r=order.indexOf(Number(right?.number));
    if(l<0&&r<0)return fallback;
    if(l<0)return 1;
    if(r<0)return -1;
    return l-r;
  });
}
