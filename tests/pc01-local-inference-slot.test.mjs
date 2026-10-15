import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {withPc01LocalInferenceSlot,localInferenceBusy,PC01_LOCAL_INFERENCE_LOCK_KEY} from '../apps/tigeriq-core/pc01-local-inference-slot.mjs';

function fakePool(){
  const state={locked:false,claims:0,releases:0};
  return {state,async connect(){
    return {async query(sql,args){
      assert.deepEqual(args,[PC01_LOCAL_INFERENCE_LOCK_KEY]);
      if(sql.includes('pg_try_advisory_lock')){
        state.claims++;
        if(state.locked)return {rows:[{acquired:false}]};
        state.locked=true;return {rows:[{acquired:true}]};
      }
      if(sql.includes('pg_advisory_unlock')){
        state.releases++;const ok=state.locked;state.locked=false;
        return {rows:[{released:ok}]};
      }
      throw new Error('UNEXPECTED_SQL');
    },release(){}};
  }};
}
test('NV08/NV09/NV10 share one atomic inference slot; occupied returns busy',async()=>{
  const pool=fakePool();
  let unlockFirst;
  const pending=new Promise(resolve=>{unlockFirst=resolve});
  let begun;const began=new Promise(resolve=>{begun=resolve});
  const first=withPc01LocalInferenceSlot(pool,async()=>{begun();await pending;return 'NV08';});
  await began;
  await assert.rejects(withPc01LocalInferenceSlot(pool,async()=>{throw Error('OVERLAP')},{waitMs:0}),e=>localInferenceBusy(e));
  unlockFirst();
  assert.equal(await first,'NV08');
  assert.equal(await withPc01LocalInferenceSlot(pool,async()=> 'NV09',{waitMs:0}),'NV09');
  assert.equal(pool.state.releases,2);
});
test('inference failure releases slot so NV10 can continue',async()=>{
  const pool=fakePool();
  await assert.rejects(withPc01LocalInferenceSlot(pool,async()=>{throw new Error('MODEL_TIMEOUT')}),/MODEL_TIMEOUT/);
  assert.equal(await withPc01LocalInferenceSlot(pool,async()=> 'NV10'),'NV10');
  assert.equal(pool.state.releases,2);
});
test('missing shared DB must not silently disable hardware serialization',async()=>{
  await assert.rejects(withPc01LocalInferenceSlot(null,async()=>true),/PC01_LOCAL_INFERENCE_DB_REQUIRED/);
});
test('Core Manager, API Doctor, NV API repair and Coding share gate without role substitution',()=>{
  const core=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
  const coding=readFileSync(new URL('../apps/tigeriq-coding-lane/coding-lane.mjs',import.meta.url),'utf8');
  assert.match(core,/withPc01LocalInferenceSlot\(pool,async\(\)=>/);
  assert.match(core,/runApiDoctorAnalysisJobInSlot/);
  assert.match(core,/CORE_LOCAL_AUTOWORK_EMPLOYEES = Object\.freeze\(\[OLLAMA_EMPLOYEE_ID\]\)/);
  assert.match(coding,/selectCodingWorker/);
  assert.match(coding,/withPc01LocalInferenceSlot\(pool,/);
  assert.match(coding,/const ordered=\[initial,\.\.\.eligible\.filter/);
});
