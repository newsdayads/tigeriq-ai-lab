import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeCoreJobEvidence} from '../apps/tigeriq-core/job-outcome-summary.mjs';

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
