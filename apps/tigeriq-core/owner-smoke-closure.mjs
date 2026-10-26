// Only the authenticated, no-side-effect Owner intake smoke may close here.
// A worker's DONE flag is never an acceptance receipt for an arbitrary Work Order.
import { createHash } from 'node:crypto';
import { verifiedOwnerReceiptForChild, verifiedOwnerTriageNativeJob } from '../shared/owner-work-dispatch.mjs';
import { codingIssueCompletionGate } from '../shared/work-order-acceptance-sync.mjs';
import { workOrderChecklistSteps } from './work-order-checklist-hard-gate.mjs';
import { syncAcceptedChecklistStep } from './work-order-step-autosync.mjs';
import {
  acquireSharedResourceLease, heartbeatSharedResourceLease, releaseSharedResourceLease,
} from './shared-resource-lease.mjs';

const PARENT = 5252;
const CHILD = 5290;
const SCOPE = 'TIGERIQ_OWNER_DIRECTIVE_TRIAGE_5252';
const RECEIPT_MARK = 'TIGERIQ_OWNER_SMOKE_STEP_RECEIPT_V1';
const replace = (body, key, value) => {
  const pattern = new RegExp('^' + key + '=[^\\r\\n]*$', 'm');
  if (!pattern.test(body)) throw Error('SMOKE_HEADER_MISSING_' + key);
  return body.replace(pattern, key + '=' + value);
};
const textHash = value => createHash('sha256').update(value).digest('hex');
const bodyValue = (body, key) =>
  String(body || '').match(new RegExp('^' + key + '=([^\\r\\n]+)$', 'm'))?.[1]?.trim() || '';

export function ownerSmokeNativeGate({issue, originalReceipt, job} = {}) {
  if (Number(issue?.number) !== CHILD || issue?.state !== 'open')
    return {ok:false, reason:'NOT_OPEN_CANONICAL_CHILD'};
  const body = String(issue.body || '');
  if (bodyValue(body,'SOURCE') !== 'AUTHENTICATED_OWNER_WORK_CARD'
    || bodyValue(body,'PARENT_ISSUE') !== '#' + PARENT
    || bodyValue(body,'RESOURCE_SCOPE') !== SCOPE
    || bodyValue(body,'NO_CODE_CHANGE') !== 'true'
    || bodyValue(body,'NO_RDC') !== 'true'
    || bodyValue(body,'NO_PRODUCTION_RELEASE') !== 'true'
    || bodyValue(body,'DONE') !== 'false')
    return {ok:false,reason:'OWNER_SMOKE_SCOPE_GUARD'};
  const steps = workOrderChecklistSteps(body);
  if (!steps.found || steps.steps.length !== 2
    || steps.steps[0].id !== 'R01' || steps.steps[1].id !== 'R02')
    return {ok:false,reason:'OWNER_SMOKE_CHECKLIST_UNEXPECTED'};
  let verified;
  try { verified = verifiedOwnerReceiptForChild(body, originalReceipt?.body); }
  catch { return {ok:false,reason:'AUTHENTIC_OWNER_RECEIPT_MISSING'}; }
  if (verified.parentIssueNumber !== PARENT || verified.message !== 'Thử gửi yêu cầu'
    || verified.receiptUrl !== bodyValue(body,'OWNER_REQUEST_RECEIPT'))
    return {ok:false,reason:'OWNER_SMOKE_REQUEST_NOT_EXACT'};
  if (!verifiedOwnerTriageNativeJob(job, SCOPE))
    return {ok:false,reason:'NATIVE_CORE_WORKER_NOT_ACCEPTED'};
  const output = typeof job.result?.text === 'string' ? job.result.text.trim() : '';
  const expected = job.result?.autoworkAcceptance;
  if (!output || textHash(output) !== expected?.textSha256
    || output.length !== expected?.characterCount)
    return {ok:false,reason:'WORKER_TEXT_HASH_MISMATCH'};
  // A short generic completion or a job that never saw the original Owner
  // request cannot be accepted as a completed R01/R02 triage.
  if (!output.includes(verified.message))
    return {ok:false,reason:'OWNER_MESSAGE_ABSENT_FROM_NATIVE_RESULT'};
  const start = Date.parse(String(job.started_at || ''));
  const end = Date.parse(String(job.completed_at || ''));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start
    || end > Date.now() + 60000)
    return {ok:false,reason:'NATIVE_TIME_PROVENANCE_INVALID'};
  return {ok:true,reason:'EXACT_AUTHENTICATED_SMOKE_AND_NATIVE_RESULT',
    scope:SCOPE, jobId:String(job.id), employeeId:job.employee_id,
    resourceId:job.resource_id, nativeHash:expected.textSha256,
    startedAt:new Date(start).toISOString(), sourceReceipt:verified.receiptUrl};
}

