/* Bundle-safe Web Control completion verifier.
 * Reuses the canonical Lifecycle V2 parser from the same atomic runtime bundle.
 * Keep semantic parity with apps/shared/work-center-history.mjs::completionProof. */
import { validateWorkOrderLifecycleV2 } from './work-order-lifecycle-v2.mjs';

function val(body,key){
  const m=String(body||'').match(new RegExp('^'+key+'=([^\\r\\n]+)$','m'));
  return m?m[1].trim():'';
}

export function structuredProgressConsistency(body,steps=[]){
  if(val(body,'PROGRESS_SOURCE')!=='STRUCTURED_PROGRESS_CHECKLIST')
    return {consistent:null,declaredCompletedSteps:null,declaredTotalSteps:null};
  const number=(key)=>{
    const value=val(body,key);
    const parsed=Number(value);
    return /^(0|[1-9]\\d*)$/.test(value)&&Number.isSafeInteger(parsed)?parsed:null;
  };
  const declaredCompletedSteps=number('PROGRESS_COMPLETED');
  const declaredTotalSteps=number('PROGRESS_TOTAL');
  const checked=steps.filter(step=>step.checked).length;
  const consistent=declaredCompletedSteps!==null&&declaredTotalSteps!==null
    &&declaredTotalSteps===steps.length&&declaredCompletedSteps===checked;
  return {consistent,declaredCompletedSteps,declaredTotalSteps};
}

export function completionProof(issue){
  const checked=validateWorkOrderLifecycleV2(issue);
  const body=String(issue?.body||'');
  const progress=structuredProgressConsistency(body,checked.steps);
  const checkedEvidenceSteps=checked.steps.filter(s=>s.checked&&Boolean(s.evidence)).length;
  const isClosed=issue?.state==='closed'&&issue?.state_reason==='completed';
  const verified=isClosed&&checked.required===true&&checked.valid===true
    &&val(body,'DONE').toLowerCase()==='true'
    &&checked.timestamps?.finishVerified===true
    &&checked.steps.length>=2&&checked.steps.every(s=>s.checked&&Boolean(s.evidence))
    &&progress.consistent!==false;
  return {
    verified,
    timing:checked.timestamps,
    contract:{required:checked.required,valid:checked.valid,missing:checked.missing},
    checkedSteps:checked.steps.length,
    checkedEvidenceSteps,
    verifiedSteps:progress.consistent===false?null:checkedEvidenceSteps,
    ...progress
  };
}
