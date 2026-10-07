import test from 'node:test';
import assert from 'node:assert/strict';
import { governPlanDelta, validatePlanDelta } from '../apps/tigeriq-core/manager-plan-delta.mjs';
import { managerRoleIdentity, managerShadowEnabled, rankManagerShadowCandidates, runManagerShadowPlan } from '../apps/tigeriq-core/manager-ha-shadow.mjs';

const NOW=Date.parse('2026-10-07T12:00:00Z');
function resource({id,employee,rank=10,latency=100,provider='gemini'}){
  return {
    resource_id:id,employee_id:employee,provider,model:'test-model',enabled:true,
    health_state:'ONLINE',credential_state:'READY',cost_tier:'FREE',rank,last_latency_ms:latency,
    capabilities:['reasoning','general'],
    functionalEvidence:{failureStreak:0,lastSuccessAt:'2026-10-07T11:59:30Z',lastFailureAt:null},
    quota_state:{known:true,usable:true,remainingRatio:1},
  };
}
function task(id,overrides={}){
  return {
    id,title:'Task '+id,action:'create',capability:'reasoning',priority:'P1',resourceScope:'SCOPE_'+id,
    dependencies:[],acceptance:['observable result'],evidenceRequired:['test evidence'],concurrencyGroup:null,
    estimatedEffortClass:'S',preferredSkills:[],
    effects:{repoMutation:false,productionRelease:false,paidCost:false,credentialChange:false,securityBoundaryChange:false,destructive:false},
    implementerResourceId:null,reviewerResourceId:null,
    ...overrides,
  };
}
function plan(overrides={}){
  return {
    schema:'TIGERIQ_PLAN_DELTA_V1',objectiveId:'OBJ-1',sourceRevision:'rev-1',
    assessment:{state:'continue',summary:'continue safely'},
    tasks:[task('T1')],criticalPath:['T1'],parallelGroups:[],replanTriggers:['task terminal'],
    ...overrides,
  };
}

test('shadow feature flag defaults OFF and causes zero invocation',async()=>{
  assert.equal(managerShadowEnabled({}),false);
  let calls=0;
  const out=await runManagerShadowPlan({env:{},resources:[resource({id:'r1',employee:'NV12'})],objectiveId:'OBJ-1',sourceRevision:'rev-1',goal:'g',invoke:async()=>{calls++;return plan();},nowMs:NOW});
  assert.equal(out.state,'disabled');assert.equal(out.invoked,false);assert.equal(out.evidence.sideEffects,0);assert.equal(calls,0);
});

test('PLAN_DELTA validator rejects unknown, malformed, stale and cyclic plans',()=>{
  assert.throws(()=>validatePlanDelta({...plan(),extra:true}),/PLAN_DELTA_UNKNOWN_KEY/);
  assert.throws(()=>validatePlanDelta({...plan(),sourceRevision:'old'},{expectedSourceRevision:'rev-1'}),/PLAN_STALE_SOURCE_REVISION/);
  assert.throws(()=>validatePlanDelta({...plan(),tasks:[task('T1',{dependencies:['T2']}),task('T2',{dependencies:['T1']})],criticalPath:['T1','T2']}),/PLAN_DAG_CYCLE/);
  assert.throws(()=>validatePlanDelta({...plan(),tasks:[task('T1',{priority:'P0'})]}),/PLAN_TASK_PRIORITY_INVALID/);
});

test('deterministic governor rejects unsafe effects, active writer scope and reviewer collision',()=>{
  let out=governPlanDelta({...plan(),tasks:[task('T1',{effects:{repoMutation:false,productionRelease:true,paidCost:false,credentialChange:false,securityBoundaryChange:false,destructive:false}})]},{expectedObjectiveId:'OBJ-1',expectedSourceRevision:'rev-1'});
  assert.equal(out.decision,'reject');assert.equal(out.reason,'UNSAFE_PLAN_EFFECT');
  out=governPlanDelta({...plan(),tasks:[task('T1',{effects:{repoMutation:true,productionRelease:false,paidCost:false,credentialChange:false,securityBoundaryChange:false,destructive:false}})]},{activeResourceScopes:['SCOPE_T1']});
  assert.equal(out.reason,'RESOURCE_SCOPE_BUSY');
  out=governPlanDelta({...plan(),tasks:[task('T1',{capability:'review',implementerResourceId:'r1',reviewerResourceId:'r1'})]});
  assert.equal(out.reason,'REVIEWER_CONFLICT');
});

