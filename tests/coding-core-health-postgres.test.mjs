import {describe,it,expect} from 'vitest';
import {CODING_HEALTH_RESOURCE_SQL,CODING_HEALTH_EVENTS_SQL,CODING_HEALTH_PERFORMANCE_SQL,
  statusFromCoreResource,readCodingHealthFromPostgres} from '../apps/shared/coding-core-health-postgres.mjs';
import {coreResourceStateEligible} from '../apps/tigeriq-coding-lane/coding-lane.mjs';

const now=new Date('2026-10-13T01:00:00.000Z');
const row=(id,extra={})=>({employee_id:id,resource_id:`res:test:runtime:${id}`,provider:'ollama',
  model:'fake',cost_tier:'FREE',capabilities:['coding'],enabled:true,
  credential_state:'LOCAL',health_state:'ONLINE',work_state:'IDLE',
  current_job_id:null,cooldown_until:null,quota_state:{usable:true},
  active_shared_lease_work_id:null,...extra});
const fakeDb=(resourceRows=[],eventRows=[],performanceRows=[])=>{
  const queries=[];
  const db={query:async(sql)=>{
    queries.push(sql);
    if(sql===CODING_HEALTH_RESOURCE_SQL)return {rows:resourceRows};
    if(sql===CODING_HEALTH_EVENTS_SQL)return {rows:eventRows};
    if(sql===CODING_HEALTH_PERFORMANCE_SQL)return {rows:performanceRows};
    throw Error('UNEXPECTED_DB_QUERY');
  }};
  return {db,queries};
};

