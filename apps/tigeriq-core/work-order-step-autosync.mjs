// Bounded write-after-acceptance transaction. Comments alone are never runtime proof.
import {workOrderChecklistGate,workOrderChecklistSteps} from './work-order-checklist-hard-gate.mjs';
const STEP_ID=/^[A-Z][A-Z0-9_-]{1,15}$/;
const GH_EVIDENCE=/^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/(?:issues\/\d+#issuecomment-\d+|pull\/\d+(?:[/?#][A-Za-z0-9_.\/?=#-]+)?|commit\/[a-f0-9]{40})$/i;
const scopeOf=body=>String(body||'').match(/^RESOURCE_SCOPE=([^\r\n]+)$/m)?.[1]?.trim()||'';
export function planAcceptedChecklistStep({issue,stepId,evidenceUrl,resourceScope}={}){
 if(!issue||issue.state!=='open'||!Number.isSafeInteger(Number(issue.number))||Number(issue.number)<1)return {ok:false,reason:'OPEN_WORK_ORDER_REQUIRED'};
 const id=String(stepId||'').trim().toUpperCase(),url=String(evidenceUrl||'').trim();
 if(!STEP_ID.test(id))return {ok:false,reason:'STEP_ID_INVALID'};
 const u=url.match(GH_EVIDENCE);
 if(!u||(u[1]+'/'+u[2]).toLowerCase()!=='newsdayads/tigeriq-ai-lab')return {ok:false,reason:'CANONICAL_EVIDENCE_URL_REQUIRED'};
 if(!resourceScope||scopeOf(issue.body)!==resourceScope)return {ok:false,reason:'RESOURCE_SCOPE_MISMATCH'};
 const parsed=workOrderChecklistSteps(issue.body);
 if(!parsed.found||!parsed.steps.length)return {ok:false,reason:'CHECKLIST_MISSING'};
 if(new Set(parsed.steps.map(s=>s.id)).size!==parsed.steps.length)return {ok:false,reason:'DUPLICATE_STEP_ID'};
 const selected=parsed.steps.filter(s=>s.id===id);
 if(selected.length!==1)return {ok:false,reason:'STEP_NOT_DECLARED'};
 const step=selected[0];
 if(step.checked){
  const good=step.evidenceUrls.includes(url);
  return good?{ok:true,alreadyChecked:true,newBody:issue.body,stepId:id,evidenceUrl:url}
   :{ok:false,reason:'STEP_ALREADY_CHECKED_DIFFERENT_EVIDENCE'};
 }
 if(step.evidenceUrls.length)return {ok:false,reason:'UNCHECKED_WITH_EXISTING_EVIDENCE_REVIEW_REQUIRED'};
 const lines=issue.body.split(/\r?\n/);
 let hits=0;
 const result=lines.map(line=>{
  if(line!==step.line)return line;
  hits++;
  return line.replace('[ ]','[x]')+' — [Biên nhận nghiệm thu]('+url+')';
 });
 if(hits!==1)return {ok:false,reason:'STEP_LINE_AMBIGUOUS'};
 const newBody=result.join('\n');
 const check=workOrderChecklistGate({...issue,body:newBody},{stepId:id,expectedEvidenceUrl:url,requireAll:false});
 if(!check.ok)return {ok:false,reason:'CHECKLIST_PATCH_INVALID_'+check.reason};
 return {ok:true,alreadyChecked:false,newBody,stepId:id,evidenceUrl:url};
}
export async function syncAcceptedChecklistStep({
 issueNumber,stepId,evidenceUrl,resourceScope,leaseId,
 readIssue,verifyEvidence,assertWriter,writeIssue
}={}){
 const id=Number(issueNumber);
 if(!Number.isSafeInteger(id)||id<1||!leaseId||!resourceScope||
    ![readIssue,verifyEvidence,assertWriter,writeIssue].every(f=>typeof f==='function'))
  return {ok:false,reason:'SCOPED_IO_AND_LEASE_REQUIRED'};
 try{
  let issue=await readIssue(id);
  const plan=planAcceptedChecklistStep({issue,stepId,evidenceUrl,resourceScope});
  if(!plan.ok)return plan;
  const proof=await verifyEvidence({issue,stepId:plan.stepId,evidenceUrl:plan.evidenceUrl,resourceScope,leaseId});
  if(proof?.verified!==true||proof?.stepId!==plan.stepId||proof?.evidenceUrl!==plan.evidenceUrl
     ||proof?.resourceScope!==resourceScope||proof?.workOrder!=='#'+id)
   return {ok:false,reason:'ORIGINAL_STEP_ACCEPTANCE_NOT_VERIFIED'};
  const first=await assertWriter({issue,resourceScope,leaseId});
  if(first?.valid!==true||first?.resourceScope!==resourceScope||first?.leaseId!==leaseId)
   return {ok:false,reason:'ATOMIC_WRITER_AUTHORITY_REQUIRED'};
  if(!plan.alreadyChecked){
   // GitHub Issue PATCH has no native CAS. A verified exclusive writer lease is mandatory.
   issue=await readIssue(id);
   const fresh=planAcceptedChecklistStep({issue,stepId,evidenceUrl,resourceScope});
   if(!fresh.ok)return fresh;
   const second=await assertWriter({issue,resourceScope,leaseId});
   if(second?.valid!==true||second?.resourceScope!==resourceScope||second?.leaseId!==leaseId)
    return {ok:false,reason:'WRITER_LEASE_LOST_BEFORE_WRITE'};
   if(!fresh.alreadyChecked)await writeIssue(id,fresh.newBody,{leaseId,resourceScope,expectedBody:issue.body});
  }
  const readback=await readIssue(id);
  const gate=workOrderChecklistGate(readback,{stepId:plan.stepId,expectedEvidenceUrl:plan.evidenceUrl,requireAll:false});
  if(!gate.ok)return {ok:false,reason:'POST_WRITE_READBACK_FAILED_'+gate.reason};
  return {ok:true,stepId:plan.stepId,issueNumber:id,evidenceUrl:plan.evidenceUrl,
   alreadyChecked:plan.alreadyChecked,readbackVerified:true,scope:'STEP_ONLY'};
 }catch(error){return {ok:false,reason:'GITHUB_STEP_SYNC_ERROR',error:String(error?.message||error).slice(0,200)};}
}
