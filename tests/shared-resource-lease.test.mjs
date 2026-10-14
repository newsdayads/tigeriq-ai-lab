import {readFileSync} from 'node:fs';
import assert from 'node:assert';
import {test as vitestTest} from 'vitest';
import {
  acquireSharedResourceLease,
  activeSharedResourceLeases,
  recoverExpiredSharedResourceLeases,
  releaseSharedResourceLease,
  readVerifiedNv07CanaryCoreLease,
  bindNv07CanaryCoreLeaseCallback,
  NV07_CANARY_CORE_SCOPE,
  sharedLeaseIdleWorkState,
} from '../apps/tigeriq-core/shared-resource-lease.mjs';
import {invokeJsonWithFailover} from '../apps/tigeriq-coding-lane/coding-lane.mjs';

const test=(name,fn)=>vitestTest(name,fn);

function fakeLeaseDb({employeeId='NV09',resourceId='res:ollama:nv09',healthState='ONLINE'}={}){
  const state={
    ai:{resource_id:resourceId,employee_id:employeeId,enabled:true,rank:1,current_job_id:null,health_state:healthState,work_state:employeeId==='NV09'?'ON_DEMAND':'IDLE'},
    employee:{employee_id:employeeId,current_job_id:null,health_state:healthState,work_state:employeeId==='NV09'?'ON_DEMAND':'IDLE'},
    lease:null,
  };
  const query=async(sql,args=[])=>{
    const q=String(sql).replace(/\s+/g,' ').trim().toLowerCase();
    if(['begin','commit','rollback'].includes(q))return {rows:[],rowCount:0};
    if(q.includes('select * from tigeriq_ai_resources')&&q.includes('where resource_id=$1 and employee_id=$2')){
      const ok=state.ai.enabled&&state.ai.resource_id===args[0]&&state.ai.employee_id===args[1];
      return {rows:ok?[{...state.ai}]:[],rowCount:ok?1:0};
    }
    if(q.includes('select * from tigeriq_ai_resources')&&q.includes('where employee_id=$1')){
      return {rows:state.ai.enabled&&state.ai.employee_id===args[0]?[{...state.ai}]:[],rowCount:state.ai.employee_id===args[0]?1:0};
    }
    if(q==='select * from tigeriq_ai_resources where resource_id=$1'){
      return {rows:state.ai.resource_id===args[0]?[{...state.ai}]:[],rowCount:state.ai.resource_id===args[0]?1:0};
    }
    if(q.includes('select resource_id,employee_id,current_job_id,health_state,work_state from tigeriq_ai_resources')&&q.includes('where resource_id=$1 for update')){
      const ok=state.ai.resource_id===args[0];
      return {rows:ok?[{...state.ai}]:[],rowCount:ok?1:0};
    }
    if(q.includes('select * from tigeriq_ai_resource_leases')&&q.includes('where resource_id=$1 and lease_token=$2')){
      const ok=state.lease&&state.lease.resource_id===args[0]&&state.lease.lease_token===args[1];
      return {rows:ok?[{...state.lease}]:[],rowCount:ok?1:0};
    }
    if(q.includes('select * from tigeriq_ai_resource_leases')&&q.includes('where resource_id=$1 and lease_until<=now() for update')){
      const ok=state.lease&&state.lease.resource_id===args[0]&&new Date(state.lease.lease_until).getTime()<=Date.now();
      return {rows:ok?[{...state.lease}]:[],rowCount:ok?1:0};
    }
    if(q.includes('select * from tigeriq_ai_resource_leases')&&q.includes('where resource_id=$1 for update')){
      const ok=state.lease&&state.lease.resource_id===args[0];
      return {rows:ok?[{...state.lease}]:[],rowCount:ok?1:0};
    }
    if(q.startsWith('insert into tigeriq_ai_resource_leases')){
      if(state.lease)return {rows:[],rowCount:0};
      state.lease={
        resource_id:args[0],employee_id:args[1],lane:args[2],work_id:args[3],role:args[4],
        lease_token:args[5],lease_until:new Date(Date.now()+Number(args[6])).toISOString(),heartbeat_at:new Date().toISOString(),metadata:JSON.parse(args[7]||'{}'),
      };
      return {rows:[{...state.lease}],rowCount:1};
    }
    if(q.startsWith('update tigeriq_ai_resources')&&q.includes("set current_job_id=$2,work_state='busy'")){
      if(state.ai.resource_id!==args[0]||state.ai.current_job_id)return {rows:[],rowCount:0};
      state.ai.current_job_id=args[1];state.ai.work_state='BUSY';
      return {rows:[{resource_id:state.ai.resource_id}],rowCount:1};
    }
    if(q.startsWith('update tigeriq_resources')&&q.includes("set current_job_id=$2,work_state='busy'")){
      if(state.employee.employee_id===args[0]&&(!state.employee.current_job_id||state.employee.current_job_id===args[1])){
        state.employee.current_job_id=args[1];state.employee.work_state='BUSY';
      }
      return {rows:[],rowCount:1};
    }
    if(q.startsWith('update tigeriq_ai_resources')&&q.includes('set current_job_id=null')){
      if(state.ai.resource_id===args[0]&&state.ai.current_job_id===args[1]){
        state.ai.current_job_id=null;state.ai.work_state=sharedLeaseIdleWorkState(state.ai.employee_id,state.ai.health_state);
      }
      return {rows:[],rowCount:1};
    }
    if(q.startsWith('update tigeriq_resources')&&q.includes('set current_job_id=null')){
      if(state.employee.employee_id===args[0]&&state.employee.current_job_id===args[1]){
        state.employee.current_job_id=null;state.employee.work_state=sharedLeaseIdleWorkState(state.employee.employee_id,state.employee.health_state);
      }
      return {rows:[],rowCount:1};
    }
    if(q.startsWith('delete from tigeriq_ai_resource_leases')){
      if(state.lease&&state.lease.resource_id===args[0]&&state.lease.lease_token===args[1])state.lease=null;
      return {rows:[],rowCount:1};
    }
    if(q.startsWith('select resource_id from tigeriq_ai_resource_leases')&&q.includes('where lease_until<=now()')){
      const expired=state.lease&&new Date(state.lease.lease_until).getTime()<=Date.now();
      return {rows:expired?[{resource_id:state.lease.resource_id}]:[],rowCount:expired?1:0};
    }
    if(q.startsWith('select resource_id,employee_id,lane,work_id,role,lease_until,heartbeat_at,metadata')){
      const active=state.lease&&new Date(state.lease.lease_until).getTime()>Date.now();
      if(!active)return {rows:[],rowCount:0};
      const {lease_token,...publicLease}=state.lease;
      return {rows:[publicLease],rowCount:1};
    }
    if(q.startsWith('with orphan as')&&q.includes("core-probe:%")){
      const work=state.ai.current_job_id;
      const allowed=String(work||'').startsWith('CORE-PROBE:')&&!state.lease;
      if(!allowed)return {rows:[],rowCount:0};
      state.ai.current_job_id=null;
      state.ai.work_state=sharedLeaseIdleWorkState(state.ai.employee_id,state.ai.health_state);
      return {rows:[{resource_id:state.ai.resource_id,employee_id:state.ai.employee_id,work_id:work}],rowCount:1};
    }
    throw new Error('UNHANDLED_FAKE_SQL:'+q);
  };
  return {state,query,connect:async()=>({query,release(){}})};
}

