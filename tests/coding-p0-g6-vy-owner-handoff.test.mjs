import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {codingVerifiedCanaryOwnerHandoff} from '../apps/tigeriq-coding-lane/coding-lane.mjs';
import {repeatedCodingAttemptDecision,codingUnverifiedLegacyHistoryDecision} from '../apps/tigeriq-coding-lane/step-contract.mjs';
const sha='b'.repeat(40);
const input={
  canary:true,merge:{merged:false,message:'AUTO_MERGE_DISABLED'},
  gates:{sha},productAcceptance:{pass:true,code:'CODING_PRODUCT_GATE_VERIFIED'},
  review:{decision:'approve'},headSha:sha
};

test('G6 verified canary remains an Owner-held draft, not blocked or merged',()=>{
  const x=codingVerifiedCanaryOwnerHandoff(input);
  assert.equal(x.jobStatus,'waiting_owner');
  assert.equal(x.objectiveStatus,'waiting_owner');
  assert.equal(x.code,'CODING_CANARY_VERIFIED_AWAITING_OWNER_RELEASE');
  assert.equal(x.sourceHeadSha,sha);
  assert.equal(x.reviewMode,'INDEPENDENT_APPROVED');
  assert.match(x.summary,/waiting for Owner release authorization/);
});

test('G6 waiver remains explicit and never masquerades as independent review',()=>{
  const x=codingVerifiedCanaryOwnerHandoff({...input,ownerWaiver:{reason:'scoped prior approval'},review:null});
  assert.equal(x.jobStatus,'waiting_owner');
  assert.equal(x.reviewMode,'OWNER_WAIVED_NOT_INDEPENDENT_PASS');
});

test('G6 final release cannot silently bypass Owner on canary path',()=>{
  for(const invalid of [
    {...input,merge:{merged:true}},
    {...input,headSha:'a'.repeat(40)},
    {...input,gates:{sha:'a'.repeat(40)}},
    {...input,productAcceptance:null},
    {...input,productAcceptance:{pass:true,code:'FAKE_PASS'}},
    {...input,review:{decision:'changes_requested'}},
  ]) assert.throws(()=>codingVerifiedCanaryOwnerHandoff(invalid),/CODING_CANARY_(OWNER_RELEASE_GATE_BYPASSED|HANDOFF_HEAD_UNVERIFIED|HANDOFF_PRODUCT_UNVERIFIED|HANDOFF_REVIEW_UNVERIFIED)/);
});

test('G6 non-product structural acceptance remains held and does not fake a product PASS',()=>{
  const r=codingVerifiedCanaryOwnerHandoff({...input,productAcceptance:{
    pass:true,code:'CODING_NON_PRODUCT_STEP_STRUCTURAL_ONLY'
  }});
  assert.equal(r.jobStatus,'waiting_owner');
});

test('G6 does not alter legacy merge policy without canary',()=>{
  assert.equal(codingVerifiedCanaryOwnerHandoff({canary:false,merge:{merged:true}}).jobStatus,'done');
  assert.equal(codingVerifiedCanaryOwnerHandoff({canary:false,merge:{merged:false}}).jobStatus,'blocked');
});

test('G6 held Owner step blocks same step and manager-renamed alias until release',()=>{
  const history=[{workOrderId:'4902',stepId:'D01',sourceRevision:'rev',status:'waiting_owner'}];
  const same=repeatedCodingAttemptDecision({workOrderId:'4902',stepId:'D01',sourceRevision:'rev',history});
  assert.deepEqual(same,{allow:false,code:'CODING_STEP_AWAITING_OWNER_RELEASE'});
  assert.equal(repeatedCodingAttemptDecision({workOrderId:'4902',stepId:'D02',sourceRevision:'rev',history}).code,'CODING_STEP_ALIAS_REPLAY_BLOCKED');
  assert.equal(codingUnverifiedLegacyHistoryDecision({workOrderId:'4902',legacyRows:history}).code,'CODING_PRE_CANARY_HISTORY_UNVERIFIED');
});

test('G6 writer claim must hold pending Owner step and real job must persist handoff receipt',()=>{
  const a=readFileSync(new URL('../apps/tigeriq-coding-lane/atomic-source-claim.mjs',import.meta.url),'utf8');
  const core=readFileSync(new URL('../apps/tigeriq-coding-lane/coding-lane.mjs',import.meta.url),'utf8');
  assert.match(a,/where status in \('queued','running','review','waiting_ci','waiting_resource','waiting_owner'\)/);
  assert.match(core,/status in \('running','review','waiting_ci','waiting_owner'\)/);
  assert.match(core,/\?codingVerifiedCanaryOwnerHandoff\(\{canary,merge,gates,productAcceptance,review,ownerWaiver,headSha:finalSha\}\)/);
  assert.match(core,/result=$4,[^\n]*ownerHandoff:handoff/);
  assert.doesNotMatch(core,/if\(AUTO_MERGE\s*\&\&\s*canary\)/);
});
