import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');

function loadResourceWaitHelpers(){
  const start=source.indexOf('const RESOURCE_WAIT_MAX_RETRIES=');
  const end=source.indexOf('\nasync function busyCapableResourceCount',start);
  assert.ok(start>=0&&end>start,'resource wait helpers must exist in production source');
  const code=source.slice(start,end).replace(/export function /g,'function ');
  return new Function(`${code}; return {resourceWaitPlan,shouldWaitForBusyResource};`)();
}

test('temporary busy contention waits without consuming terminal failure budget',()=>{
  const {resourceWaitPlan,shouldWaitForBusyResource}=loadResourceWaitHelpers();
  assert.equal(shouldWaitForBusyResource({message:'NO_AI_RESOURCE_AVAILABLE',failures:[],busyCapableCount:2}),true);
  assert.equal(shouldWaitForBusyResource({message:'NO_AI_RESOURCE_AVAILABLE',failures:[{kind:'rate_limit'}],busyCapableCount:2}),false);
  assert.equal(shouldWaitForBusyResource({message:'POLICY_DENIED',failures:[],busyCapableCount:2}),false);
  const first=resourceWaitPlan({waitCount:0,startedAt:'2026-09-21T00:00:00Z',nowMs:Date.parse('2026-09-21T00:00:01Z')});
  assert.equal(first.wait,true);
  assert.equal(first.count,1);
  assert.equal(first.delayMs,30000);
  assert.ok(Date.parse(first.nextAttemptAt)>Date.parse('2026-09-21T00:00:01Z'));
});

test('resource wait is bounded',()=>{
  const {resourceWaitPlan}=loadResourceWaitHelpers();
  const exhausted=resourceWaitPlan({waitCount:6,startedAt:'2026-09-21T00:00:00Z',nowMs:Date.parse('2026-09-21T00:10:00Z')});
  assert.equal(exhausted.wait,false);
  assert.equal(exhausted.nextAttemptAt,null);
});

test('durable DB state and claim eligibility are wired to production loop',()=>{
  assert.match(source,/add column if not exists next_attempt_at timestamptz/);
  assert.match(source,/add column if not exists resource_wait_count int not null default 0/);
  assert.match(source,/status='waiting_resource'.*next_attempt_at/s);
  assert.match(source,/RESOURCE_WAIT_QUEUED/);
  assert.match(source,/RESOURCE_WAIT_RELEASED/);
  assert.match(source,/busyCapableResourceCount\(j\.capability\)/);
  assert.doesNotMatch(source,/while\s*\(true\)\s*\{\s*try\s*\{\s*await runJob\(j\)/);
});