test('shared lease atomically blocks duplicate cross-lane acquire and owner release restores state',async()=>{
  const db=fakeLeaseDb();
  const first=await acquireSharedResourceLease(db,{employeeId:'NV09',workId:'CODE-1',role:'implementer',ttlMs:60000});
  assert.ok(first?.lease_token);
  assert.strictEqual(db.state.ai.current_job_id,'CODE-1');
  assert.strictEqual(db.state.ai.work_state,'BUSY');

  const duplicate=await acquireSharedResourceLease(db,{employeeId:'NV09',workId:'CORE-JOB-2',role:'manager',lane:'core',ttlMs:60000});
  assert.strictEqual(duplicate,null);
  assert.strictEqual(db.state.ai.current_job_id,'CODE-1');

  const wrongRelease=await releaseSharedResourceLease(db,{resourceId:first.resource_id,leaseToken:'wrong-token'});
  assert.strictEqual(wrongRelease,false);
  assert.strictEqual(db.state.ai.current_job_id,'CODE-1');

  const released=await releaseSharedResourceLease(db,{resourceId:first.resource_id,leaseToken:first.lease_token});
  assert.strictEqual(released,true);
  assert.strictEqual(db.state.ai.current_job_id,null);
  assert.strictEqual(db.state.ai.work_state,'ON_DEMAND');
});

