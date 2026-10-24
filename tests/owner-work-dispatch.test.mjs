import test from 'node:test';
import assert from 'node:assert/strict';
import { boundedOwnerTriageChild, verifiedOwnerReceiptForChild, ownerCoreTriageReceiptPlan, verifiedOwnerTriageNativeJob, ownerTriageCompletionPublicationGate } from '../apps/shared/owner-work-dispatch.mjs';
import { makeOwnerRequestReceipt } from '../apps/shared/owner-work-request.mjs';
import { validateWorkOrderLifecycleV2 } from '../apps/tigeriq-core/work-order-lifecycle-v2.mjs';
import { safeAutoWorkAdmission, parseExecutableIssue } from '../apps/tigeriq-core/github-intake.mjs';
const id='c6b90d64-b49c-4bb9-becb-d696a043ab74';
const request={issueNumber:5252,requestId:id,message:'Kiểm tra trạng thái Core và nêu hướng xử lý mà không đổi mã.'};
const issue={number:5252,state:'open',title:'[P1] Work Center Owner',body:'RESOURCE_SCOPE=TIGERIQ_WORK_CENTER_OWNER_REQUEST_INTAKE_V1\nCURRENT_STATE=WAITING'};
const receiptUrl='https://github.com/newsdayads/tigeriq-ai-lab/issues/5252#issuecomment-6377472036';
test('Owner source receipt converts into a valid bounded P1 read-only Core planning issue',()=>{
 const child=boundedOwnerTriageChild({issue,request,receiptUrl});
 assert.equal(child.parentIssueNumber,5252);
 assert.equal(child.requestId,id);
 assert.ok(child.body.includes('AUTO_QUEUE=INCLUDED'));
 assert.ok(child.body.includes('NO_PAID_COST=true'));
 assert.ok(child.body.includes('NO_PRODUCTION_RELEASE=true'));
 assert.ok(child.body.includes('NO_CREDENTIAL_CHANGE=true'));
 assert.ok(child.body.includes('NO_CODE_CHANGE=true'));
 assert.ok(child.body.includes('OWNER_REQUEST_RECEIPT='+receiptUrl));
 assert.ok(!child.body.includes(request.message),'Never duplicate arbitrary Owner text');
 const proposed={...child,number:900001,state:'open',created_at:'2026-10-24T00:00:00Z',updated_at:'2026-10-24T00:00:00Z',html_url:'https://github.com/newsdayads/tigeriq-ai-lab/issues/900001'};
 const lifecycle=validateWorkOrderLifecycleV2(proposed);
 assert.deepEqual(lifecycle.missing,[]);
 assert.equal(lifecycle.valid,true);
 const admission=safeAutoWorkAdmission(proposed);
 assert.equal(admission.eligible,true,admission.reason+': '+JSON.stringify(admission));
 const parsed=parseExecutableIssue(proposed);
 assert.ok(parsed,'Core must be capable of reading the same existing queue');
 assert.equal(parsed.dispatchLane,'CORE_REASONING');
});
test('fail closed on foreign or unverified issue, malformed receipt or scope',()=>{
 const valid={issue,request,receiptUrl};
 assert.throws(()=>boundedOwnerTriageChild({...valid,issue:{...issue,state:'closed'}}),/invalid_parent/);
 assert.throws(()=>boundedOwnerTriageChild({...valid,issue:{...issue,body:'RESOURCE_SCOPE=INVALID TOKEN'}}),/invalid_scope/);
 assert.throws(()=>boundedOwnerTriageChild({...valid,receiptUrl:'https://attacker.invalid/foo'}),/invalid_receipt/);
 assert.throws(()=>boundedOwnerTriageChild({...valid,request:{...request,issueNumber:2054}}),/invalid_parent/);
});

