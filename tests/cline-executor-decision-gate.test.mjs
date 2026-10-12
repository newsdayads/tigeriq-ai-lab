import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateBenchmarkComparison,REQUIRED_FIXTURES} from '../benchmarks/cline-executor-eval/decision-gate.mjs';
const digest='a'.repeat(64),manifest='b'.repeat(64),trace='c'.repeat(64);
const lane=(name,completed=3,elapsedMs=100)=>({
  lane:name,device:'PC01',provider:'ollama',modelDigest:digest,manifestSha256:manifest,
  traceSha256:trace,elapsedMs,cpuMs:15,peakRssBytes:1000,paidCostUsd:0,
  attempts:REQUIRED_FIXTURES.map(fixtureId=>({fixtureId,count:1})),
  score:{lane:name,total:3,completed,qualityPass:true,fixtures:REQUIRED_FIXTURES.map((fixtureId,i)=>({
    fixtureId,testCount:2,testsPass:i<completed,testsMutated:false,taskMutated:false,
    unexpectedFiles:[],completed:i<completed,
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
  a.score.completed=2;a.score.fixtures[2].testsPass=false;a.score.fixtures[2].completed=false;
  assert.equal(evaluateBenchmarkComparison({cline:a,nv09:b,verifyTrustedReceipt:validProof}).decision,'REJECT');
});
test('incomplete measurements, paid provider and invalid witness never pass',()=>{
  const a=lane('cline-local-ollama'),b=lane('current-coding-lane');
  a.paidCostUsd=0.01;
  assert.equal(evaluateBenchmarkComparison({cline:a,nv09:b,verifyTrustedReceipt:validProof}).status,'BLOCKED');
  a.paidCostUsd=0;
  assert.equal(evaluateBenchmarkComparison({cline:a,nv09:b,verifyTrustedReceipt:()=>{throw Error('bad');}}).status,'BLOCKED');
});