test('exact-resource Core probe lease cannot overlap an existing Coding Lane lease',async()=>{
  const db=fakeLeaseDb();
  const codingLease=await acquireSharedResourceLease(db,{employeeId:'NV09',resourceId:'res:ollama:nv09',workId:'CODE-LEASE',role:'implementer',lane:'coding_lane',ttlMs:60000});
  assert.ok(codingLease?.lease_token);
  const probeLease=await acquireSharedResourceLease(db,{employeeId:'NV09',resourceId:'res:ollama:nv09',workId:'CORE-PROBE:stale-selection',role:'probe',lane:'core_probe',ttlMs:60000});
  assert.strictEqual(probeLease,null);
  assert.strictEqual(db.state.ai.current_job_id,'CODE-LEASE');
  await releaseSharedResourceLease(db,{resourceId:codingLease.resource_id,leaseToken:codingLease.lease_token});
});

test('expired shared lease recovery clears only matching occupancy',async()=>{
  const db=fakeLeaseDb({employeeId:'NV20',resourceId:'res:nvidia:nv20'});
  const lease=await acquireSharedResourceLease(db,{employeeId:'NV20',workId:'CODING-MANAGER:X',role:'manager',ttlMs:60000});
  assert.ok(lease);
  db.state.lease.lease_until=new Date(Date.now()-1000).toISOString();
  const recovered=await recoverExpiredSharedResourceLeases(db);
  assert.deepStrictEqual(recovered.map(x=>x.workId),['CODING-MANAGER:X']);
  assert.strictEqual(db.state.ai.current_job_id,null);
  assert.strictEqual(db.state.ai.work_state,'IDLE');
  assert.strictEqual((await activeSharedResourceLeases(db)).length,0);
});

test('missing-lease orphan CORE-PROBE is reclaimed without touching other owner slots',async()=>{
  const db=fakeLeaseDb({employeeId:'NV08',resourceId:'res:ollama:nv08'});
  const workId='CORE-PROBE:res:ollama:nv08:orphan';
  db.state.ai.current_job_id=workId;db.state.ai.work_state='BUSY';
  db.state.employee.current_job_id=workId;db.state.employee.work_state='BUSY';
  const expired=await recoverExpiredSharedResourceLeases(db);
  assert.deepStrictEqual(expired,[]);
  assert.strictEqual(db.state.ai.current_job_id,null);
  assert.strictEqual(db.state.employee.current_job_id,null);
  assert.strictEqual(db.state.ai.work_state,'IDLE');
  assert.deepStrictEqual(await recoverExpiredSharedResourceLeases(db),[],'replay must not reclaim twice');
});

test('live shared lease or non-probe owner cannot be reclaimed by orphan sweeper',async()=>{
  const db=fakeLeaseDb({employeeId:'NV08',resourceId:'res:ollama:nv08'});
  const claimed=await acquireSharedResourceLease(db,{employeeId:'NV08',workId:'CORE-PROBE:real',role:'probe',lane:'core_probe'});
  assert.ok(claimed);
  await recoverExpiredSharedResourceLeases(db);
  assert.strictEqual(db.state.ai.current_job_id,'CORE-PROBE:real');
  await releaseSharedResourceLease(db,{resourceId:claimed.resource_id,leaseToken:claimed.lease_token});
  db.state.ai.current_job_id='MGR-ACTUAL';db.state.ai.work_state='BUSY';
  db.state.employee.current_job_id='MGR-ACTUAL';db.state.employee.work_state='BUSY';
  await recoverExpiredSharedResourceLeases(db);
  assert.strictEqual(db.state.ai.current_job_id,'MGR-ACTUAL');
  assert.strictEqual(db.state.employee.current_job_id,'MGR-ACTUAL');
});

test('Coding Lane failover skips a resource whose shared lease cannot be acquired',async()=>{
  const resources=[
    {id:'NV09',provider:'fake',model:'slow'},
    {id:'NV20',provider:'fake',model:'fast'},
  ];
  const acquired=[],released=[],invoked=[];
  const result=await invokeJsonWithFailover(resources[0],'prompt',{
    resourcePool:resources,
    parseData:value=>value,
    validateData:()=>{},
    invokeFn:async resource=>{invoked.push(resource.id);return {ok:true,worker:resource.id}},
    leaseContext:{workId:'CODE-LEASE-TEST',role:'implementer'},
    acquireLeaseFn:async resource=>{
      acquired.push(resource.id);
      if(resource.id==='NV09')return null;
      return {resource_id:'res:nvidia:nv20',lease_token:'lease-20'};
    },
    heartbeatLeaseFn:async()=>true,
    releaseLeaseFn:async lease=>{released.push(lease.lease_token);return true},
  });
  assert.strictEqual(result.resource.id,'NV20');
  assert.deepStrictEqual(acquired,['NV09','NV20']);
  assert.deepStrictEqual(invoked,['NV20']);
  assert.deepStrictEqual(released,['lease-20']);
});

