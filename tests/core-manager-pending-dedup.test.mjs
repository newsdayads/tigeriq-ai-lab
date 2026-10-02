import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');

function managerEligibilityQuery(){
  const start=source.indexOf('async function managerTick()');
  const end=source.indexOf('const o=q.rows[0]',start);
  assert.ok(start>=0&&end>start,'managerTick eligibility query must exist');
  return source.slice(start,end);
}

test('generic manager waits for every nonterminal prior-batch state',()=>{
  const query=managerEligibilityQuery();
  for(const status of ['queued','waiting_resource','dispatching','running','ui_assigned','ui_running']){
    assert.match(query,new RegExp(`['"]${status}['"]`),`manager eligibility must exclude ${status}`);
  }
});

test('waiting_resource cannot make the same objective eligible for a fresh manager batch',()=>{
  const query=managerEligibilityQuery();
  assert.match(
    query,
    /not exists\(select 1 from tigeriq_jobs j where j\.objective_id=o\.id and j\.status in \('queued','waiting_resource','dispatching','running','ui_assigned','ui_running'\)\)/,
  );
});

test('random-id AI job materialization remains downstream of the pending-batch guard',()=>{
  const guard=source.indexOf("j.status in ('queued','waiting_resource','dispatching','running','ui_assigned','ui_running')");
  const randomJob=source.indexOf("capability==='pc_operator'?pcOperatorJobId");
  assert.ok(guard>=0&&randomJob>guard,'pending-batch guard must run before random-ID job creation');
});
