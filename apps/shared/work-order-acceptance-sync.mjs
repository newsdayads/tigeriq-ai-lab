/* Q12-C: source-backed completion gate. A Coding job/PR is only a substep. */
import {completionProof} from './work-center-history.mjs';

function headerValue(body,key){
  const escaped=key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return String(body||'').match(new RegExp('^'+escaped+'=([^\\r\\n]*)$','m'))?.[1]?.trim()||'';
}

function missingCompletionEvidence(issue,proof){
  const missing=[...(proof?.contract?.missing||[])];
  const body=String(issue?.body||'');
  if(proof?.contract?.required!==true)missing.push('LIFECYCLE_V2_REQUIRED');
  if(headerValue(body,'DONE').toLowerCase()!=='true')missing.push('DONE_NOT_ACCEPTED');
  if(!proof?.timing?.startVerified)missing.push('START_RECEIPT_MISSING');
  if(!proof?.timing?.finishVerified)missing.push('FINISH_RECEIPT_MISSING');
  if(Number(proof?.checkedSteps||0)<2)missing.push('CHECKLIST_INCOMPLETE');
  else if(proof.checkedEvidenceSteps!==proof.checkedSteps)missing.push('CHECKLIST_STEP_EVIDENCE_MISSING');
  if(proof.consistent===false)missing.push('PROGRESS_COUNTER_MISMATCH');
  return [...new Set(missing)].slice(0,24);
}

/* Evaluate the exact GitHub issue as it would look after a source-authorized
 * completed closure. Never grant closure based on objective.status=completed. */
export function codingIssueCompletionGate(issue={}){
  const candidate={...issue,state:'closed',state_reason:'completed'};
  const proof=completionProof(candidate);
  return {
    canClose:proof.verified===true,
    missing:proof.verified?[]:missingCompletionEvidence(candidate,proof),
  };
}

/* Pure read-only Dashboard diagnosis. Closing GitHub alone is never DONE. */
export function sourceCompletionDiagnostic(issue={}){
  const closed=String(issue?.state||'').toLowerCase()==='closed';
  const proof=completionProof(issue);
  const missing=proof.verified?[]:missingCompletionEvidence(issue,proof);
  return {
    state:proof.verified?'DONE_ACCEPTED':closed?'VERIFY_EVIDENCE_MISSING':'OPEN_NOT_ACCEPTED',
    completionVerified:proof.verified===true,
    sourceClosed:closed,
    sourceDoneDeclared:headerValue(issue?.body,'DONE').toLowerCase()==='true',
    missing,
  };
}

/* Dependency handoff MUST use the canonical accepted outcome, not merely a
 * GitHub "closed/completed" toggle. Legacy pre-V2 tickets keep their historical
 * terminal semantics; V2 work requires all actual lifecycle receipts. */
export function sourceTerminalDependencyAccepted(issue={}){
 if(String(issue?.state||'').toLowerCase()!=='closed'
   ||String(issue?.state_reason||'').toLowerCase()!=='completed')return false;
 const proof=completionProof(issue);
 const explicitlyV2=/^WORK_ORDER_LIFECYCLE=V2$/m.test(String(issue?.body||''));
 if(explicitlyV2&&proof?.verified!==true)return false;
 return proof?.contract?.required!==true||proof?.verified===true;
}
