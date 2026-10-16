import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV='test';
const {
  restartRecoveryDecision,
  staleRunningRecoveryDecision,
  recoverAfterCodingRestart,
  recoverStaleRunningJobs
}=await import('../apps/tigeriq-coding-lane/coding-lane.mjs');

const packet='Execute bounded step\n\nCODING_STEP_PACKET_JSON={"schema":"TIGERIQ_CODING_STEP_V1","source_head_sha":"'+
  'a'.repeat(40)+'"}';
const merged={state:'closed',merged:true,merged_at:'2026-10-16T01:00:00Z'};
const baseJob={
  id:'G6-CANARY-1',objective_id:'G6-OBJ-1',status:'running',
  branch:'tigeriq/nv09/g6-canary-1',pr_number:4893,instruction:packet,
  started_at:'2026-10-15T01:00:00Z',stale_recovery_count:0,
  objective:'GitHub autonomous coding issue #4902'
};
const code='CODING_RESTART_CANARY_MERGED_UNACCEPTED';

test('G6: merged P0 step packet is NOT product acceptance after restart',()=>{
  for(const pr of [merged,{state:'closed',merged:false,merged_at:merged.merged_at}]){
    assert.deepEqual(restartRecoveryDecision(baseJob,pr),{
      action:'fail',code,prNumber:4893
    });
  }
  assert.equal(restartRecoveryDecision(
    {...baseJob,instruction:'CODING_STEP_PACKET_JSON={corrupted}'},merged
  ).code,code);
  assert.equal(restartRecoveryDecision(
    {...baseJob,instruction:'Old legacy coding job'},merged
  ).action,'done');
  assert.equal(restartRecoveryDecision(
    baseJob,{state:'open',merged:false}
  ).action,'queue');
});

test('G6: stale-running watchdog cannot turn merged unaccepted step into DONE',()=>{
  const decision=staleRunningRecoveryDecision(baseJob,{
    nowMs:Date.parse('2026-10-16T03:00:00Z'),active:false,
    staleMs:1000,maxRequeues:2,sourceExecutable:true,pr:merged
  });
  assert.equal(decision.action,'fail');
  assert.equal(decision.code,code);
});

function fakeDb(job,{stale=false}={}){
  const queries=[];
  const db={query:async (sql,params=[])=>{
    queries.push({sql,params});
    if(!stale&&sql.startsWith('select * from tigeriq_coding_jobs'))
      return {rows:[job]};
    if(stale&&sql.startsWith('select j.*,o.objective from tigeriq_coding_jobs'))
      return {rows:[job]};
    if(sql.startsWith('update tigeriq_coding_jobs set status=')){
      if(sql.includes("status='done'"))throw Error('G6_REGRESSION_FAKE_DONE');
      return {rowCount:1};
    }
    if(sql.startsWith('update tigeriq_coding_objectives set status=')){
      if(sql.includes("status='completed'"))throw Error('G6_REGRESSION_FAKE_COMPLETED');
      return {rowCount:1};
    }
    throw Error('G6_UNEXPECTED_DB_SQL:'+sql.slice(0,80));
  }};
  return {db,queries};
}

test('G6: actual restart reconciliation only records failed/blocked, not done/completed',async()=>{
  const {db,queries}=fakeDb(baseJob);
  const out=await recoverAfterCodingRestart({db,fetchPr:async()=>merged});
  assert.equal(out.failed,1);
  assert.equal(out.completed,0);
  assert.equal(out.requeued,0);
  assert(queries.some(q=>q.sql.includes("set status='failed'")));
  assert(queries.some(q=>q.sql.includes("set status='blocked'")));
  assert(queries.some(q=>JSON.stringify(q.params).includes(code)));
});

test('G6: actual stale watchdog reconciliation fails closed without accepting merged PR',async()=>{
  const {db,queries}=fakeDb(baseJob,{stale:true});
  const out=await recoverStaleRunningJobs({
    db,activeIds:new Set(),fetchPr:async()=>merged,
    nowMs:Date.parse('2026-10-16T03:00:00Z'),staleMs:1000
  });
  assert.equal(out.scanned,1);
  assert.equal(out.failed,1);
  assert.equal(out.requeued,0);
  assert(queries.some(q=>q.sql.includes("set status='failed'")));
  assert(queries.some(q=>q.sql.includes("set status='blocked'")));
  assert(queries.some(q=>JSON.stringify(q.params).includes(code)));
});
