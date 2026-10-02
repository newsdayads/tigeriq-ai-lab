import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  STABILITY_V2_EMPLOYEE_ALLOWLIST,
  STABILITY_V2_RESOURCE_SCOPE,
  stabilityV2EmployeeAllowlist,
  stabilityV2ExpectedGroups,
  stabilityV2OutputContract,
  stabilityV2Plan,
} from '../apps/tigeriq-core/stability-v2.mjs';

const groups=stabilityV2ExpectedGroups();
const baseMs=Date.parse('2026-10-02T17:00:00Z');
const providers=['groq','cloudflare','nvidia'];
const employees=['NV11','NV15','NV20'];

function completedGroups(count,{startMs=baseMs}={}){
  const rows=[];
  for(let groupIndex=0;groupIndex<count;groupIndex++){
    const group=groups[groupIndex];
    for(let index=0;index<group.specs.length;index++){
      const spec=group.specs[index];
      rows.push({
        id:`J-${groupIndex}-${index}`,
        title:spec.title,
        capability:spec.capability,
        kind:'ai',
        status:'done',
        employee_id:employees[index%employees.length],
        provider:group.batch===1?providers[index]:providers[index%providers.length],
        result:{text:`${spec.marker} verified`,failures:[]},
        created_at:new Date(startMs+group.round*1000+group.batch*100+index).toISOString(),
      });
    }
  }
  return rows;
}

test('stability v2 starts with exactly three Round 1 general jobs',()=>{
  const plan=stabilityV2Plan({resourceScope:STABILITY_V2_RESOURCE_SCOPE,jobs:[],nowMs:baseMs,lastDeepAuditMs:baseMs});
  assert.equal(plan.action,'materialize');
  assert.equal(plan.round,1);
  assert.equal(plan.batch,1);
  assert.equal(plan.capability,'general');
  assert.equal(plan.specs.length,3);
  assert.deepEqual(plan.specs.map(x=>x.title),[
    'STAB-R1-General-Batch1-Job1',
    'STAB-R1-General-Batch1-Job2',
    'STAB-R1-General-Batch1-Job3',
  ]);
});

test('malformed helper STAB job fails closed instead of becoming counted work',()=>{
  const plan=stabilityV2Plan({
    resourceScope:STABILITY_V2_RESOURCE_SCOPE,
    jobs:[{id:'helper',title:'STAB-R1-Create General Batch (3 jobs)',status:'done'}],
    nowMs:baseMs,
  });
  assert.equal(plan.action,'block');
  assert.equal(plan.reason,'malformed_stability_job');
});

test('duplicate logical stability title fails closed',()=>{
  const title='STAB-R1-General-Batch1-Job1';
  const plan=stabilityV2Plan({
    resourceScope:STABILITY_V2_RESOURCE_SCOPE,
    jobs:[{id:'a',title,status:'done'},{id:'b',title,status:'done'}],
    nowMs:baseMs,
  });
  assert.equal(plan.action,'block');
  assert.equal(plan.reason,'duplicate_stability_job');
});

test('Round 1 batch2 materializes only after three-provider batch1 success',()=>{
  const plan=stabilityV2Plan({
    resourceScope:STABILITY_V2_RESOURCE_SCOPE,
    jobs:completedGroups(1),
    nowMs:baseMs+10000,
    lastDeepAuditMs:baseMs,
  });
  assert.equal(plan.action,'materialize');
  assert.equal(plan.round,1);
  assert.equal(plan.batch,2);
  assert.equal(plan.capability,'reasoning');
  assert.equal(plan.specs.length,2);
});

test('batch1 requires three independent providers',()=>{
  const jobs=completedGroups(1).map(row=>({...row,provider:'cloudflare'}));
  const plan=stabilityV2Plan({resourceScope:STABILITY_V2_RESOURCE_SCOPE,jobs,nowMs:baseMs+10000});
  assert.equal(plan.action,'block');
  assert.equal(plan.reason,'batch1_provider_diversity_failed');
});

test('done status is not enough: capability, kind and success marker must match the canonical job contract',()=>{
  for(const mutate of [
    row=>({...row,capability:'reasoning'}),
    row=>({...row,kind:'readonly'}),
    row=>({...row,result:{text:'provider refusal without marker',failures:[]}}),
  ]){
    const jobs=completedGroups(1);
    jobs[0]=mutate(jobs[0]);
    const plan=stabilityV2Plan({resourceScope:STABILITY_V2_RESOURCE_SCOPE,jobs,nowMs:baseMs+10000});
    assert.equal(plan.action,'block');
    assert.equal(plan.reason,'job_contract_mismatch');
  }
});