export function ownerSmokeTerminalBody({issue, startUrl, finishUrl, startedAt, finishedAt} = {}) {
  let body = String(issue?.body || '');
  const steps = workOrderChecklistSteps(body);
  if (!steps.found || steps.steps.length !== 2 || steps.steps.some(s=>!s.checked||s.evidenceUrls.length<1))
    return {ok:false,reason:'SMOKE_STEPS_NOT_VERIFIED'};
  if (!/^https:\/\/github\.com\/newsdayads\/tigeriq-ai-lab\/issues\/5290#issuecomment-\d+$/.test(startUrl)
    || !/^https:\/\/github\.com\/newsdayads\/tigeriq-ai-lab\/issues\/5290#issuecomment-\d+$/.test(finishUrl))
    return {ok:false,reason:'SMOKE_SOURCE_RECEIPTS_NOT_CANONICAL'};
  if (!Number.isFinite(Date.parse(startedAt)) || !Number.isFinite(Date.parse(finishedAt)))
    return {ok:false,reason:'SMOKE_TIMES_INVALID'};
  for (const [key,value] of [
    ['DONE','true'],['CURRENT_STATE','DONE_VERIFIED_OWNER_SMOKE'],
    ['CURRENT_STEP','R02 — accepted'],['LAST_COMPLETED_STEP','R02'],
    ['NEXT_ACTION','NONE'],['BLOCKER','NONE'],
    ['STARTED_AT',startedAt],['FINISHED_AT',finishedAt],['ETA_STATUS','NOT_APPLICABLE'],
  ]) body = replace(body,key,value);
  for (const [key,url] of [['START_RECEIPT_URL',startUrl],['FINISH_RECEIPT_URL',finishUrl]]) {
    const line=key+'='+url;
    if (new RegExp('^'+key+'=', 'm').test(body))body=replace(body,key,url);
    else body=body.replace(/^FINISHED_AT=[^\r\n]*$/m,match=>match+'\n'+line);
  }
  const gate=codingIssueCompletionGate({...issue,body});
  return gate.canClose ? {ok:true,body} : {ok:false,reason:'SMOKE_CLOSURE_GATE_REJECTED',missing:gate.missing};
}

// I/O injection makes native lease and GitHub readback independently testable.
// This function never creates an AI job, retries a model, or touches other cards.
export async function reconcileVerifiedOwnerSmoke({
  pool, sourceIssue, originalReceipt, job, io, leaseApi = {
    acquire:acquireSharedResourceLease,heartbeat:heartbeatSharedResourceLease,
    release:releaseSharedResourceLease,
  }, now = () => new Date().toISOString(),
} = {}) {
  const gate=ownerSmokeNativeGate({issue:sourceIssue,originalReceipt,job});
  if (!gate.ok) return gate;
  if (!pool || !io || !['readIssue','readComment','createComment','writeIssue']
    .every(key=>typeof io[key]==='function'))
    return {ok:false,reason:'SMOKE_IO_UNAVAILABLE'};
  const lease=await leaseApi.acquire(pool,{
    employeeId:gate.employeeId,resourceId:gate.resourceId,
    workId:'OWNER-SMOKE-ACCEPT-'+CHILD+'-'+gate.jobId,
    role:'acceptance',lane:'github_owner_smoke',ttlMs:180000,
    metadata:{issueNumber:CHILD,resourceScope:SCOPE},
  });
  if (!lease?.lease_token || lease.resource_id !== gate.resourceId)
    return {ok:false,reason:'SMOKE_EXCLUSIVE_LEASE_UNAVAILABLE'};
  const valid = async () => {
    const alive=await leaseApi.heartbeat(pool,{resourceId:lease.resource_id,leaseToken:lease.lease_token,ttlMs:180000});
    return alive===true ? {valid:true,resourceScope:SCOPE,leaseId:lease.lease_token}
      : {valid:false,resourceScope:SCOPE,leaseId:lease.lease_token};
  };
  let outcome={ok:false,reason:'SMOKE_NOT_COMPLETED'},releaseVerified=false;
  try {
    const urls={};
    for (const stepId of ['R01','R02']) {
      const fresh=await io.readIssue(CHILD);
      if(fresh?.state!=='open')throw Error('SOURCE_CLOSED_OR_CHANGED');
      const current=workOrderChecklistSteps(fresh.body).steps.find(s=>s.id===stepId);
      if(!current)throw Error('STEP_NOT_FOUND_'+stepId);
      let evidenceUrl=current.checked?current.evidenceUrls[0]:null;
      if(!evidenceUrl){
        // Exactly one provenance receipt per stage; on uncertain retry a
        // connector can find the prior receipt by the deterministic marker.
        const signature=RECEIPT_MARK+'\nWORK_ORDER=#'+CHILD+'\nSTEP_ID='+stepId+
          '\nNATIVE_JOB_ID='+gate.jobId+'\nNATIVE_TEXT_SHA256='+gate.nativeHash;
        const found=typeof io.findComment==='function'
          ?await io.findComment(CHILD,signature):null;
        if(found?.body?.startsWith(signature))evidenceUrl=found.html_url;
        if(!evidenceUrl){
          if(!(await valid()).valid)throw Error('SMOKE_LEASE_LOST_BEFORE_RECEIPT');
          const created=await io.createComment(CHILD,signature+
            '\nOWNER_RECEIPT='+gate.sourceReceipt+
            '\nRESOURCE_SCOPE='+SCOPE+
            '\nEMPLOYEE_ID='+gate.employeeId+
            '\nNATIVE_START='+gate.startedAt+
            '\nVERIFICATION=ORIGINAL_OWNER_SMOKE_NATIVE_SOURCE_ONLY');
          evidenceUrl=created?.html_url;
        }
      }
      const result=await syncAcceptedChecklistStep({
        issueNumber:CHILD,stepId,evidenceUrl,resourceScope:SCOPE,
        leaseId:lease.lease_token,
        readIssue:io.readIssue,
        verifyEvidence:async({stepId:stage,evidenceUrl:url})=>{
          const comment=await io.readComment(url);
          const expected=RECEIPT_MARK+'\nWORK_ORDER=#'+CHILD+'\nSTEP_ID='+stage+
            '\nNATIVE_JOB_ID='+gate.jobId+'\nNATIVE_TEXT_SHA256='+gate.nativeHash;
          return {verified:comment?.html_url===url && String(comment.body||'').startsWith(expected)
            && String(comment.body||'').includes('OWNER_RECEIPT='+gate.sourceReceipt),
            stepId:stage,evidenceUrl:url,resourceScope:SCOPE,workOrder:'#'+CHILD};
        },
        assertWriter:valid,
        writeIssue:async(id,body)=>{
          if(!(await valid()).valid)throw Error('SMOKE_LEASE_LOST_BEFORE_GITHUB_WRITE');
          await io.writeIssue(id,{body});
        },
      });
      if(!result.ok)throw Error('SMOKE_STEP_'+stepId+'_'+result.reason);
      urls[stepId]=evidenceUrl;
    }
    const latest=await io.readIssue(CHILD);
    if(!(await valid()).valid)throw Error('SMOKE_LEASE_LOST_BEFORE_CLOSE');
    const terminal=ownerSmokeTerminalBody({
      issue:latest,startUrl:urls.R01,finishUrl:urls.R02,
      startedAt:gate.startedAt,finishedAt:now(),
    });
    if(!terminal.ok)throw Error('SMOKE_TERMINAL_'+terminal.reason);
    await io.writeIssue(CHILD,{body:terminal.body,state:'closed',state_reason:'completed'});
    const readback=await io.readIssue(CHILD);
    if(readback?.state!=='closed' || readback?.state_reason!=='completed'
      || !codingIssueCompletionGate(readback).canClose)
      throw Error('SMOKE_CLOSED_SOURCE_READBACK_FAILED');
    outcome={ok:true,reason:'SOURCE_CLOSED_VERIFIED',issueNumber:CHILD,
      jobId:gate.jobId,stepReceipts:urls,scope:SCOPE};
  } catch(error){
    outcome={ok:false,reason:String(error?.message||error).slice(0,180)};
  } finally {
    try{releaseVerified=await leaseApi.release(pool,{resourceId:lease.resource_id,leaseToken:lease.lease_token})===true;}
    catch{releaseVerified=false;}
  }
  return {...outcome,leaseReleased:releaseVerified,ok:outcome.ok&&releaseVerified};
}