test('Core must hydrate only exact authenticated Owner receipt, not invented comment text',()=>{
 const child=boundedOwnerTriageChild({issue,request,receiptUrl});
 const receipt=makeOwnerRequestReceipt(request);
 const row=verifiedOwnerReceiptForChild(child.body,receipt);
 assert.equal(row.message,request.message);
 assert.equal(row.parentIssueNumber,5252);
 assert.equal(row.requestId,id);
 assert.equal(row.receiptUrl,receiptUrl);
 assert.throws(()=>verifiedOwnerReceiptForChild(child.body,receipt.replace(id,'00000000-0000-4000-8000-000000000000')),/not_correlated/);
 assert.throws(()=>verifiedOwnerReceiptForChild(child.body,'TIGERIQ_OWNER_REQUEST_RESULT_V1'),/not_correlated/);
 assert.throws(()=>verifiedOwnerReceiptForChild(child.body.replace('PARENT_ISSUE=#5252','PARENT_ISSUE=#999'),receipt),/child_receipt_invalid/);
});

test('Core terminal planning receipt never reports Owner execution VERIFIED',()=>{
 const child=boundedOwnerTriageChild({issue,request,receiptUrl});
 const success=ownerCoreTriageReceiptPlan(child.body,{id:'OBJ-GH-900001',status:'completed',summary:'Đã phân tích nguồn'});
 assert.equal(success.requestId,id);
 assert.equal(success.parentIssueNumber,5252);
 assert.equal(success.status,'PLAN_SHOWN');
 assert.ok(success.reply.includes('CORE_TRIAGE_OBJECTIVE_ID=OBJ-GH-900001'));
 assert.equal(ownerCoreTriageReceiptPlan(child.body,{id:'OBJ-GH-900001',status:'blocked'}).status,'BLOCKED');
 assert.equal(ownerCoreTriageReceiptPlan(child.body,{id:'OBJ-GH-900001',status:'active'}),null);
 assert.equal(ownerCoreTriageReceiptPlan('SOURCE=FORGED', {id:'OBJ-GH-900001',status:'completed'}),null);
});

test('accepted Core output resolves only the exact authenticated intake smoke request',()=>{
 const smoke={...request,message:'Thử gửi yêu cầu'};
 const child=boundedOwnerTriageChild({issue,request:smoke,receiptUrl});
 const completed={id:'OBJ-GH-900001',status:'completed',summary:'Core worker finished reading and answering the exact Owner intake smoke request',nativeCoreJobAccepted:true,githubChecklistAccepted:true};
 const ownerReceipt=makeOwnerRequestReceipt(smoke);
 // Without an authenticated receipt, a completed planning job stays nonterminal.
 assert.equal(ownerCoreTriageReceiptPlan(child.body,completed).status,'PLAN_SHOWN');
 // A terminal Core objective alone, or a checked Issue without worker
 // provenance, must NEVER clear the Owner draft.
 assert.equal(ownerCoreTriageReceiptPlan(child.body,{...completed,nativeCoreJobAccepted:false},ownerReceipt).status,'PLAN_SHOWN');
 assert.equal(ownerCoreTriageReceiptPlan(child.body,{...completed,githubChecklistAccepted:false},ownerReceipt).status,'PLAN_SHOWN');
 const resolved=ownerCoreTriageReceiptPlan(child.body,completed,ownerReceipt);
 assert.equal(resolved.status,'ANSWERED');
 assert.match(resolved.reply,/Đã xử lý yêu cầu thử tiếp nhận/);
 assert.ok(resolved.reply.includes(completed.id));
 // An unrelated Owner instruction cannot inherit the special smoke result.
 const actionable={...smoke,message:'Kiểm tra và sửa chức năng thật'};
 assert.equal(ownerCoreTriageReceiptPlan(child.body,completed,makeOwnerRequestReceipt(actionable)).status,'PLAN_SHOWN');
 // Wrong request ID, parent and incomplete output must not clear the Owner input.
 assert.equal(ownerCoreTriageReceiptPlan(child.body,completed,ownerReceipt.replace(id,'00000000-0000-4000-8000-000000000000')).status,'PLAN_SHOWN');
 assert.equal(ownerCoreTriageReceiptPlan(child.body,{...completed,summary:''},ownerReceipt).status,'PLAN_SHOWN');
 assert.equal(ownerCoreTriageReceiptPlan(child.body,{...completed,status:'blocked'},ownerReceipt).status,'BLOCKED');
});

