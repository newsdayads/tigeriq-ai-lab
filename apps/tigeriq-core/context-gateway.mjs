const DEFAULT_BUDGET_BYTES=8000;
const DEFAULT_HEADROOM_BYTES=2000;
const MAX_HISTORY_ITEMS=8;
const MAX_EVIDENCE_REFS=6;

function byteLength(value){return Buffer.byteLength(String(value??''),'utf8');}

function jsonByteLength(value){
  try{return byteLength(JSON.stringify(value));}
  catch{return Number.POSITIVE_INFINITY;}
}

function truncateUtf8(value,maxBytes){
  const text=String(value??'');
  if(maxBytes<=0)return '';
  if(byteLength(text)<=maxBytes)return text;
  let low=0,high=text.length;
  while(low<high){
    const mid=Math.ceil((low+high)/2);
    if(byteLength(text.slice(0,mid))<=maxBytes)low=mid;
    else high=mid-1;
  }
  return text.slice(0,low);
}

function compactScalar(value,maxBytes=900){
  if(value==null)return null;
  if(typeof value==='string')return truncateUtf8(value,maxBytes);
  if(typeof value==='number'||typeof value==='boolean')return value;
  try{return truncateUtf8(JSON.stringify(value),maxBytes);}
  catch{return truncateUtf8(String(value),maxBytes);}
}

function collectEvidenceRefs(value,out=[],seen=new Set(),depth=0){
  if(out.length>=MAX_EVIDENCE_REFS||value==null||depth>5)return out;
  if(typeof value==='string'){
    const refs=value.match(/https?:\/\/[^\s"'<>]+|#[0-9]{1,7}\b|\b[0-9a-f]{7,40}\b/gi)||[];
    for(const ref of refs){if(!out.includes(ref)){out.push(ref);if(out.length>=MAX_EVIDENCE_REFS)break;}}
    return out;
  }
  if(typeof value!=='object')return out;
  if(seen.has(value))return out;
  seen.add(value);
  for(const [key,child] of Object.entries(value)){
    if(/evidence|url|ref|sha|commit|issue|pr/i.test(key)){
      const scalar=compactScalar(child,500);
      if(scalar!=null){
        const text=typeof scalar==='string'?scalar:JSON.stringify(scalar);
        if(text&&!out.includes(text)){out.push(text);if(out.length>=MAX_EVIDENCE_REFS)break;}
      }
    }
    collectEvidenceRefs(child,out,seen,depth+1);
    if(out.length>=MAX_EVIDENCE_REFS)break;
  }
  return out;
}

function compactOutcome(value,maxBytes){
  if(value==null)return null;
  if(typeof value==='string')return truncateUtf8(value,maxBytes);
  if(typeof value!=='object')return compactScalar(value,maxBytes);
  const preferred=['summary','text','message','reason','status','code','result','outcome'];
  const parts=[];
  for(const key of preferred){
    if(value[key]==null)continue;
    const scalar=compactScalar(value[key],Math.max(120,Math.floor(maxBytes/2)));
    if(scalar!==null&&scalar!=='')parts.push(`${key}=${typeof scalar==='string'?scalar:JSON.stringify(scalar)}`);
    if(parts.length>=3)break;
  }
  if(!parts.length)return compactScalar(value,maxBytes);
  return truncateUtf8(parts.join(' | '),maxBytes);
}

export function normalizeManagerHistoryRow(row,index=0){
  const source=row&&typeof row==='object'?row:{};
  const evidenceRefs=collectEvidenceRefs([source.result,source.failure]);
  return {
    index:Number(index)||0,
    title:truncateUtf8(source.title||'untitled',240),
    status:truncateUtf8(source.status||'unknown',48),
    worker:truncateUtf8(source.employee_id||source.worker||'',80)||null,
    provider:truncateUtf8(source.provider||'',80)||null,
    resource:truncateUtf8(source.resource_id||'',160)||null,
    result:compactOutcome(source.result,900),
    failure:compactOutcome(source.failure,700),
    evidenceRefs,
  };
}

function slimRow(row){
  return {
    title:row.title,
    status:row.status,
    worker:row.worker,
    provider:row.provider,
    evidenceRefs:row.evidenceRefs,
  };
}

export function buildManagerHistoryContext(history,options={}){
  const rows=Array.isArray(history)?history.slice(0,MAX_HISTORY_ITEMS):[];
  const budgetBytes=Math.max(1024,Math.min(20000,Number(options.budgetBytes||DEFAULT_BUDGET_BYTES)));
  const requestedHeadroom=Math.max(0,Number(options.headroomBytes??DEFAULT_HEADROOM_BYTES));
  const headroomBytes=Math.min(requestedHeadroom,budgetBytes-256);
  const effectiveBudgetBytes=budgetBytes-headroomBytes;
  let bytesBefore=0;
  try{bytesBefore=byteLength(JSON.stringify(rows));}catch{bytesBefore=0;}

  const accepted=[];
  let droppedCount=0,truncatedCount=0;
  for(let i=0;i<rows.length;i++){
    const normalized=normalizeManagerHistoryRow(rows[i],i);
    const fullJson=JSON.stringify(normalized);
    const candidate=JSON.stringify([...accepted,normalized]);
    if(byteLength(candidate)<=effectiveBudgetBytes){
      accepted.push(normalized);
      if(byteLength(fullJson)<jsonByteLength(rows[i]??{}))truncatedCount++;
      continue;
    }
    const slim=slimRow(normalized);
    const slimCandidate=JSON.stringify([...accepted,slim]);
    if(byteLength(slimCandidate)<=effectiveBudgetBytes){
      accepted.push(slim);
      truncatedCount++;
    }else{
      droppedCount++;
    }
  }

  let text=JSON.stringify(accepted);
  if(byteLength(text)>effectiveBudgetBytes){
    text='[]';
    droppedCount=rows.length;
    truncatedCount=0;
  }
  return {
    text,
    metrics:{
      itemsIn:rows.length,
      itemsOut:accepted.length,
      bytesBefore,
      bytesAfter:byteLength(text),
      budgetBytes,
      headroomBytes,
      effectiveBudgetBytes,
      droppedCount,
      truncatedCount,
      reductionBytes:Math.max(0,bytesBefore-byteLength(text)),
    }
  };
}

export const CONTEXT_GATEWAY_DEFAULTS={
  budgetBytes:DEFAULT_BUDGET_BYTES,
  headroomBytes:DEFAULT_HEADROOM_BYTES,
  maxHistoryItems:MAX_HISTORY_ITEMS,
};
