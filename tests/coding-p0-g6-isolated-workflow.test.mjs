import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compileCodingStepPacket,codingStepInstruction,codingStepPacketFromInstruction,codingRolePrompt,
  verifyCodingDeliverable,verifyCodingFunctionalChecks,repeatedCodingAttemptDecision,
  codingFailureSignature,codingMaterialSourceRevision,codingSourceRevisionPaths,
  codingUnverifiedLegacyHistoryDecision,verifyClosedCodingWorkOrder
} from '../apps/tigeriq-coding-lane/step-contract.mjs';
import {loadRequiredCodingSkills,assertCodingSkillProof,requiredCodingSkillIdsForDeliverable} from '../apps/tigeriq-coding-lane/coding-skill-policy.mjs';

process.env.NODE_ENV='test';
const {runGateWithRepair,runReviewReworkLifecycle,assertIndependentReviewApproval,restartRecoveryDecision,staleRunningRecoveryDecision,sourceWorkOrderNumber}=await import('../apps/tigeriq-coding-lane/coding-lane.mjs');

const files=['apps/demo/app/build.gradle.kts','apps/demo/app/src/main/AndroidManifest.xml','apps/demo/app/src/main/java/MainActivity.kt'];
const sourceBlobs=Object.fromEntries(files.map(x=>[x,null]));
const revision=codingMaterialSourceRevision({canonicalWorkOrderId:'4625',paths:files,sourceBlobs});
const head='a'.repeat(40);
const job=id=>({
  step_id:id,title:'Kiểm thử sản phẩm Android',instruction:'Tạo thành phần chạy được',
  paths:files,deliverable_type:'android',required_changed_paths:files,
  steps:['Đọc mã và hợp đồng','Sửa mã','Kiểm tra Gradle và chức năng'],
  acceptance:['Mã nguồn có thể chạy','Biên nhận đúng SHA'],
  evidence_required:['File diff','Android Build Verify']
});
const changes=[
  {path:files[0],content:'plugins { id("com.android.application") }'},
  {path:files[1],content:'<manifest package="ai.tigeriq.demo"/>'},
  {path:files[2],content:'package ai.tigeriq.demo; public class MainActivity {}'}
];
const checks=[{name:'Android Build Verify',status:'completed',conclusion:'success',head_sha:head}];

test('G6 dry-run: manager packet -> ACTIVE Skill bytes -> implementer -> independent review -> targeted test -> acceptance prompt',()=>{
  const loaded=loadRequiredCodingSkills('GitHub autonomous coding issue #4625');
  const packet=compileCodingStepPacket({
    objectiveId:'CODEOBJ-test',sourceRevision:revision,sourceHeadSha:head,
    allowedPaths:files,job:job('D01'),skillEvidence:loaded.proof
  });
  assertCodingSkillProof(packet.skill_refs,loaded);
  assert.deepEqual(requiredCodingSkillIdsForDeliverable('android'),['spec-first-tdd']);
  const serialized=codingStepInstruction(packet);
  const persisted=codingStepPacketFromInstruction(serialized);
  assert.equal(persisted.prompt_revision,packet.prompt_revision);
  for(const role of ['manager','implementer','reviewer','acceptor']){
    const prompt=codingRolePrompt({role,packet:persisted,skillContext:loaded.contextBlock});
    assert.match(prompt,/ACTIVE_SKILL_CONTENT=/);
    assert.match(prompt,/SOURCE_HEAD_SHA=a{40}/);
  }
  assert.equal(verifyCodingDeliverable({packet:persisted,changes}).pass,true);
  assert.equal(verifyCodingFunctionalChecks({packet:persisted,checkRuns:checks}).pass,true);
  const reviewer='reviewer-B',implementer='worker-A',review={decision:'approve',reviewedHead:head};
  assert.notEqual(reviewer,implementer);
  assert.equal(review.reviewedHead,persisted.source_head_sha);
  assert.equal(review.decision,'approve');
  // A contract mock is NOT a real Android build or a deployed product.
  assert.equal(verifyClosedCodingWorkOrder({state:'closed',stateReason:'completed',body:'DONE=false\\n- [ ] G6'}).pass,false);
});

