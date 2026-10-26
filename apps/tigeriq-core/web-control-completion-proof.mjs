import { validateWorkOrderLifecycleV2 } from './work-order-lifecycle-v2.mjs';

function field(body,key){
  const match=String(body||'').match(new RegExp('^'+key+'=([^\\r\\n]+)$','m'));
  return match?match[1].trim():'';
}

function structuredProgressConsistency(body,steps=[]){
  if(field(body,'PROGRESS_SOURCE')!=='STRUCTURED_PROGRESS_CHECKLIST'){
    return {consistent:null,declaredCompletedSteps:null,declaredTotalSteps:null};
  }
  const readNumber=(key)=>{
    const value=field(body,key);
    const parsed=Number(value);
    return /^(?:0|[1-9]\\d*)$/.test(value)&&Number.isSafeInteger(parsed)?parsed:null;
  };
  const declaredCompletedSteps=readNumber('PROGRESS_COMPLETED');
  const declaredTotalSteps=readNumber('PROGRESS_TOTAL');
  const checked=steps.filter(step=>step.checked).length;
  return {
    consistent:declaredCompletedSteps!==null&&declaredTotalSteps!==null
      &&declaredTotalSteps===steps.length&&declaredCompletedSteps===checked,
    declaredCompletedSteps,
    declaredTotalSteps,
  };
}

// Bundle-safe equivalent of apps/shared/work-center-history.mjs completionProof.
// Web Control runs from an isolated PC01 directory, so it must depend only on
// modules copied into that atomic bundle.
export function webControlCompletionProof(issue={}){
  const checked=validateWorkOrderLifecycleV2(issue);
  const body=String(issue?.body||'');
  const progress=structuredProgressConsistency(body,checked.steps);
  const checkedEvidenceSteps=checked.steps.filter(step=>step.checked&&Boolean(step.evidence)).length;
  const isClosed=issue?.state==='closed'&&issue?.state_reason==='completed';
  const verified=isClosed&&checked.required===true&&checked.valid===true
    &&field(body,'DONE').toLowerCase()==='true'
    &&checked.timestamps?.finishVerified===true
    &&checked.steps.length>=2
    &&checked.steps.every(step=>step.checked&&Boolean(step.evidence))
    &&progress.consistent!==false;
  return {
    verified,
    timing:checked.timestamps,
    contract:{required:checked.required,valid:checked.valid,missing:checked.missing},
    checkedSteps:checked.steps.length,
    checkedEvidenceSteps,
    verifiedSteps:progress.consistent===false?null:checkedEvidenceSteps,
    ...progress,
  };
}
