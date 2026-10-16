import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compileCodingStepPacket,codingStepInstruction,codingStepPacketFromInstruction,codingRolePrompt,
  verifyCodingDeliverable,verifyCodingFunctionalChecks,verifyClosedCodingWorkOrder,
  repeatedCodingAttemptDecision,codingMaterialSourceRevision
} from '../apps/tigeriq-coding-lane/step-contract.mjs';
import {loadRequiredCodingSkills,assertCodingSkillProof} from '../apps/tigeriq-coding-lane/coding-skill-policy.mjs';

// This is deterministic offline CONTRACT integration. It is NOT a claim that a
// live Worker, real GitHub PR release or PC01 runtime canary has been exercised.
test('isolated two-step: manager -> real skill -> code -> independent reviewer -> functional receipt -> next step',()=>{
  const scope=['apps/tigeriq-example/api.mjs','apps/tigeriq-example/api.test.mjs'];
  const objective='GH-TEST-4242 two-step API task';
  const head='a'.repeat(40);
  const skills=loadRequiredCodingSkills(objective+' spec-first-tdd');
  const sources={ [scope[0]]:null,[scope[1]]:null };
  const revision=codingMaterialSourceRevision({objective,paths:scope,sourceBlobs:sources});
  const job=step=>({
    step_id:step,title:'API ' + step,instruction:'Implement a scoped API step '+step,
    paths:scope,deliverable_type:'backend',required_changed_paths:scope,
    steps:['Inspect source and specification','Implement code','Execute backend contract test'],
    acceptance:['Executable API has expected behavior','Contract CI result verified'],
    evidence_required:['Exact source SHA','Backend Contract Verify run URL']
  });
  const a=compileCodingStepPacket({objectiveId:objective,sourceRevision:revision,sourceHeadSha:head,allowedPaths:scope,job:job('D01'),skillEvidence:skills.proof});
  const serialized=codingStepInstruction(a);
  assertCodingSkillProof(a.skill_refs,skills);
  const parsed=codingStepPacketFromInstruction(serialized);
  for(const role of ['manager','implementer','reviewer','acceptor']){
    assert.match(codingRolePrompt({role,packet:parsed,skillContext:skills.contextBlock}),/ACTIVE_SKILL_CONTENT=/);
  }
  const change=scope.map(path=>({path,content:'export const makeApi = () => ({status: 200});'}));
  assert.equal(verifyCodingDeliverable({packet:parsed,changes:change}).pass,true);
  assert.equal(verifyCodingFunctionalChecks({packet:parsed,checkRuns:[{name:'CI Verify',status:'completed',conclusion:'success'}]}).pass,false);
  assert.equal(verifyCodingFunctionalChecks({packet:parsed,checkRuns:[{name:'Backend Contract Verify',status:'completed',conclusion:'success'}]}).pass,true);
  const accepted=[{workOrderId:objective,stepId:'D01',sourceRevision:revision,status:'accepted'}];
  assert.equal(repeatedCodingAttemptDecision({workOrderId:objective,stepId:'D01',sourceRevision:revision,history:accepted}).allow,false);
  const b=compileCodingStepPacket({objectiveId:objective,sourceRevision:revision,sourceHeadSha:head,allowedPaths:scope,job:job('D02'),skillEvidence:skills.proof});
  assert.equal(repeatedCodingAttemptDecision({workOrderId:objective,stepId:b.step_id,sourceRevision:revision,history:accepted}).allow,true);
  assert.notEqual(a.prompt_revision,b.prompt_revision);
});
test('negative journey: false closed work order + placeholder + repeat failure cannot reach acceptance',()=>{
  const source='apps/tigeriq-example/README.md';
  const scope=['apps/tigeriq-example/server.mjs'];
  const p=compileCodingStepPacket({
    objectiveId:'GH-TEST-4242',sourceRevision:'fixed',sourceHeadSha:'b'.repeat(40),
    allowedPaths:scope,job:{step_id:'D01',title:'Server',instruction:'Add server',
      paths:scope,deliverable_type:'backend',required_changed_paths:scope,
      steps:['Implement'],acceptance:['Runtime contract'],evidence_required:['Test output']
    }
  });
  assert.equal(verifyCodingDeliverable({packet:p,changes:[{path:source,content:'# Promise of server'}]}).pass,false);
  assert.equal(verifyClosedCodingWorkOrder({body:'DONE=false\n- [ ] D01',state:'closed',stateReason:'completed'}).pass,false);
  const history=[1,2].map(()=>({workOrderId:'GH-TEST-4242',stepId:'D01',sourceRevision:'fixed',status:'failed',failureSignature:'NO_IMPLEMENTER_AVAILABLE'}));
  assert.equal(repeatedCodingAttemptDecision({workOrderId:'GH-TEST-4242',stepId:'D01',sourceRevision:'fixed',failureSignature:'NO_IMPLEMENTER_AVAILABLE',history}).allow,false);
});