test('G4->G6: aliases and renamed objective do not rearm failed work order, accepted previous step permits D02',()=>{
  const one='GitHub autonomous coding issue #4625: Triển khai Android';
  const two='GitHub autonomous coding retry 1/2 for issue #4625: Đổi tên';
  const three='GitHub autonomous coding retry 2/2 for issue #4625: Đổi tiếp';
  for(const o of [one,two,three])assert.equal(sourceWorkOrderNumber(o),4625);
  const digest=o=>codingMaterialSourceRevision({canonicalWorkOrderId:String(sourceWorkOrderNumber(o)),paths:files,sourceBlobs});
  assert.equal(digest(one),digest(two));assert.equal(digest(two),digest(three));
  const failure=codingFailureSignature({code:'OUTPUT_CONTRACT_EXHAUSTED',message:'job-123'});
  const failed=['D01','D01'].map(stepId=>({workOrderId:'4625',stepId,sourceRevision:revision,status:'failed',failureSignature:failure}));
  assert.equal(repeatedCodingAttemptDecision({workOrderId:'4625',stepId:'D01',sourceRevision:revision,failureSignature:failure,history:failed}).code,'CODING_SAME_FAILURE_STOP');
  assert.equal(repeatedCodingAttemptDecision({workOrderId:'4625',stepId:'D02',sourceRevision:revision,failureSignature:failure,history:failed}).code,'CODING_STEP_ALIAS_REPLAY_BLOCKED');
  assert.equal(repeatedCodingAttemptDecision({workOrderId:'4625',stepId:'D02',sourceRevision:revision,history:[{...failed[0],status:'accepted'}]}).allow,true);
  const driftPaths=codingSourceRevisionPaths({canonicalPaths:files,proposedPaths:[files[0]]});
  assert.deepEqual(driftPaths,[...files].sort());
  assert.equal(codingMaterialSourceRevision({canonicalWorkOrderId:'4625',paths:driftPaths,sourceBlobs}),revision);
  assert.equal(codingUnverifiedLegacyHistoryDecision({workOrderId:'4625',legacyRows:[{workOrderId:'4625',status:'failed'}]}).code,'CODING_PRE_CANARY_HISTORY_UNVERIFIED');
});

test('G6 isolated failover: single PR repair budget, same review SHA, no duplicate job dispatch',async()=>{
  let waitCount=0,repairs=0,dispatches=1;
  const result=await runGateWithRepair({
    waitFn:async()=>{
      waitCount++;
      if(waitCount===1)throw Object.assign(new Error('CI_GATES_FAILED'),{code:'CI_GATES_FAILED',detail:{issues:['SIMULATED_ANDROID_BUILD_FAILURE']}});
      return {sha:head,states:checks};
    },
    repairFn:async()=>{repairs++;},
    maxRepairCycles:2,timeoutRetries:0
  });
  assert.equal(result.sha,head);
  assert.equal(repairs,1);assert.equal(waitCount,2);assert.equal(dispatches,1);
  await assert.rejects(runGateWithRepair({
    waitFn:async()=>{throw Object.assign(new Error('CI_GATES_FAILED'),{code:'CI_GATES_FAILED'})},
    repairFn:async()=>{repairs++;},
    maxRepairCycles:2,timeoutRetries:0
  }),/CI_GATE_REPAIR_EXHAUSTED/);
  assert.equal(dispatches,1);
});

test('G6 simulated crash/restart: preserve PR identity, fail closed for unknown/closed PR and bounded stale retries',()=>{
  const job={status:'running',pr_number:123,branch:'p0/safe-branch'};
  assert.deepEqual(restartRecoveryDecision(job,{state:'open'}).action,'queue');
  assert.equal(restartRecoveryDecision(job,{state:'closed',merged:false}).action,'fail');
  assert.equal(restartRecoveryDecision(job,null).action,'defer');
  assert.equal(restartRecoveryDecision({...job,branch:'',pr_number:0},null).code,'CODING_RESTART_REQUEUE_PRE_BRANCH');
  assert.equal(staleRunningRecoveryDecision({
    status:'running',started_at:'2026-01-01T00:00:00Z',stale_recovery_count:2
  },{nowMs:Date.parse('2026-01-02T00:00:00Z'),staleMs:1000,maxRequeues:2,active:false}).code,'CODING_STALE_RUNNING_RETRY_EXHAUSTED');
  assert.equal(staleRunningRecoveryDecision({
    status:'running',started_at:'2026-01-01T00:00:00Z',stale_recovery_count:2
  },{nowMs:Date.parse('2026-01-02T00:00:00Z'),staleMs:1000,maxRequeues:2,active:true}).code,'CODING_STALE_ACTIVE_LEASE');
});

test('G6 source lifecycle runs re-review after repair and invalidates approval on changed HEAD',async()=>{
  const heads=['a'.repeat(40),'b'.repeat(40)];
  let checkCalls=0,reviewCalls=0,fixCalls=0,waitingCalls=0;
  const result=await runReviewReworkLifecycle({
    maxCycles:2,
    waitGatesFn:async()=>({sha:heads[checkCalls++],states:[{name:'CI Verify',conclusion:'success'}]}),
    reviewFn:async({gates})=>{
      reviewCalls++;
      return reviewCalls===1
        ?{decision:'changes_requested',issues:['Functional regression'],sha:gates.sha}
        :{decision:'approve',issues:[],sha:gates.sha};
    },
    repairFn:async()=>{fixCalls++;},
    onWaitingCi:async()=>{waitingCalls++}
  });
  assert.equal(checkCalls,2);assert.equal(reviewCalls,2);assert.equal(fixCalls,1);assert.equal(waitingCalls,1);
  assert.equal(result.gates.sha,heads[1]);
  assert.equal(result.review.sha,heads[1]);
  assert.throws(()=>assertIndependentReviewApproval({
    implementerId:'worker-A',reviewerId:'reviewer-B',
    targetHead:heads[0],expectedHead:heads[1],decision:'approve'
  }),/HEAD|SHA|STALE|MISMATCH/i);
  assert.equal(assertIndependentReviewApproval({
    implementerId:'worker-A',reviewerId:'reviewer-B',
    targetHead:heads[1],expectedHead:heads[1],decision:'approve'
  }),true);
});