describe('#280 B03 live-schema PostgreSQL fast health source, source-only',()=>{
  it('uses one bounded atomic resources plus active leases SELECT, without a separate lease read',()=>{
    expect(CODING_HEALTH_RESOURCE_SQL).toMatch(/left join tigeriq_ai_resource_leases l/i);
    expect(CODING_HEALTH_RESOURCE_SQL).toMatch(/l.resource_id=r.resource_id and l.lease_until>now\(\)/i);
    expect(CODING_HEALTH_RESOURCE_SQL).toMatch(/limit 65/i);
    expect(CODING_HEALTH_RESOURCE_SQL).toMatch(/where r.enabled=true/i);
    for(const sql of [CODING_HEALTH_RESOURCE_SQL,CODING_HEALTH_EVENTS_SQL,CODING_HEALTH_PERFORMANCE_SQL]){
      expect(sql).toMatch(/^select\b/i);
      expect(sql).not.toMatch(/\b(insert|update|delete|drop|alter|truncate)\b/i);
    }
  });

  it('preserves READY/READY, ON_DEMAND, BUSY lease and explicit ERROR, rejects unavailable AI',async()=>{
    const rows=[
      row('NV08',{health_state:'READY',work_state:'READY'}),
      row('NV09',{health_state:'READY',work_state:'ON_DEMAND'}),
      row('NV19',{active_shared_lease_work_id:'CODING-MANAGER:existing-work'}),
      row('NV20',{health_state:'ERROR',work_state:'ERROR'}),
    ];
    const {db,queries}=fakeDb(rows);
    const projection=await readCodingHealthFromPostgres(db,{now:()=>now});
    expect(queries).toEqual([CODING_HEALTH_RESOURCE_SQL,CODING_HEALTH_EVENTS_SQL,CODING_HEALTH_PERFORMANCE_SQL]);
    expect(projection.resources.map(x=>[x.employee_id,x.health_state,x.work_state,x.status])).toEqual([
      ['NV08','READY','READY','READY'],
      ['NV09','READY','ON_DEMAND','ON_DEMAND'],
      ['NV19','ONLINE','BUSY','BUSY'],
      ['NV20','ERROR','ERROR','ERROR'],
    ]);
    expect(projection.resources.map(x=>coreResourceStateEligible(x,now.getTime()))).toEqual([true,true,false,false]);
    expect(projection.resources[2].current_job_id).toBe('CODING-MANAGER:existing-work');
    expect(projection.generatedAt).toBe(now.toISOString());
  });

  it('never drops the 65th row, never mistakes it for complete health',async()=>{
    const rows=Array.from({length:65},(_,i)=>row(`NV${i}`));
    const {db,queries}=fakeDb(rows);
    await expect(readCodingHealthFromPostgres(db,{now:()=>now})).rejects.toThrow('CODING_CORE_HEALTH_RESOURCE_OVERFLOW');
    expect(queries).toEqual([CODING_HEALTH_RESOURCE_SQL]);
  });

  it('rejects duplicate employee or shared resource without touching lease state',async()=>{
    for(const resources of [
      [row('NV09'),row('NV09',{resource_id:'res:different:NV09'})],
      [row('NV09'),row('NV19',{resource_id:'res:test:runtime:NV09'})],
    ]){
      const {db}=fakeDb(resources);
      await expect(readCodingHealthFromPostgres(db,{now:()=>now}))
        .rejects.toThrow('CODING_CORE_HEALTH_RESOURCE_ID_INVALID');
    }
  });

  it('an expired shared lease is not projected as BUSY (SQL constrains lease_until)',async()=>{
    const {db}=fakeDb([row('NV20')]);
    const p=await readCodingHealthFromPostgres(db,{now:()=>now});
    expect(p.resources[0].current_job_id).toBeNull();
    expect(p.resources[0].status).toBe('IDLE');
  });

  it('keeps just safe functional event and 7-day routing fields, without leaking secrets',async()=>{
    const {db}=fakeDb([row('NV20',{credential_state:'LOCAL',secret:'private-token'})],
      [{ts:now.toISOString(),type:'RESOURCE_SUCCESS',resource_id:'res:test:runtime:NV20',employee_id:'NV20',secret:'hidden'}],
      [{resource_id:'res:test:runtime:NV20',task_kind:'coding_manager',success:4,failure:1,avg_latency_ms:500,secret:'hidden'}]);
    const p=await readCodingHealthFromPostgres(db,{now:()=>now});
    expect(p.events).toHaveLength(1);
    expect(p.routing.performanceByTask[0]).toMatchObject({task_kind:'coding_manager',success:4,failure:1});
    expect(JSON.stringify(p)).not.toMatch(/private-token|hidden/);
    expect(p).not.toHaveProperty('jobs');
    expect(p).not.toHaveProperty('integrations');
  });

  it('fails closed when the database response is malformed or performance rows overflow',async()=>{
    await expect(readCodingHealthFromPostgres(null,{now:()=>now}))
      .rejects.toThrow('CODING_CORE_HEALTH_DB_UNAVAILABLE');
    await expect(readCodingHealthFromPostgres({query:async()=>({rows:null})},{now:()=>now}))
      .rejects.toThrow('CODING_CORE_HEALTH_SQL_RESPONSE_INVALID');
    const {db}=fakeDb([row('NV20')],[],Array.from({length:161},(_,i)=>({
      resource_id:`res:worker:${i}`,task_kind:'coding',success:1,
    })));
    await expect(readCodingHealthFromPostgres(db,{now:()=>now}))
      .rejects.toThrow('CODING_CORE_HEALTH_EVIDENCE_OVERFLOW');
  });

  it('public status logic follows Core state ordering for leases, credentials and cooldown errors',()=>{
    expect(statusFromCoreResource(row('NV09',{current_job_id:'job'}))).toBe('BUSY');
    expect(statusFromCoreResource(row('NV09',{credential_state:'WAIT_KEY'}))).toBe('WAIT_KEY');
    expect(statusFromCoreResource(row('NV09',{health_state:'RATE_LIMITED'}))).toBe('RATE_LIMITED');
    expect(statusFromCoreResource(row('NV09',{health_state:'OFFLINE'}))).toBe('OFFLINE');
    expect(statusFromCoreResource(row('NV09',{health_state:'READY',work_state:'READY'}))).toBe('READY');
    expect(statusFromCoreResource(row('NV09',{health_state:'READY',work_state:'ON_DEMAND'}))).toBe('ON_DEMAND');
  });
});
