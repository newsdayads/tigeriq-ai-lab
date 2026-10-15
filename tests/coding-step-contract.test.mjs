import test from 'node:test';
import assert from 'node:assert/strict';
import {compileCodingStepPacket,codingStepInstruction,codingStepPacketFromInstruction,codingRolePrompt,verifyCodingDeliverable,repeatedCodingAttemptDecision} from '../apps/tigeriq-coding-lane/step-contract.mjs';

const root='apps/dexcam-personal';
const job={
  step_id:'D01',title:'Khởi tạo mô-đun DeXCam',instruction:'Tạo mã nguồn Android thực.',
  paths:[root+'/app/build.gradle.kts',root+'/app/src/main/AndroidManifest.xml',root+'/app/src/main/java/ai/tigeriq/dexcam/MainActivity.kt'],
  deliverable_type:'android',
  required_changed_paths:[root+'/app/build.gradle.kts',root+'/app/src/main/AndroidManifest.xml',root+'/app/src/main/java/ai/tigeriq/dexcam/MainActivity.kt'],
  steps:['Đọc đặc tả','Tạo tệp nguồn thực','Chạy kiểm thử'],acceptance:['Gradle thật','Manifest thật','Kotlin thật'],
  evidence_required:['Commit đúng SHA','Kết quả kiểm thử']
};
const make=(j=job)=>compileCodingStepPacket({objectiveId:'GH-4625',sourceRevision:'shaA',job:j,allowedPaths:job.paths,skillEvidence:[{id:'spec-first-tdd',version:'1.1.0',bytes:1800}]});
test('stable step identity and skill provenance',()=>{
  const p=make();
  assert.equal(p.step_id,'D01');assert.deepEqual(p.skill_ids,['spec-first-tdd']);
  assert.match(p.prompt_revision,/^[a-f0-9]{24}$/);
  assert.deepEqual(codingStepPacketFromInstruction(codingStepInstruction(p)),p);
});
test('invalid manager packet fails before dispatch',()=>{
  for(const [key,value] of [['step_id',''],['steps',[]],['acceptance',[]],['evidence_required',[]],['required_changed_paths',[]],['deliverable_type','nonsense']]){
    assert.throws(()=>make({...job,[key]:value}),/CODING_STEP_/);
  }
  assert.throws(()=>make({...job,paths:['apps/tigeriq-core/core.mjs']}),/SCOPE_MISMATCH/);
});
test('markdown placeholder must not be accepted as executable Android project',()=>{
  const p=make();
  const r=verifyCodingDeliverable({packet:p,changes:[{path:root,content:'# Android module will be created'}]});
  assert.equal(r.pass,false);assert.equal(r.code,'CODING_DELIVERABLE_REJECTED');
});
test('real changed source-path structure passes only the structural gate',()=>{
  const p=make();
  const r=verifyCodingDeliverable({packet:p,changes:job.paths.map(path=>({path,content:'code artifact'}))});
  assert.equal(r.pass,true);assert.equal(r.code,'CODING_DELIVERABLE_STRUCTURE_PASSED');
});
test('role-specific manager, implementer, reviewer and acceptor prompts are explicit',()=>{
  const p=make();
  for(const role of ['manager','implementer','reviewer','acceptor']){
    const s=codingRolePrompt({role,packet:p,skillContext:'ACTIVE SKILL'});
    assert.match(s,/STEP_ID=D01/);assert.match(s,/ACTIVE SKILL/);assert.match(s,/PROMPT_REVISION=/);
  }
});
test('corrupt stored packet fails closed',()=>{
  assert.equal(codingStepPacketFromInstruction('legacy instruction'),null);
  assert.throws(()=>codingStepPacketFromInstruction('CODING_STEP_PACKET_JSON={broken}'),/CORRUPT/);
});
test('two identical failures stop, material source revision can re-open',()=>{
  const history=[1,2].map(()=>({workOrderId:'4625',stepId:'D01',sourceRevision:'A',status:'failed',failureSignature:'NO_OUTPUT'}));
  assert.equal(repeatedCodingAttemptDecision({workOrderId:'4625',stepId:'D01',sourceRevision:'A',failureSignature:'NO_OUTPUT',history}).code,'CODING_SAME_FAILURE_STOP');
  assert.equal(repeatedCodingAttemptDecision({workOrderId:'4625',stepId:'D01',sourceRevision:'B',failureSignature:'NO_OUTPUT',history}).allow,true);
  assert.equal(repeatedCodingAttemptDecision({workOrderId:'4625',stepId:'D01',sourceRevision:'A',history:[...history,{...history[0],status:'accepted'}]}).code,'CODING_STEP_ALREADY_ACCEPTED');
});