test('a completed actionable Owner instruction stays PLAN_SHOWN with authenticated matching receipt',()=>{
 const child=boundedOwnerTriageChild({issue,request,receiptUrl});
 const row={id:'OBJ-GH-900002',status:'completed',summary:'Core worker prepared a safe plan with exact source evidence'};
 const result=ownerCoreTriageReceiptPlan(child.body,row,makeOwnerRequestReceipt(request));
 assert.equal(result.status,'PLAN_SHOWN');
 assert.match(result.reply,/chưa được nghiệm thu thực thi/);
});

test('Owner Core job evidence requires terminal accepted AI output from the exact worker scope',()=>{
 const scope='TIGERIQ_OWNER_DIRECTIVE_TRIAGE_5252';
 const result={autoworkAcceptance:{
  code:'GITHUB_AUTOWORK_SOURCE_OUTPUT_ACCEPTED',resourceScope:scope,
  productAccepted:false,employeeId:'NV12',characterCount:110,
  textSha256:'b'.repeat(64),
 }};
 const job={kind:'github_api_autowork',status:'done',employee_id:'NV12',
  resource_id:'res:local-free:NV12',completed_at:'2026-10-24T04:00:00.000Z',result};
 assert.equal(verifiedOwnerTriageNativeJob(job,scope),true);
 for(const invalid of [
  {...job,status:'queued'},
  {...job,kind:'github_review'},
  {...job,employee_id:'NV03'},
  {...job,resource_id:''},
  {...job,completed_at:'invalid-date'},
  {...job,result:{}},
  {...job,result:{autoworkAcceptance:{...result.autoworkAcceptance,characterCount:12}}},
  {...job,result:{autoworkAcceptance:{...result.autoworkAcceptance,productAccepted:true}}},
  {...job,result:{autoworkAcceptance:{...result.autoworkAcceptance,textSha256:'forged'}}},
  {...job,result:{autoworkAcceptance:{...result.autoworkAcceptance,resourceScope:'DIFFERENT_SCOPE'}}},
 ])assert.equal(verifiedOwnerTriageNativeJob(invalid,scope),false);
 assert.equal(verifiedOwnerTriageNativeJob(job,'ANOTHER_SCOPE'),false);
 assert.equal(verifiedOwnerTriageNativeJob(job,''),false);
});

test('Owner finished-result publication waits for BOTH native Core and GitHub checklist evidence',()=>{
 const child=boundedOwnerTriageChild({issue,request,receiptUrl});
 const row={status:'completed',summary:'Triage prepared and pending evidence'};
 assert.deepEqual(ownerTriageCompletionPublicationGate(child.body,row),{defer:true,reason:'GITHUB_CHECKLIST_PENDING'});
 assert.deepEqual(ownerTriageCompletionPublicationGate(child.body,{...row,githubChecklistAccepted:true}),{defer:true,reason:'NATIVE_CORE_JOB_NOT_VERIFIED'});
 assert.deepEqual(ownerTriageCompletionPublicationGate(child.body,{...row,nativeCoreJobAccepted:true}),{defer:true,reason:'GITHUB_CHECKLIST_PENDING'});
 assert.deepEqual(ownerTriageCompletionPublicationGate(child.body,{...row,githubChecklistAccepted:true,nativeCoreJobAccepted:true}),{defer:false,reason:'SOURCE_AND_NATIVE_EVIDENCE_PRESENT'});
 assert.equal(ownerTriageCompletionPublicationGate(child.body,{status:'blocked'}).defer,false);
 assert.equal(ownerTriageCompletionPublicationGate('SOURCE=FORGED',{...row}).defer,false);
});
