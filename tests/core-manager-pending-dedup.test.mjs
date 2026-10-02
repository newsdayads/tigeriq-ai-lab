import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MANAGER_PENDING_JOB_STATUSES, managerHasPendingBatch, managerMayDecideNext } from '../apps/tigeriq-core/manager-batch-policy.mjs';

const source=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');

test('pending batch states cover every nonterminal manager-blocking state',()=>{
  assert.deepEqual(
    [...MANAGER_PENDING_JOB_STATUSES],
    ['queued','waiting_resource','dispatching','running','ui_assigned','ui_running'],
  );
});

test('live repro shape stays blocked while one of exactly three jobs is waiting_resource',()=>{
  const jobs=[
    {title:'Canary A verification',status:'done'},
    {title:'Canary B verification',status:'waiting_resource'},
    {title:'Canary C verification',status:'done'},
  ];
  assert.equal(managerHasPendingBatch(jobs),true);
  assert.equal(managerMayDecideNext(jobs),false);
  assert.equal(jobs.length,3,'manager must not materialize another A/B/C batch while B waits');
});

test('dispatching also blocks a new manager decision',()=>{
  assert.equal(managerMayDecideNext([{status:'done'},{status:'dispatching'}]),false);
});

test('all terminal jobs reopen manager decision for genuinely new work',()=>{
  const terminal=[{status:'done'},{status:'failed'},{status:'done'}];
  assert.equal(managerHasPendingBatch(terminal),false);
  assert.equal(managerMayDecideNext(terminal),true);
});

test('production manager eligibility query uses the shared pending status policy before job creation',()=>{
  const start=source.indexOf('async function managerTick()');
  const end=source.indexOf('const o=q.rows[0]',start);
  assert.ok(start>=0&&end>start,'managerTick eligibility query must exist');
  const query=source.slice(start,end);
  assert.match(query,/j\.status=any\(\$1::text\[\]\)/);
  assert.match(query,/\[MANAGER_PENDING_JOB_STATUSES\]\)/);
  const guard=source.indexOf("j.status=any($1::text[])");
  const randomJob=source.indexOf("capability==='pc_operator'?pcOperatorJobId");
  assert.ok(guard>=0&&randomJob>guard,'pending-batch guard must run before random-ID job creation');
});
