import test from 'node:test';
import assert from 'node:assert/strict';
import {projectCoreExecutionResult,summarizeCoreJobEvidence} from '../apps/tigeriq-core/job-outcome-summary.mjs';

test('40 Core done internal jobs do not imply 40 implemented features',()=>{
  const rows=[
    ...Array.from({length:38},(_,n)=>({id:'API-DOC-'+n,kind:'api_doctor',status:'done'})),
    ...Array.from({length:2},(_,n)=>({id:'NV07-'+n,kind:'nv07_bootstrap',status:'done'}))
  ];
  const s=summarizeCoreJobEvidence(rows);
  assert.equal(s.sampleSize,40);
  assert.equal(s.internalOperationDone,40);
  assert.equal(s.verifiedProductAcceptance,null);
  assert.equal(s.acceptedProductProgressClaimAllowed,false);
});
test('even non-internal done jobs still require product acceptance evidence',()=>{
  const s=summarizeCoreJobEvidence([{kind:'compiled_ai',status:'done'},{kind:'readonly',status:'done'}]);
  assert.equal(s.otherDoneNotNecessarilyAccepted,1);
  assert.equal(s.verifiedProductAcceptance,null);
});


test('projects bounded EXECUTION_RESULT_V1 without exposing raw text or secret keys',()=>{
  const output={
    schema:'EXECUTION_RESULT_V1',status:'complete',summary:'ANIMAL-CITY-CANARY-R2-20261104 Authorization=abc Bearer ABC123 token=xyz',
    acceptance:[{criterion:'LOCAL P2 only',passed:true,evidence_refs:['e1']}],
    evidence:[{id:'e1',type:'artifact',value:{artifactId:'ANIMAL-CITY-CANARY-R2-20261104',check:'PASS',token:'must-not-leak'}}],
    block_reason:null,
  };
  const projected=projectCoreExecutionResult({text:JSON.stringify(output),executionGate:{pass:true,code:'EXECUTION_ACCEPTED',evidenceIds:['e1']},secret:'hidden'});
  assert.equal(projected.schema,'TIGERIQ_CORE_EXECUTION_RESULT_SUMMARY_V1');
  assert.match(projected.executionResult.summary,/ANIMAL-CITY-CANARY-R2-20261104/);
  assert.doesNotMatch(projected.executionResult.summary,/abc|ABC123|xyz/);
  assert.match(projected.executionResult.summary,/\[REDACTED\]/);
  assert.equal(projected.executionResult.evidence[0].value.artifactId,'ANIMAL-CITY-CANARY-R2-20261104');
  assert.equal(projected.executionResult.evidence[0].value.token,undefined);
  assert.equal(projected.executionGate.pass,true);
  assert.equal(Object.hasOwn(projected,'text'),false);
});

test('rejects arbitrary raw model output from result projection',()=>{
  assert.equal(projectCoreExecutionResult({text:'not json',executionGate:{pass:true}}),null);
  assert.equal(projectCoreExecutionResult({text:JSON.stringify({schema:'OTHER',summary:'x'})}),null);
});
