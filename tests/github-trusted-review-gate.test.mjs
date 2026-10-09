import {it as test} from 'vitest';
import assert from 'node:assert/strict';
import {evaluateTrustedReview,REQUIRED_CHECKS} from '../scripts/github-trusted-review-gate.mjs';

const HEAD='a'.repeat(40), AUTHOR='newsdayads';
const checks=REQUIRED_CHECKS.map(name=>({name,status:'completed',conclusion:'success',app:{id:15368}}));
const pull={head:{sha:HEAD},base:{ref:'main'},user:{login:AUTHOR},state:'open',draft:false};
const review=(user='nv03-account',state='APPROVED',head=HEAD,role='NV03')=>({
  id:54,user:{login:user},state,commit_id:head,submitted_at:'2026-10-09T00:00:00Z',
  body:'TIGERIQ_INDEPENDENT_REVIEW_PASS\nREVIEW_ROLE: '+role+
    '\nTARGET_HEAD: '+head+'\nEVIDENCE_REF: core:job:NV03-123'
});
const verify=(params={})=>evaluateTrustedReview({
  pull,checks,reviews:[review()],nv03Login:'nv03-account',nv04Login:'nv04-account',...params
});

test('authenticated native NV03 exact-head approval is eligible',()=>{
  assert.equal(verify().ok,true);
});
test('independent NV04 fallback when NV03 unavailable',()=>{
  const out=verify({reviews:[review('nv04-account','APPROVED',HEAD,'NV04')]});
  assert.equal(out.ok,true);assert.equal(out.reviewer,'NV04');
});
test('missing binding and self review are denied',()=>{
  assert.equal(verify({nv03Login:'',nv04Login:''}).ok,false);
  assert.equal(verify({nv03Login:AUTHOR,reviews:[review(AUTHOR)]}).ok,false);
});
test('stale head, comment-only, forged role, missing evidence are denied',()=>{
  for(const x of [
    review('nv03-account','APPROVED','b'.repeat(40)),
    review('nv03-account','COMMENTED'),
    review('nv03-account','APPROVED',HEAD,'NV04'),
    {...review(),body:'TIGERIQ_INDEPENDENT_REVIEW_PASS\nREVIEW_ROLE: NV03\nTARGET_HEAD: '+HEAD}
  ])assert.equal(verify({reviews:[x]}).ok,false);
});
test('explicit NV03 CHANGES_REQUESTED cannot be overridden by NV04',()=>{
  const rejected=review('nv03-account','CHANGES_REQUESTED');
  const backup=review('nv04-account','APPROVED',HEAD,'NV04');
  backup.id=55;
  assert.equal(verify({reviews:[rejected,backup]}).ok,false);
});
test('required checks exact names, app and conclusions fail closed',()=>{
  for(const name of REQUIRED_CHECKS){
    assert.equal(verify({checks:checks.filter(c=>c.name!==name)}).ok,false);
  }
  assert.equal(verify({checks:checks.map(c=>({...c,app:{id:0}}))}).ok,false);
  assert.equal(verify({checks:checks.map(c=>({...c,conclusion:'failure'}))}).ok,false);
});
test('draft, branch mismatch and missing head denied',()=>{
  assert.equal(verify({pull:{...pull,draft:true}}).ok,false);
  assert.equal(verify({pull:{...pull,base:{ref:'other'}}}).ok,false);
  assert.equal(verify({pull:{...pull,head:{sha:'fake'}}}).ok,false);
});