test('source integration covers manager implementer reviewer, Core status and restart protection',()=>{
  const coding=readFileSync(new URL('../apps/tigeriq-coding-lane/coding-lane.mjs',import.meta.url),'utf8');
  const core=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
  assert.ok(coding.includes("leaseContext:{workId:`CODING-MANAGER:${o.id}`,role:'manager'}"));
  assert.ok(coding.includes("{workId:j.id,role:'implementer'}"));
  assert.ok(coding.includes("leaseContext:{workId:`CODING-REVIEW:${j.id}`,role:'reviewer'}"));
  assert.ok(coding.includes('heartbeatCodingLaneInferenceLease'));
  assert.ok(core.includes('recoverExpiredSharedResourceLeases(pool)'));
  assert.ok(core.includes("lane:'core_probe'"));
  assert.ok(core.includes('resourceId:r.resourceId'));
  assert.ok(core.includes('shared_lease_lane'));
  assert.ok(core.includes('shared_lease_role'));
  assert.ok(core.includes('shared_lease_work_id'));
  assert.ok(core.includes('tigeriq_ai_resource_leases l where l.resource_id=r.resource_id'));
  const leaseSource=readFileSync(new URL('../apps/tigeriq-core/shared-resource-lease.mjs',import.meta.url),'utf8');
  assert.ok(leaseSource.includes("where resource_id=$1 for update"));
  assert.ok(leaseSource.includes("where resource_id=$1 and lease_until<=now() for update"));
  assert.ok(!leaseSource.includes('select resource_id,employee_id,lane,work_id,role,lease_token,lease_until,heartbeat_at,metadata'));
});

const NV07_SOURCE_SHA='a'.repeat(40);
const NV07_JOB_ID='NV07-4783-CANARY';
const NV07_NOW=Date.now();
function nv07LeaseFixture(overrides={}){
  const metadata={
    workOrderId:4783,resourceScope:NV07_CANARY_CORE_SCOPE,sourceSha:NV07_SOURCE_SHA,
    action:'READ_METADATA',idempotencyKey:'nv07-4783-one-shot-key',
    ...(overrides.metadata||{}),
  };
  const row={
    resource_id:'nv07:pc01',employee_id:'NV07',resource_employee_id:'NV07',
    work_id:NV07_JOB_ID,current_job_id:NV07_JOB_ID,enabled:true,
    lane:'nv07_bootstrap',role:'canary',
    lease_token:'NEVER_LEAK_THIS_CORE_TOKEN',
    lease_until:new Date(NV07_NOW+300000).toISOString(),metadata,
    ...Object.fromEntries(Object.entries(overrides).filter(([key])=>key!=='metadata')),
  };
  const calls=[];
  const db={query:async (sql,args)=>{calls.push({sql,args});return{rows:[row]}}};
  return{row,db,calls};
}

test('NV07 verified Core receipt maps DB lease without exposing lease bearer token',async()=>{
  const {db,calls}=nv07LeaseFixture();
  const got=await readVerifiedNv07CanaryCoreLease(db,{
    jobId:NV07_JOB_ID,sourceSha:NV07_SOURCE_SHA,resourceScope:NV07_CANARY_CORE_SCOPE,nowMs:NV07_NOW,
  });
  assert.deepStrictEqual(got,{
    verifiedByCore:true,job_id:NV07_JOB_ID,employee_id:'NV07',
    resource_scope:NV07_CANARY_CORE_SCOPE,state:'ACTIVE',
    idempotency_key:'nv07-4783-one-shot-key',expires_at:new Date(NV07_NOW+300000).toISOString(),
  });
  assert.strictEqual(Object.isFrozen(got),true);
  assert.ok(!JSON.stringify(got).includes('NEVER_LEAK_THIS_CORE_TOKEN'));
  assert.strictEqual(calls.length,1);
  assert.deepStrictEqual(calls[0].args,['NV07',NV07_JOB_ID]);
  assert.ok(calls[0].sql.includes('join tigeriq_ai_resources'));
  assert.ok(calls[0].sql.includes('l.lease_until>now()'));
  assert.ok(calls[0].sql.includes('r.current_job_id=l.work_id'));
});