test('stability output contract rejects nonempty garbage before it can count as provider success',()=>{
  const spec=groups[0].specs[0];
  const jobId='STAB-OBJ-X-R1-B1-J1';
  assert.deepEqual(
    stabilityV2OutputContract({jobId,prompt:spec.prompt,text:'1.1.1.1 nonempty garbage'}),
    {handled:true,ok:false,marker:spec.marker,code:'STABILITY_V2_OUTPUT_CONTRACT_MISMATCH'},
  );
  assert.deepEqual(
    stabilityV2OutputContract({jobId,prompt:spec.prompt,text:`${spec.marker} valid answer`}),
    {handled:true,ok:true,marker:spec.marker,code:null},
  );
});

test('stability output contract does not affect ordinary non-stability jobs',()=>{
  assert.deepEqual(
    stabilityV2OutputContract({jobId:'JOB-ordinary',prompt:'ordinary',text:'anything nonempty'}),
    {handled:false,ok:true,marker:null,code:null},
  );
});

test('STAB job without a canonical prompt marker fails closed at routed output contract',()=>{
  assert.deepEqual(
    stabilityV2OutputContract({jobId:'STAB-OBJ-X-BAD',prompt:'missing canonical marker',text:'nonempty'}),
    {handled:true,ok:false,marker:null,code:'STABILITY_V2_JOB_CONTRACT_UNKNOWN'},
  );
});

test('any attempted route outside NV11-NV20 fails closed even when final worker is allowed',()=>{
  const jobs=completedGroups(1);
  jobs[1]={...jobs[1],result:{...jobs[1].result,failures:[{employeeId:'NV10',provider:'ollama',kind:'timeout'}]}};
  const plan=stabilityV2Plan({resourceScope:STABILITY_V2_RESOURCE_SCOPE,jobs,nowMs:baseMs+10000});
  assert.equal(plan.action,'block');
  assert.equal(plan.reason,'out_of_scope_employee');
});

test('next round waits for both 5-minute spacing and later deep-audit cadence',()=>{
  const jobs=completedGroups(2);
  const firstR1=Math.min(...jobs.filter(row=>row.title.startsWith('STAB-R1-')).map(row=>Date.parse(row.created_at)));
  const due=firstR1+300000;

  let plan=stabilityV2Plan({
    resourceScope:STABILITY_V2_RESOURCE_SCOPE,jobs,
    nowMs:due-1,lastDeepAuditMs:due+1000,
  });
  assert.equal(plan.action,'wait');
  assert.equal(plan.reason,'round_spacing');

  plan=stabilityV2Plan({
    resourceScope:STABILITY_V2_RESOURCE_SCOPE,jobs,
    nowMs:due+1000,lastDeepAuditMs:due-1,
  });
  assert.equal(plan.action,'wait');
  assert.equal(plan.reason,'deep_audit_cadence_pending');

  plan=stabilityV2Plan({
    resourceScope:STABILITY_V2_RESOURCE_SCOPE,jobs,
    nowMs:due+1000,lastDeepAuditMs:due,
  });
  assert.equal(plan.action,'materialize');
  assert.equal(plan.round,2);
  assert.equal(plan.batch,1);
  assert.equal(plan.capability,'reasoning');
});

test('all three canonical rounds complete at exactly 15 STAB jobs',()=>{
  const jobs=completedGroups(6);
  assert.equal(jobs.length,15);
  const plan=stabilityV2Plan({
    resourceScope:STABILITY_V2_RESOURCE_SCOPE,
    jobs,
    nowMs:baseMs+900000,
    lastDeepAuditMs:baseMs+900000,
  });
  assert.deepEqual(plan,{handled:true,action:'complete',reason:'three_rounds_complete',rounds:3,totalJobs:15});
});

test('stability worker allowlist is NV11 through NV20 and excludes NV10',()=>{
  const allow=stabilityV2EmployeeAllowlist({resourceScope:STABILITY_V2_RESOURCE_SCOPE});
  assert.deepEqual(allow,[...STABILITY_V2_EMPLOYEE_ALLOWLIST]);
  assert.equal(allow.includes('NV10'),false);
  assert.equal(allow.includes('NV11'),true);
  assert.equal(allow.includes('NV20'),true);
});

test('production wiring suppresses GitHub helper auto-work and applies allowlist to normal STAB jobs',()=>{
  const core=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
  const intake=readFileSync(new URL('../apps/tigeriq-core/github-intake.mjs',import.meta.url),'utf8');
  assert.match(core,/reconcileStabilityV2Objective\(o\)/);
  assert.match(core,/stabilityV2EmployeeAllowlist\(j\.objective_metadata\)/);
  assert.match(core,/validateRoutedOutput\(await invokeProvider\(r,prompt\),\{jobId,prompt\}\)/);
  assert.match(core,/STABILITY_V2_BATCH_MATERIALIZED/);
  assert.match(intake,/!isStabilityV2ResourceScope\(spec\.resourceScope\)/);
});