test('governor trims deterministically while preserving dependency order',()=>{
  const p=plan({
    tasks:[
      task('T3',{dependencies:['T2']}),
      task('T1'),
      task('T2',{dependencies:['T1']}),
      task('T4',{dependencies:['T3']}),
    ],
    criticalPath:['T1','T2','T3','T4'],
    parallelGroups:[{id:'G1',tasks:['T1','T2','T3','T4']}],
  });
  const out=governPlanDelta(p,{maxTasks:3});
  assert.equal(out.decision,'trim');
  assert.deepStrictEqual(out.plan.tasks.map(x=>x.id),['T1','T2','T3']);
  assert.deepStrictEqual(out.trimmedTaskIds,['T4']);
  assert.deepStrictEqual(out.plan.criticalPath,['T1','T2','T3']);
});

test('Manager is a role and candidate selection is dynamic, not bound to NV09',()=>{
  const resources=[
    resource({id:'r-nv09',employee:'NV09',rank:20,latency:60000,provider:'ollama'}),
    resource({id:'r-nv20',employee:'NV20',rank:1,latency:4000,provider:'nvidia'}),
  ];
  const ranked=rankManagerShadowCandidates(resources,{nowMs:NOW,maxProviders:2});
  assert.equal(ranked.eligible[0].resource.employee_id,'NV20');
  assert.deepStrictEqual(managerRoleIdentity(ranked.eligible[0].resource),{role:'MANAGER',employeeId:'NV20',resourceId:'r-nv20',provider:'nvidia',model:'test-model'});
});

test('shadow planner fails over provider error and returns validated evidence with zero side effects',async()=>{
  const resources=[
    resource({id:'r1',employee:'NV12',rank:1,provider:'gemini'}),
    resource({id:'r2',employee:'NV17',rank:2,provider:'inception'}),
  ];
  const invoked=[];
  const out=await runManagerShadowPlan({
    env:{TIGERIQ_CORE_VNEXT_SHADOW:'true'},resources,objectiveId:'OBJ-1',sourceRevision:'rev-1',goal:'shadow plan',nowMs:NOW,
    invoke:async(r)=>{invoked.push(r.resource_id);if(r.resource_id==='r1')throw Object.assign(new Error('timeout'),{kind:'timeout'});return plan();},
  });
  assert.equal(out.state,'planned');assert.equal(out.role.employeeId,'NV17');assert.deepStrictEqual(invoked,['r1','r2']);
  assert.equal(out.failures.length,1);assert.equal(out.evidence.sideEffects,0);assert.equal(out.evidence.shadowOnly,true);
});

test('unsafe provider output is not accepted and exhaustion defers without global stop',async()=>{
  const unsafe=plan({tasks:[task('T1',{effects:{repoMutation:false,productionRelease:false,paidCost:false,credentialChange:true,securityBoundaryChange:false,destructive:false}})]});
  const out=await runManagerShadowPlan({
    env:{TIGERIQ_CORE_VNEXT_SHADOW:'1'},
    resources:[resource({id:'r1',employee:'NV12',rank:1}),resource({id:'r2',employee:'NV17',rank:2})],
    objectiveId:'OBJ-1',sourceRevision:'rev-1',goal:'unsafe must reject',nowMs:NOW,
    invoke:async()=>unsafe,
  });
  assert.equal(out.state,'deferred');assert.equal(out.reason,'MANAGER_SHADOW_PROVIDERS_EXHAUSTED');
  assert.equal(out.failures.length,2);assert.equal(out.evidence.sideEffects,0);
});
