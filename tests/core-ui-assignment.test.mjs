import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCoreUiAssignmentSnapshot,
  buildCoreUiPrompt,
  parseCoreUiIssue,
  readyUnassignedCoreUiSnapshot,
  selectCoreUiWorker,
} from '../apps/tigeriq-core/core-ui-assignment.mjs';

test('Core UI assignment classification is permanently disabled',()=>{
  assert.equal(selectCoreUiWorker('general'),null);
  assert.equal(selectCoreUiWorker('review'),null);
  assert.equal(selectCoreUiWorker('research'),null);
  assert.equal(parseCoreUiIssue({number:1,state:'open',body:'PRIORITY=P1\nTIGERIQ_EXECUTABLE=true'}),null);
  assert.throws(()=>buildCoreUiPrompt({}),/CORE_UI_ASSIGNMENT_DISABLED/);
});

test('Core UI assignment snapshot exposes no authority and no work',async()=>{
  let touched=false;
  const pool={query:async()=>{touched=true;throw new Error('CORE_UI_DB_MUST_NOT_BE_TOUCHED');}};
  const fetchImpl=async()=>{touched=true;throw new Error('CORE_UI_GITHUB_MUST_NOT_BE_TOUCHED');};
  const snap=await buildCoreUiAssignmentSnapshot({pool,fetchImpl,previousJobId:'GH-123'});
  assert.equal(touched,false);
  assert.equal(snap.source,'CORE');
  assert.equal(snap.authority,'NONE');
  assert.equal(snap.assignmentState,'EXTERNAL_TO_CORE');
  assert.equal(snap.reason,'NV02_NV03_NV04_NOT_CORE_ROUTED');
  assert.equal(snap.nextJob,undefined);
  assert.deepEqual(snap.nextJobs,[]);
  assert.deepEqual(snap.requiredWorkers,[]);
  for(const worker of ['NV02','NV03','NV04']){
    assert.equal(snap.workerBindings[worker].state,'EXTERNAL_TO_CORE');
    assert.equal(snap.workerBindings[worker].currentWorkOrder,null);
  }
});

test('legacy ready snapshot helper cannot imply READY_UNASSIGNED authority',()=>{
  const snap=readyUnassignedCoreUiSnapshot({observedAt:'2026-09-27T00:00:00Z'});
  assert.equal(snap.authority,'NONE');
  assert.equal(snap.assignmentState,'EXTERNAL_TO_CORE');
  assert.equal(snap.reason,'UI_WORKERS_EXTERNAL_TO_CORE');
});
