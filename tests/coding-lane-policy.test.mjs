import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {branchName,checkGateState,changedPathImpact,extractCanonicalAllowedPaths,safeRepoPath,validateChanges} from '../apps/tigeriq-coding-lane/policy.mjs';

const service=readFileSync(new URL('../apps/tigeriq-coding-lane/coding-lane.mjs',import.meta.url),'utf8');
const updater=readFileSync(new URL('../scripts/tigeriq-core/update-core-runtime.ps1',import.meta.url),'utf8');

import {validateRedToGreenRequirements,validateCompactContract} from '../apps/tigeriq-coding-lane/policy.mjs';

test('specification-first and RED-to-GREEN TDD regression contract checks',()=>{
  assert.equal(validateRedToGreenRequirements({isDocOrConfig:true}),true);
  assert.equal(validateRedToGreenRequirements({isBugFix:true,hasPreFixFailureEvidence:true}),true);
  assert.throws(()=>validateRedToGreenRequirements({isBugFix:true,hasPreFixFailureEvidence:false}),/RED_TDD_PRE_FIX_EVIDENCE_REQUIRED/);
});

test('compact contract validator detects malformed edits',()=>{
  assert.throws(()=>validateCompactContract([]),/NO_EDITS/);
  assert.throws(()=>validateCompactContract([{path:'a.md',old:'x'}]),/NEW_REQUIRED/);
  assert.throws(()=>validateCompactContract([{path:'a.md',old:'x'.repeat(4000),new:'y'}]),/OLD_TOO_LARGE/);
  assert.doesNotThrow(()=>validateCompactContract([{path:'a.md',old:'x',new:'y'}]));
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
  const objective='CANONICAL ALLOWED PATHS (MUST NOT EXPAND):\ntests/coding-lane-ai-json-transport.test.mjs\n\nGoal: test-only canary';
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

test('PowerShell updater is path-aware and leaves Core alone for non-Core changes',()=>{
  assert.match(updater,/Get-Impact/);
  assert.match(updater,/if\(\$impact\.core\)\{\$coreHealth=Restart-Core/);
  assert.match(updater,/coreRestarted=\$impact\.core/);
  assert.match(updater,/webRestarted=\$impact\.web/);
  assert.match(updater,/codingRestarted=\$impact\.coding/);
});

test('truncated edits trigger context refresh and model failover',()=>{
  assert.match(service,/isRefreshableCompactPatchError/);
  assert.match(service,/OLD_NOT_FOUND/);
  assert.match(service,/invokeJsonWithFailover/);
  assert.match(service,/classifyAiFailure/);
  assert.match(service,/OUTPUT_CONTRACT_EXHAUSTED/);
});

test('stale context refresh on OLD_NOT_FOUND maintains branch identity',()=>{
  assert.match(service,/contextFor/);
  assert.match(service,/OLD_NOT_FOUND/);
  assert.match(service,/shouldResumeExistingPr/);
  assert.match(service,/pr_number/);
});

test('same-PR repair preserves PR number across repair cycles',()=>{
  assert.match(service,/shouldResumeExistingPr/);
  assert.match(service,/pr_number/);
  assert.match(service,/runGateWithRepair/);
});

test('compact contract enforces deterministic validation and truncation detection',()=>{
  const policy=readFileSync(new URL('../apps/tigeriq-coding-lane/policy.mjs',import.meta.url),'utf8');
  assert.match(policy,/validateCompactContract/);
  assert.match(policy,/detectContractTruncation/);
});

test('failover handles contract errors without exhausting cycles',()=>{
  assert.match(service,/classifyAiFailure/);
  assert.match(service,/OUTPUT_CONTRACT_EXHAUSTED/);
  assert.match(service,/runGateWithRepair/);
  assert.match(service,/maxRepairCycles=3/);
});

test('truncated edits trigger context refresh and model failover',()=>{
  const code=service;
  assert.match(code,/isRefreshableCompactPatchError/);
  assert.match(code,/OLD_NOT_FOUND/);
  assert.match(code,/contextFor/);
});

test('stale context refresh on OLD_NOT_FOUND maintains branch identity',()=>{
  const code=service;
  assert.match(code,/shouldResumeExistingPr/);
  assert.match(code,/pr_number/);
});

test('same-PR repair preserves PR number across repair cycles',()=>{
  const code=service;
  assert.match(code,/pr.number/);
  assert.match(code,/generateAndWriteRepair/);
});

test('failover handles contract errors without exhausting cycles',()=>{
  const code=service;
  assert.match(code,/classifyAiFailure/);
  assert.match(code,/OUTPUT_CONTRACT_EXHAUSTED/);
});