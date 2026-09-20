import { createHash } from 'node:crypto';

export const failureLearningEventTypes=Object.freeze([
  'RESOURCE_FAILURE',
  'RESOURCE_PROBE_FAIL',
  'MANAGER_ERROR',
  'OBJECTIVE_BLOCKED',
  'SURFSENSE_RESEARCH_FAILED'
]);

const PROTECTED_RE=/(credential|secret|security|production|prod\b|paid|billing|destructive|irreversible|auth(?:entication|orization)?)/i;

function compact(value,max=160){
  return String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
}

function normalizedMessage(value){
  return compact(value,140)
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi,'<uuid>')
    .replace(/\b[0-9a-f]{12,64}\b/gi,'<hash>')
    .replace(/\b\d+\b/g,'<n>');
}

export function normalizeFailureEvent(row){
  if(!row||!failureLearningEventTypes.includes(String(row.type||'')))return null;
  if(row.seq===undefined||row.seq===null||!row.ts)return null;
  const data=row.data&&typeof row.data==='object'?row.data:{};
  const message=data.message||data.error||data.detail||data.reason||'';
  const errorCode=compact(data.kind||data.code||data.errorCode||data.reason||normalizedMessage(message)||row.type,120);
  const taskKind=compact(row.task_kind||data.taskKind||data.capability||'general',80);
  const component=compact(data.component||row.resource_id||row.employee_id||data.provider||'core',160);
  const signatureSource=[String(row.type),errorCode.toLowerCase(),taskKind.toLowerCase(),component.toLowerCase()].join('|');
  const signature=createHash('sha256').update(signatureSource).digest('hex');
  const protectedBoundary=PROTECTED_RE.test([errorCode,taskKind,component,message].join(' '));
  return {
    signature,
    eventType:String(row.type),
    errorCode,
    taskKind,
    component,
    protectedBoundary,
    evidenceRef:`event:${row.seq}`,
    occurrence:{
      eventSeq:String(row.seq),
      ts:String(row.ts),
      objectiveId:row.objective_id?String(row.objective_id):null,
      jobId:row.job_id?String(row.job_id):null,
      resourceId:row.resource_id?String(row.resource_id):null,
      employeeId:row.employee_id?String(row.employee_id):null
    }
  };
}

import { processFailure } from './repair-loop.mjs';

export { processFailure };

export function handleFailureDecision(failureId, rawDecision) {
  return processFailure(failureId, rawDecision);
}

export function buildFailureLearningCandidates(events,options={}){
  const minOccurrences=Math.max(2,Number(options.minOccurrences||2));
  const existing=new Set(Array.from(options.existingSignatures||[]).map(String));
  const groups=new Map();
  for(const row of Array.isArray(events)?events:[]){
    const item=normalizeFailureEvent(row);
    if(!item)continue;
    const list=groups.get(item.signature)||[];
    list.push(item);
    groups.set(item.signature,list);
  }
  const out=[];
  for(const [signature,list] of groups){
    if(existing.has(signature)||list.length<minOccurrences)continue;
    const ordered=list.slice().sort((a,b)=>Number(a.occurrence.eventSeq)-Number(b.occurrence.eventSeq));
    const first=ordered[0],last=ordered.at(-1);
    const evidenceRefs=[...new Set(ordered.map(x=>x.evidenceRef))];
    if(evidenceRefs.length<minOccurrences)continue;
    const protectedBoundary=ordered.some(x=>x.protectedBoundary);
    out.push({
      id:`failure-candidate-${signature.slice(0,12)}`,
      signature,
      state:'CANDIDATE',
      occurrenceCount:ordered.length,
      eventType:first.eventType,
      errorCode:first.errorCode,
      taskKind:first.taskKind,
      component:first.component,
      evidenceRefs,
      occurrences:ordered.map(x=>x.occurrence),
      firstSeen:first.occurrence.ts,
      lastSeen:last.occurrence.ts,
      proposedPrevention:`Add a regression guard/check for ${first.errorCode} in ${first.component}.`,
      proposalOnly:true,
      autoPromotionAllowed:false,
      protectedBoundary,
      requiresOwnerAuthorization:protectedBoundary
    });
  }
  return out.sort((a,b)=>b.occurrenceCount-a.occurrenceCount||a.signature.localeCompare(b.signature));
}
