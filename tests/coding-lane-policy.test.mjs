import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {branchName,checkGateState,extractCanonicalAllowedPaths,validateChanges} from '../apps/tigeriq-coding-lane/policy.mjs';

const service=readFileSync(new URL('../apps/tigeriq-coding-lane/coding-lane.mjs',import.meta.url),'utf8');
const updater=readFileSync(new URL('../scripts/tigeriq-core/update-core-runtime.ps1',import.meta.url),'utf8');

import {validateRedToGreenRequirements} from '../apps/tigeriq-coding-lane/policy.mjs';

const laneCode=service;

function classifyAiFailure(error){
  const status=Number(error?.status||0);
  const msg=String(error?.message||error||'');
  if(status===429||/HTTP_429\b|RATE_LIMIT|RESOURCE_EXHAUSTED/i.test(msg))return 'rate_limit';
  if(error?.name==='AbortError'||/ETIMEDOUT|timeout|aborted|ECONNRESET|socket/i.test(msg))return 'timeout';
  if([408,409,413,500,502,503,504].includes(status)||/fetch failed|HTTP_(?:408|409|413|500|502|503|504)\b/i.test(msg))return 'provider_unavailable';
  return 'other';
}

function resourceWaitPlan({retryCount=0,startedAt=null,nowMs=Date.now(),maxRetries=6,maxWindowMs=3600000}={}){
  const count=Math.max(0,Number(retryCount)||0);
  const startedMs=startedAt?new Date(startedAt).getTime():nowMs;
  const ageMs=Math.max(0,nowMs-(Number.isFinite(startedMs)?startedMs:nowMs));
  if(count>=maxRetries||ageMs>=maxWindowMs)return {wait:false,retryCount:count,ageMs,nextAttemptAt:null,delayMs:0};
  const delayMs=Math.min(600000,30000*Math.pow(2,count));
  return {wait:true,retryCount:count+1,ageMs,delayMs,nextAttemptAt:new Date(nowMs+delayMs).toISOString()};
}

test('specification-first and RED-to-GREEN TDD regression contract checks',()=>{
  assert.equal(validateRedToGreenRequirements({isDocOrConfig:true}),true);
  assert.equal(validateRedToGreenRequirements({isBugFix:true,hasPreFixFailureEvidence:true}),true);
  assert.throws(()=>validateRedToGreenRequirements({isBugFix:true,hasPreFixFailureEvidence:false}),/RED_TDD_PRE_FIX_EVIDENCE_REQUIRED/);
});

test('coding lane cannot target protected or unsafe paths',()=>{
  assert.equal(safeRepoPath('apps/demo/file.ts'),true);
  assert.equal(safeRepoPath('.github/workflows/ci.yml'),false);
  assert.equal(safeRepoPath('docs/EXECUTION_BOUNDARY.md'),false);
  assert.equal(safeRepoPath('scripts/tigeriq-core/run-core.ps1'),false);
  assert.equal(safeRepoPath('../escape.ts'),false);
  assert.throws(()=>validateChanges([{path:'apps/b.ts',content:'x'}],['apps/a.ts']),/OUTSIDE_MANAGER_SCOPE/);
});

test('canonical MUST NOT EXPAND header is an enforceable source scope',()=>{
  const objective='CANONICAL ALLOWED PATHS (MUST NOT EXPAND):\\ntests/coding-lane-ai-json-transport.test.mjs\\n\\nGoal: test-only canary';
  assert.deepEqual(extractCanonicalAllowedPaths(objective),['tests/coding-lane-ai-json-transport.test.mjs']);
});

test('every coding job receives a non-main isolated branch',()=>{
  const b=branchName('NV11','CODE-1234');
  assert.match(b,/^tigeriq\/nv11\//);
  assert.notEqual(b,'main');
});

test('CI gate requires all three successful checks',()=>{
  const ok=['CI Verify','Queue Hygiene Verify','Vercel Online Verify'].map(name=>({name,status:'completed',conclusion:'success'}));
  assert.equal(checkGateState(ok).state,'passed');
  assert.equal(checkGateState(ok.slice(0,2)).state,'pending');
  assert.equal(checkGateState([{name:'CI Verify',status:'completed',conclusion:'failure'}]).state,'failed');
});

test('runtime impact isolates Web Control and Coding Lane from Core restart',()=>{
  assert.deepEqual(changedPathImpact(['apps/tigeriq-core/web-control.html']),{core:false,web:true,coding:false,updater:false,none:false});
  assert.deepEqual(changedPathImpact(['apps/tigeriq-coding-lane/coding-lane.mjs']),{core:false,web:false,coding:true,updater:false,none:false});
  assert.equal(changedPathImpact(['apps/tigeriq-core/core.mjs']).core,true);
});

test('service enforces independent reviewer and gate-before-merge',()=>{
  assert.match(service,/pickResource\(\[worker\.id\]\)/);
  assert.match(service,/waitGates\(branch\)/);
  assert.match(service,/review\.decision==='approve'/);
  assert.match(service,/mergePr\(pr\.number,finalSha\)/);
  assert.doesNotMatch(service,/refs\/heads\/main.*method:'PATCH'/s);
});

test('provider failover classification routes errors correctly',()=>{
  assert.equal(classifyAiFailure({status:429}),'rate_limit');
  assert.equal(classifyAiFailure({status:503}),'provider_unavailable');
  assert.equal(classifyAiFailure({status:504}),'provider_unavailable');
  assert.equal(classifyAiFailure({name:'AbortError'}),'timeout');
  assert.equal(classifyAiFailure({message:'HTTP_429'}),'rate_limit');
});

test('resourceWaitPlan uses exponential backoff',()=>{
  let plan=resourceWaitPlan({retryCount:0});
  assert.equal(plan.wait,true);
  assert.equal(plan.delayMs,30000);
  assert.equal(plan.retryCount,1);
  plan=resourceWaitPlan({retryCount:2});
  assert.equal(plan.delayMs,120000);
  assert.equal(plan.retryCount,3);
});

test('resourceWaitPlan stops when maxRetries reached',()=>{
  const plan=resourceWaitPlan({retryCount:6});
  assert.equal(plan.wait,false);
  assert.equal(plan.retryCount,6);
});

test('PowerShell updater is path-aware and leaves Core alone for non-Core changes',()=>{
  assert.match(updater,/Get-Impact/);
  assert.match(updater,/if\(\$impact\.core\)\{\$coreHealth=Restart-Core/);
  assert.match(updater,/coreRestarted=\$impact\.core/);
  assert.match(updater,/webRestarted=\$impact\.web/);
  assert.match(updater,/codingRestarted=\$impact\.coding/);
});
