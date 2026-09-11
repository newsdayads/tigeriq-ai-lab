import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {branchName,checkGateState,changedPathImpact,safeRepoPath,validateChanges} from '../apps/tigeriq-coding-lane/policy.mjs';

const service=readFileSync(new URL('../apps/tigeriq-coding-lane/coding-lane.mjs',import.meta.url),'utf8');
const updater=readFileSync(new URL('../scripts/tigeriq-core/update-core-runtime.ps1',import.meta.url),'utf8');

test('coding lane cannot target protected or unsafe paths',()=>{
  assert.equal(safeRepoPath('apps/demo/file.ts'),true);
  assert.equal(safeRepoPath('.github/workflows/ci.yml'),false);
  assert.equal(safeRepoPath('docs/EXECUTION_BOUNDARY.md'),false);
  assert.equal(safeRepoPath('scripts/tigeriq-core/run-core.ps1'),false);
  assert.equal(safeRepoPath('../escape.ts'),false);
  assert.throws(()=>validateChanges([{path:'apps/b.ts',content:'x'}],['apps/a.ts']),/OUTSIDE_MANAGER_SCOPE/);
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
