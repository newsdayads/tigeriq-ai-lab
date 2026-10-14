// NV02-only source contract: no Core dispatch, Chrome mutation, credentials, or direct GitHub writes.
// A URL / checked box is only an assertion until the original evidence was independently read back.
import {completionProof} from '../shared/work-center-history.mjs';
import {lifecycleSteps,validateWorkOrderLifecycleV2} from './work-order-lifecycle-v2.mjs';

const STEP_ID=/^([A-Z]\d{2})\b/;
const URL=/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/(?:issues|pull|commit)\/[1-9]\d*(?:[/?#][^\s]*)?$/;
const FIELDS=(body)=>Object.fromEntries(String(body||'').split(/\r?\n/).map(x=>x.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map(x=>[x[1],x[2].trim()]));
export const NV02_STEP_CHECKPOINT_MARKER='[TIGERIQ_NV02_STEP_CHECKPOINT_V1]';

function issueRef(issue){return '#'+Number(issue?.number||0)}
function authority(issue,lease){
 const scope=String(issue?.body||'').match(/^RESOURCE_SCOPE=([^\r\n]+)$/m)?.[1]?.trim()||'';
 if(!issue||issue.state!=='open'||Number(issue.number)<1)return 'WORK_ORDER_NOT_OPEN';
 if(!/^NV02-\d+-[0-9a-f-]+$/i.test(String(lease?.leaseId||'')))return 'LEASE_UNVERIFIED';
 if(String(lease?.workOrder||'')!==issueRef(issue)||String(lease?.resourceScope||'')!==scope||!scope)return 'LEASE_SCOPE_MISMATCH';
 return '';
}
function activeLeaseInComments(comments,lease){
 // Caller must supply freshly fetched canonical comments; this does not substitute for a cross-scope CAS.
 const sorted=[...(Array.isArray(comments)?comments:[])].sort((a,b)=>Number(a.id||0)-Number(b.id||0));
 let active=false;
 for(const row of sorted){
  const b=String(row?.body||''), f=FIELDS(b);
  if(!b.includes(String(lease.leaseId)))continue;
  if(b.includes('[TIGERIQ_NV02_LEASE_V1]')&&f.LEASE_ID===lease.leaseId&&f.RESOURCE_SCOPE===lease.resourceScope)active=Date.parse(f.EXPIRES_AT||'')>Date.now();
  if(b.includes('[TIGERIQ_NV02_RELEASE_V1]')&&f.LEASE_ID===lease.leaseId)active=false;
 }
 return active;
}
export function nv02StepUpdatePlan({issue,lease,comments=[],stepId,evidenceUrl,evidenceReadbackVerified=false}={}){
 const err=authority(issue,lease);
 if(err)return {ok:false,reason:err};
 if(!activeLeaseInComments(comments,lease))return {ok:false,reason:'LIVE_LEASE_RECEIPT_REQUIRED'};
 if(evidenceReadbackVerified!==true||!URL.test(String(evidenceUrl||'')))return {ok:false,reason:'ORIGINAL_EVIDENCE_READBACK_REQUIRED'};
 const contract=validateWorkOrderLifecycleV2(issue);
 if(!contract.required||!contract.valid)return {ok:false,reason:'WORK_ORDER_V2_INVALID'};
 const step=String(stepId||'').toUpperCase(),all=lifecycleSteps(issue.body);
 if(!STEP_ID.test(step)||!all.some(row=>row.title.startsWith(step+' ')))return {ok:false,reason:'STEP_NOT_DECLARED'};
 if(all.some(row=>row.title.startsWith(step+' ')&&row.checked))return {ok:false,reason:'ALREADY_CHECKED'};
 const lines=String(issue.body).split(/\r?\n/);
 let inside=false,changed=0;
 const updated=lines.map(line=>{
  if(/^##\s+STRUCTURED_PROGRESS_CHECKLIST\b/.test(line)){inside=true;return line}
  if(inside&&(/^##\s+\S/.test(line)||/^---+\s*$/.test(line))){inside=false;return line}
  if(!inside||!new RegExp('^\\s*[-*] \\[ \\] '+step+'\\b').test(line))return line;
  changed++;
  return line.replace('[ ]','[x]')+' — [Biên nhận đã đối chiếu]('+evidenceUrl+')';
 });
 if(changed!==1)return {ok:false,reason:'STEP_AMBIGUOUS'};
 return {ok:true,stepId:step,expectedBody:issue.body,updatedBody:updated.join('\n'),receiptUrl:evidenceUrl,
   requirement:'RECHECK_GITHUB_BODY_AND_SAME_LEASE_AFTER_WRITE'};
}
export function nv02PrecloseGate({issue,lease,comments=[],verifiedEvidenceIds=[],checks={},externalReviewRequired=true,runtimeRequired=true}={}){
 const err=authority(issue,lease);
 if(err)return {ok:false,reason:err};
 if(!activeLeaseInComments(comments,lease))return {ok:false,reason:'LIVE_LEASE_RECEIPT_REQUIRED'};
 const validation=validateWorkOrderLifecycleV2(issue);
 if(!validation.valid||!validation.required)return {ok:false,reason:'WORK_ORDER_V2_INVALID'};
 const steps=lifecycleSteps(issue.body);
 if(steps.length<2||steps.some(s=>!s.checked||!s.evidence))return {ok:false,reason:'UNCHECKED_STEPS'};
 const verified=new Set(Array.isArray(verifiedEvidenceIds)?verifiedEvidenceIds:[]);
 if(steps.some(s=>!verified.has(s.evidence)))return {ok:false,reason:'ORIGINAL_EVIDENCE_NOT_VERIFIED'};
 if(checks.exactHead!==true||checks.requiredCi!==true)return {ok:false,reason:'EXACT_HEAD_OR_CI_NOT_VERIFIED'};
 if(externalReviewRequired!==false&&checks.independentReview!==true)return {ok:false,reason:'INDEPENDENT_REVIEW_NOT_VERIFIED'};
 if(runtimeRequired!==false&&checks.runtimeAcceptance!==true)return {ok:false,reason:'LIVE_RUNTIME_NOT_VERIFIED'};
 if(checks.ownerGateSatisfied!==true)return {ok:false,reason:'OWNER_GATE_NOT_VERIFIED'};
 return {ok:true,decision:'PREPARE_FINAL_RECEIPT_THEN_CLOSE_COMPLETED',
   requirement:'FINISHED_AT_AND_FINISH_RECEIPT_URL_THEN_GITHUB_CLOSED_COMPLETED_READBACK'};
}
export function nv02TerminalReadback({issue,lease,comments=[]}={}){
 // A chat response or arbitrary STATE=DONE comment is never sufficient.
 if(completionProof(issue).verified)return {state:'DONE',verified:true,releaseRequired:true};
 if(!issue||issue.state!=='open'||!lease?.leaseId)return {state:'UNVERIFIED',verified:false};
 const matching=[...(Array.isArray(comments)?comments:[])].filter(c=>{
   const body=String(c.body||'');
   if(!body.startsWith(NV02_STEP_CHECKPOINT_MARKER))return false;
   const f=FIELDS(body);
   return f.WORK_ORDER===issueRef(issue)&&f.LEASE_ID===lease.leaseId
     &&f.RESOURCE_SCOPE===lease.resourceScope
     &&['BLOCKED','EXTERNAL_WAIT'].includes(f.STATE)
     &&String(f.BLOCKER||'').length>3
     &&URL.test(f.EVIDENCE_URL||'')
     &&f.EVIDENCE_READBACK_VERIFIED==='true';
 });
 if(!matching.length)return {state:'UNVERIFIED',verified:false};
 const latest=matching.sort((a,b)=>Number(b.id||0)-Number(a.id||0))[0];
 const f=FIELDS(latest.body);
 return {state:f.STATE,verified:true,releaseRequired:true,evidenceUrl:f.EVIDENCE_URL};
}
