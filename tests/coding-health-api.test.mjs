import {describe,it,expect} from 'vitest';
import {createCodingCoreHealthSnapshot} from '../apps/tigeriq-core/coding-health-api.mjs';
import {coreResourceStateEligible} from '../apps/tigeriq-coding-lane/coding-lane.mjs';

const resource=(employee,overrides={})=>({
 employee_id:employee,resource_id:'resource:'+employee,provider:'nvidia',model:'free',
 cost_tier:'FREE',health_state:'ONLINE',work_state:'IDLE',enabled:true,
 capabilities:['coding'],quota_state:{usable:true},...overrides
});
const makeDeps=({resources=[resource('NV20'),resource('NV09')],lease=[],events=[],performance=[]}={})=>{
 const calls=[];
 return {
   calls,
   deps:{
     pool:{query:async sql=>{
       calls.push(sql);
       if(sql.includes('select * from tigeriq_ai_resources'))return {rows:resources};
       if(sql.includes('select ts,type,resource_id,employee_id'))return {rows:events};
       if(sql.includes('coalesce(task_kind'))return {rows:performance};
       throw Error('UNEXPECTED_SQL_QUERY');
     }},
     nowIso:()=> '2026-10-13T01:00:00.000Z',
     refreshWorkforce:async()=>({workforce:[]}),
     activeLeases:async()=>lease,
     indexLeases:v=>new Map(v.map(l=>[l.resource_id,l])),
     normalizeResources:(rows)=>rows,
     normalizeQuota:q=>q,
     publicStatus:r=>r.work_state==='BUSY'?'BUSY':r.health_state==='ERROR'?'ERROR':'IDLE',
   }
 };
};
describe('#280 fast Coding health API source, fail closed and no secrets',()=>{
 it('keeps only three read-only DB queries and emits a small authoritative snapshot',async()=>{
   const {deps,calls}=makeDeps({
      events:[{type:'RESOURCE_SUCCESS',resource_id:'resource:NV20',employee_id:'NV20',ts:'2026-10-13T00:00:00Z',data:{secret:'no'}}],
      performance:[{resource_id:'resource:NV20',task_kind:'coding_manager',success:3,failure:1,retries:0,failovers:0,avg_latency_ms:950}],
   });
   const r=await createCodingCoreHealthSnapshot(deps);
   expect(r).toMatchObject({ok:true,schema:'TIGERIQ_CODING_CORE_HEALTH_V1',generatedAt:'2026-10-13T01:00:00.000Z'});
   expect(r.resources.map(z=>z.employee_id)).toEqual(['NV20','NV09']);
   expect(r.resources.map(z=>coreResourceStateEligible(z))).toEqual([true,true]);
   expect(r.routing.performanceByTask[0]).toMatchObject({task_kind:'coding_manager',success:3});
   expect(r.events[0]).not.toHaveProperty('data');
   expect(calls).toHaveLength(3);
   expect(calls.every(s=>/^select/i.test(s.trim()))).toBe(true);
   expect(JSON.stringify(r)).not.toContain('secret');
 });
 it('honors shared leases as BUSY even when Core row says ONLINE/IDLE',async()=>{
   const {deps}=makeDeps({lease:[{resource_id:'resource:NV20',work_id:'CORE-JOB-123',role:'implementer',lane:'coding',lease_until:'2026-10-13T01:02:00Z'}]});
   const r=await createCodingCoreHealthSnapshot(deps);
   expect(r.resources[0].current_job_id).toBe('CORE-JOB-123');
   expect(r.resources[0].work_state).toBe('BUSY');
   expect(r.resources[0].status).toBe('BUSY');
   expect(coreResourceStateEligible(r.resources[0])).toBe(false);
   expect(coreResourceStateEligible(r.resources[1])).toBe(true);
 });
 it('does not authorize ERROR or quota-limited employees',async()=>{
   const {deps}=makeDeps({resources:[
     resource('NV20',{health_state:'ERROR'}),
     resource('NV19',{quota_state:{usable:false}}),
   ]});
   const r=await createCodingCoreHealthSnapshot(deps);
   expect(r.resources.map(z=>coreResourceStateEligible(z))).toEqual([false,false]);
 });
 it('rejects duplicate employee resource rows rather than letting later overwrite the busy state',async()=>{
   const {deps}=makeDeps({resources:[resource('NV20'),resource('NV20',{resource_id:'alternative'})]});
   await expect(createCodingCoreHealthSnapshot(deps)).rejects.toThrow('CODING_CORE_HEALTH_RESOURCE_ID_INVALID');
 });
 it('fails closed if the DB or authoritative lease service fails',async()=>{
   const {deps}=makeDeps();
   deps.activeLeases=async()=>{throw Error('PG_UNAVAILABLE')};
   await expect(createCodingCoreHealthSnapshot(deps)).rejects.toThrow('PG_UNAVAILABLE');
   const second=makeDeps();
   second.deps.pool.query=async()=>{throw Error('DATABASE_READ_FAILED')};
   await expect(createCodingCoreHealthSnapshot(second.deps)).rejects.toThrow('DATABASE_READ_FAILED');
 });
});