test('NV07 Core lease reader fails closed for missing, wrong and expired DB authority',async()=>{
  const options={jobId:NV07_JOB_ID,sourceSha:NV07_SOURCE_SHA,resourceScope:NV07_CANARY_CORE_SCOPE,nowMs:NV07_NOW};
  for(const override of [
    {enabled:false},{employee_id:'NV09'},{resource_employee_id:'NV08'},
    {current_job_id:'OTHER-WORK'},{lane:'coding_lane'},{role:'implementer'},
    {lease_until:new Date(NV07_NOW-1).toISOString()},
    {metadata:{workOrderId:1111}},{metadata:{resourceScope:'ANOTHER_SCOPE'}},
    {metadata:{sourceSha:'b'.repeat(40)}},{metadata:{action:'WRITE_SOURCE'}},
    {metadata:{idempotencyKey:'short'}},
  ]){
    const{db}=nv07LeaseFixture(override);
    assert.strictEqual(await readVerifiedNv07CanaryCoreLease(db,options),null,JSON.stringify(override));
  }
  const{db}=nv07LeaseFixture();
  assert.strictEqual(await readVerifiedNv07CanaryCoreLease(db,{...options,resourceScope:'OTHER'}),null);
  assert.strictEqual(await readVerifiedNv07CanaryCoreLease(db,{...options,sourceSha:'latest'}),null);
  assert.strictEqual(await readVerifiedNv07CanaryCoreLease(null,options),null);
  assert.strictEqual(await readVerifiedNv07CanaryCoreLease({query:async()=>({rows:[]})},options),null);
  assert.strictEqual(await readVerifiedNv07CanaryCoreLease({query:async()=>({rows:[{},{}]})},options),null);
});

test('NV07 Core host callback binds pinned job and SHA, rejects caller substitutions',async()=>{
  const {db,calls}=nv07LeaseFixture();
  const cb=bindNv07CanaryCoreLeaseCallback(db,{jobId:NV07_JOB_ID,sourceSha:NV07_SOURCE_SHA});
  assert.strictEqual(await cb({jobId:'OTHER-JOB',resourceScope:NV07_CANARY_CORE_SCOPE}),null);
  assert.strictEqual(await cb({jobId:NV07_JOB_ID,resourceScope:'OTHER-SCOPE'}),null);
  assert.strictEqual(await cb({resourceScope:NV07_CANARY_CORE_SCOPE}),null);
  assert.strictEqual(calls.length,0,'invalid requests must not query the DB');
  const first=await cb({jobId:NV07_JOB_ID,resourceScope:NV07_CANARY_CORE_SCOPE,sourceSha:'b'.repeat(40)});
  assert.strictEqual(first?.verifiedByCore,true);
  assert.strictEqual(first?.job_id,NV07_JOB_ID);
  assert.strictEqual(calls.length,1);
  assert.ok(!JSON.stringify(first).includes('NEVER_LEAK_THIS_CORE_TOKEN'));
  const second=await cb({jobId:NV07_JOB_ID,resourceScope:NV07_CANARY_CORE_SCOPE});
  assert.strictEqual(second?.verifiedByCore,true);
  assert.strictEqual(calls.length,2,'fresh DB lease must be read on each callback invocation');
});

test('NV07 Core host callback fails closed when pinned source, DB or fresh lease is invalid',async()=>{
  const fixture=nv07LeaseFixture();
  const args={jobId:NV07_JOB_ID,resourceScope:NV07_CANARY_CORE_SCOPE};
  const untrusted=bindNv07CanaryCoreLeaseCallback(fixture.db,{jobId:NV07_JOB_ID,sourceSha:'latest'});
  assert.strictEqual(await untrusted(args),null);
  assert.strictEqual(fixture.calls.length,0);
  const missing=bindNv07CanaryCoreLeaseCallback(null,{jobId:NV07_JOB_ID,sourceSha:NV07_SOURCE_SHA});
  assert.strictEqual(await missing(args),null);
  const valid=bindNv07CanaryCoreLeaseCallback(fixture.db,{jobId:NV07_JOB_ID,sourceSha:NV07_SOURCE_SHA});
  fixture.row.lease_until=new Date(Date.now()-1000).toISOString();
  assert.strictEqual(await valid(args),null,'expired DB lease must invalidate callback receipt');
});
