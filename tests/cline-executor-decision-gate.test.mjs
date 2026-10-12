import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateBenchmarkComparison,REQUIRED_FIXTURES} from '../benchmarks/cline-executor-eval/decision-gate.mjs';
const digest='a'.repeat(64),manifest='b'.repeat(64),trace='c'.repeat(64);
const tap=(passed)=>['TAP version 13','# tests 2','# pass '+(passed?2:1),
  '# fail '+(passed?0:1),'# cancelled 0','# skipped 0','# todo 0'].join('\n')+'\n';
const lane=(name,completed=3,elapsedMs=100)=>({
  lane:name,device:'PC01',provider:'ollama',modelDigest:digest,manifestSha256:manifest,
  traceSha256:trace,elapsedMs,cpuMs:15,peakRssBytes:1000,paidCostUsd:0,
  attempts:REQUIRED_FIXTURES.map(fixtureId=>({fixtureId,count:1})),
  score:{version:1,lane:name,total:3,completed,completionRate:completed/3,qualityPass:true,
    fixtures:REQUIRED_FIXTURES.map((fixtureId,i)=>({
      fixtureId,testCount:2,testExitCode:i<completed?0:1,testsPass:i<completed,
      testsMutated:false,taskMutated:false,unexpectedFiles:[],completed:i<completed,
      filesChanged:i<completed?1:0,linesChanged:i<completed?2:0,
      stdoutTail:tap(i<completed),stderrTail:'',
    }))},
});
const validProof=()=>({verified:true,filesystem:true,process:true,network:true,
  resourceLimits:true,noCredentials:true,sourceHashes:true,pc01Runtime:true});
test('no trusted runner means no outcome despite fabricated perfect 3/3 receipts',()=>{
  const r=evaluateBenchmarkComparison({cline:lane('cline-local-ollama'),nv09:lane('current-coding-lane')});
  assert.equal(r.status,'BLOCKED');assert.equal(r.decision,null);
  assert.deepEqual(r.issues,['TRUSTED_OS_ISOLATION_VERIFIER_MISSING']);
});
test('self-described attestation is not proof and does not authorize a result',()=>{
  const r=evaluateBenchmarkComparison({cline:{...lane('cline-local-ollama'),attested:true},
    nv09:lane('current-coding-lane'),verifyTrustedReceipt:()=>({verified:true})});
  assert.equal(r.status,'BLOCKED');assert.equal(r.decision,null);
});
test('fake scores, skipped tests and mismatched model/manifest block comparison',()=>{
  const c=lane('cline-local-ollama');const n=lane('current-coding-lane');
  c.score.fixtures[0].testCount=0;
  assert.equal(evaluateBenchmarkComparison({cline:c,nv09:n,verifyTrustedReceipt:validProof}).status,'BLOCKED');
  c.score.fixtures[0].testCount=2;c.score.fixtures[0].testsMutated=true;
  assert.equal(evaluateBenchmarkComparison({cline:c,nv09:n,verifyTrustedReceipt:validProof}).status,'BLOCKED');
  c.score.fixtures[0].testsMutated=false;n.modelDigest='f'.repeat(64);
  assert.ok(evaluateBenchmarkComparison({cline:c,nv09:n,verifyTrustedReceipt:validProof}).issues.includes('LANES_NOT_COMPARABLE'));
});
test('only trusted measured lanes yield conservative candidate decisions',()=>{
  const a=lane('cline-local-ollama',3,70),b=lane('current-coding-lane',3,100);
  assert.equal(evaluateBenchmarkComparison({cline:a,nv09:b,verifyTrustedReceipt:validProof}).decision,'CANARY');
  a.elapsedMs=95;
  assert.equal(evaluateBenchmarkComparison({cline:a,nv09:b,verifyTrustedReceipt:validProof}).decision,'KEEP');
  a.score.completed=2;a.score.completionRate=2/3;
  Object.assign(a.score.fixtures[2],{testsPass:false,completed:false,testExitCode:1,
    filesChanged:0,linesChanged:0,stdoutTail:tap(false)});
  assert.equal(evaluateBenchmarkComparison({cline:a,nv09:b,verifyTrustedReceipt:validProof}).decision,'REJECT');
});
test('incomplete measurements, paid provider and invalid witness never pass',()=>{
  const a=lane('cline-local-ollama'),b=lane('current-coding-lane');
  a.paidCostUsd=0.01;
  assert.equal(evaluateBenchmarkComparison({cline:a,nv09:b,verifyTrustedReceipt:validProof}).status,'BLOCKED');
  a.paidCostUsd=0;
  assert.equal(evaluateBenchmarkComparison({cline:a,nv09:b,verifyTrustedReceipt:()=>{throw Error('bad');}}).status,'BLOCKED');
});

test('rejects absent and contradictory native raw scorer receipts',()=>{
  const original=lane('cline-local-ollama'),other=lane('current-coding-lane');
  const run=(candidate)=>evaluateBenchmarkComparison({cline:candidate,nv09:other,verifyTrustedReceipt:validProof});
  const c=structuredClone(original);delete c.score.fixtures[0].testExitCode;
  assert.equal(run(c).status,'BLOCKED');
  const c2=structuredClone(original);c2.score.fixtures[0].testExitCode=1;
  assert.equal(run(c2).status,'BLOCKED');
  const c3=structuredClone(original);delete c3.score.fixtures[0].filesChanged;
  assert.equal(run(c3).status,'BLOCKED');
  const c4=structuredClone(original);delete c4.score.fixtures[0].stdoutTail;
  assert.equal(run(c4).status,'BLOCKED');
  const c5=structuredClone(original);c5.score.fixtures[0].stdoutTail=tap(false);
  assert.equal(run(c5).status,'BLOCKED');
  const c6=structuredClone(original);c6.score.fixtures[0].stdoutTail=[
    'TAP version 13','# tests 2','# pass 0','# fail 0',
    '# cancelled 0','# skipped 2','# todo 0'].join('\n')+'\n';
  assert.equal(run(c6).status,'BLOCKED');
  const c7=structuredClone(original);c7.score.completionRate=0;
  assert.equal(run(c7).status,'BLOCKED');
});
test('two wholly unsuccessful lanes cannot become a measured KEEP decision',()=>{
  const res=evaluateBenchmarkComparison({cline:lane('cline-local-ollama',0),
    nv09:lane('current-coding-lane',0),verifyTrustedReceipt:validProof});
  assert.equal(res.status,'BLOCKED');assert.equal(res.decision,null);
  assert.ok(res.issues.includes('BOTH_LANES_HAVE_ZERO_VALID_COMPLETIONS'));
});
