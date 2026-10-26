import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {apiDoctorGlobalAnalysisAdmission as admit} from '../apps/tigeriq-core/api-doctor.mjs';

test('rate-limit all NV10 Doctor analysis across different diagnostic signatures',()=>{
  const now=Date.parse('2026-10-26T02:00:00Z');
  assert.equal(admit({nowMs:now}).allowed,true);
  assert.deepEqual(admit({lastAttemptAt:'2026-10-26T01:31:00Z',nowMs:now}),
    {allowed:false,reason:'GLOBAL_API_DOCTOR_ANALYSIS_BUDGET'});
  assert.equal(admit({lastAttemptAt:'2026-10-26T01:30:00Z',nowMs:now}).allowed,true);
  assert.equal(admit({lastAttemptAt:'2026-10-26T02:01:00Z',nowMs:now}).allowed,false);
  assert.equal(admit({nowMs:NaN}).allowed,false);
});

test('budget is checked before any new analysis job and real work remains independent',()=>{
  const core=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
  assert.match(core,/API_DOCTOR_INTERVAL_MS = Math.max\(600000,/);
  assert.match(core,/API_DOCTOR_GLOBAL_ANALYSIS_BUDGET_MS = Math.max\(1800000,/);
  assert.match(core,/type in \('API_DOCTOR_ANALYSIS_DONE','API_DOCTOR_ANALYSIS_FAILED'\)/);
  const budgetAt=core.indexOf('const budget=apiDoctorGlobalAnalysisAdmission(');
  const jobAt=core.indexOf('const id='+'\x60API-DOC-');
  assert.ok(budgetAt>0 && jobAt>budgetAt);
  assert.match(core,/deferred_for_real_github_work/);
  assert.match(core,/global_analysis_budget/);
  assert.match(core,/if\(!managerTickRunning&&t-lastManager>MANAGER_IDLE_MS\)/);
});
