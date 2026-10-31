import test from 'node:test';
import assert from 'node:assert/strict';
import {codingIssueCompletionGate,sourceCompletionDiagnostic,sourceTerminalDependencyAccepted} from '../apps/shared/work-order-acceptance-sync.mjs';
import {projectWorkOrder} from '../apps/tigeriq-core/web-control-server.mjs';

const repo='https://github.com/newsdayads/tigeriq-ai-lab/issues/7001';
const receipt=repo+'#issuecomment-701';
function acceptedIssue(){
  return {
    number:7001,title:'[P1][CODING] Accepted end-to-end work',state:'open',state_reason:null,
    created_at:'2026-10-24T00:00:00Z',
    body:[
      'TIGERIQ_JOB_V1','WORK_ORDER_LIFECYCLE=V2','PROJECT_ID=tigeriq-platform',
      'WORKSTREAM_ID=q12c-regression','CURRENT_STATE=DONE_ACCEPTED','CURRENT_STEP=R01',
      'NEXT_ACTION=NONE','LAST_COMPLETED_STEP=R01','BLOCKER=NONE',
      'RESOURCE_SCOPE=Q12C_TEST_ONLY','MUTATION_OWNER=CORE_DYNAMIC_LEASE',
      'ETA_STATUS=UNVERIFIED','DONE=true','STARTED_AT=2026-10-24T00:00:00Z',
      'FINISHED_AT=2026-10-24T00:02:00Z',
      'START_RECEIPT_URL='+receipt,'FINISH_RECEIPT_URL='+receipt,
      'SAME_FAILURE_RETRY_COUNT=0','SAME_FAILURE_RETRY_MAX=2',
      'VERIFICATION_COUNT_CURRENT_HEAD=0','VERIFICATION_MAX_PER_HEAD=2',
      'LAST_FAILURE_SIGNATURE=NONE','RETRY_RESUME_TRIGGER=NOT_AVAILABLE',
      '## ACCEPTANCE','Production-readback evidence accepted.',
      '## STOP_CONDITIONS','DONE_WITH_EVIDENCE or REAL_BLOCKER',
      '## STRUCTURED_PROGRESS_CHECKLIST',
      '- [x] R00 — source [receipt]('+receipt+')',
      '- [x] R01 — production [receipt]('+receipt+')',
    ].join('\n'),
  };
}

test('Coding job cannot prematurely close #5243 when DONE=false and normal output has not been accepted',()=>{
 const issue={...acceptedIssue(),number:5243,state:'open',body:acceptedIssue().body.replace('DONE=true','DONE=false')};
 const gate=codingIssueCompletionGate(issue);
 assert.equal(gate.canClose,false);
 assert.ok(gate.missing.includes('DONE_NOT_ACCEPTED'));
});

test('Closed #5259 without Lifecycle V2 receipts must remain VERIFY with specific missing evidence',()=>{
 const issue={number:5259,title:'[P1][DASHBOARD] Source change',created_at:'2026-10-23T21:13:19Z',
  state:'closed',state_reason:'completed',body:'WORK_ORDER_LIFECYCLE=V2\nCURRENT_STATE=DONE_SCOPED_PC01_SOURCE_SERVE_ACCEPTED\nDONE=true\nFINISHED_AT=2026-10-23T21:21:22.868Z\nFINISH_RECEIPT_URL='+receipt};
 const diagnostic=sourceCompletionDiagnostic(issue);
 assert.equal(diagnostic.state,'VERIFY_EVIDENCE_MISSING');
 assert.equal(diagnostic.completionVerified,false);
 assert.ok(diagnostic.missing.includes('CHECKLIST_INCOMPLETE'));
 const projected=projectWorkOrder(issue);
 assert.equal(projected.status,'VERIFY');
 assert.equal(projected.completionVerified,false);
 assert.equal(projected.completionSyncState,'VERIFY_EVIDENCE_MISSING');
 assert.ok(projected.completionMissing.length>0);
});

test('Real V2 receipts allow a single source-authorized closure after full acceptance',()=>{
 const issue=acceptedIssue();
 assert.equal(codingIssueCompletionGate(issue).canClose,true);
 const closed={...issue,state:'closed',state_reason:'completed'};
 const diagnostic=sourceCompletionDiagnostic(closed);
 assert.equal(diagnostic.state,'DONE_ACCEPTED');
 assert.equal(diagnostic.completionVerified,true);
 assert.deepEqual(diagnostic.missing,[]);
 const projected=projectWorkOrder(closed);
 assert.equal(projected.status,'DONE');
 assert.equal(projected.bucket,'HOÀN THÀNH');
});

test('Open source with DONE declaration is never displayed as completed before GitHub closure',()=>{
 const issue=acceptedIssue();
 assert.equal(sourceCompletionDiagnostic(issue).completionVerified,false);
 assert.equal(projectWorkOrder(issue).completionVerified,false);
});

test('closed completed without V2 evidence cannot unblock a parent Work Order',()=>{
 const completed={...acceptedIssue(),state:'closed',state_reason:'completed'};
 assert.equal(sourceTerminalDependencyAccepted(completed),true);
 const notDone={...completed,body:completed.body.replace('DONE=true','DONE=false')};
 assert.equal(sourceTerminalDependencyAccepted(notDone),false);
 const noFinish={...completed,body:completed.body.replace('FINISH_RECEIPT_URL='+receipt,'FINISH_RECEIPT_URL=NOT_AVAILABLE')};
 assert.equal(sourceTerminalDependencyAccepted(noFinish),false);
 assert.equal(sourceTerminalDependencyAccepted({...completed,state_reason:'not_planned'}),false);
 const legacy={number:7000,title:'Legacy pre-V2',state:'closed',state_reason:'completed',
   created_at:'2026-09-01T00:00:00Z',body:'LEGACY_WORK_ORDER=true'};
 assert.equal(sourceTerminalDependencyAccepted(legacy),true);
});
