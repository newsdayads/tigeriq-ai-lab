import {readFileSync} from 'node:fs';
import assert from 'node:assert';
import {test as vitestTest} from 'vitest';
import {
  acquireSharedResourceLease,
  activeSharedResourceLeases,
  recoverExpiredSharedResourceLeases,
  releaseSharedResourceLease,
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
    if(q.includes('select * from tigeriq_ai_resources')&&q.includes('where employee_id=$1')){
      return {rows:state.ai.enabled&&state.ai.employee_id===args[0]?[{...state.ai}]:[],rowCount:state.ai.employee_id===args[0]?1:0};
    }
    if(q==='select * from tigeriq_ai_resources where resource_id=$1'){
      return {rows:state.ai.resource_id===args[0]?[{...state.ai}]:[],rowCount:state.ai.resource_id===args[0]?1:0};
    }
    if(q.includes('select * from tigeriq_ai_resource_leases')&&q.includes('where resource_id=$1 and lease_token=$2')){
      const ok=state.lease&&state.lease.resource_id===args[0]&&state.lease.lease_token===args[1];
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
    if(q.includes('select * from tigeriq_ai_resource_leases')&&q.includes('where lease_until<=now()')){
      const expired=state.lease&&new Date(state.lease.lease_until).getTime()<=Date.now();
      return {rows:expired?[{...state.lease}]:[],rowCount:expired?1:0};
    }
    if(q.startsWith('select resource_id,employee_id,lane,work_id,role,lease_token,lease_until,heartbeat_at,metadata')){
      const active=state.lease&&new Date(state.lease.lease_until).getTime()>Date.now();
      return {rows:active?[{...state.lease}]:[],rowCount:active?1:0};
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
  assert.ok(core.includes('shared_lease_lane'));
  assert.ok(core.includes('shared_lease_role'));
  assert.ok(core.includes('shared_lease_work_id'));
  assert.ok(core.includes('tigeriq_ai_resource_leases l where l.resource_id=r.resource_id'));
});
