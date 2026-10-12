import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {projectCodingCoreHealth} from '../apps/shared/coding-core-health-contract.mjs';
import {CODING_FAST_HEALTH_SCHEMA,validateCodingFastHealthResponse} from '../apps/shared/coding-core-health-response.mjs';

const now=Date.parse('2026-10-13T07:00:00.000Z');
const resource=(id,extra={})=>({
  employee_id:id,resource_id:`res:provider:sample:${id}`,health_state:'ONLINE',
  work_state:'IDLE',status:'IDLE',enabled:true,current_job_id:null,
  quota_state:{usable:true},...extra,
});
const snapshot=(resources=[resource('NV19')],extra={})=>({
  ok:true,schema:CODING_FAST_HEALTH_SCHEMA,generatedAt:new Date(now).toISOString(),
  resources,events:[],routing:{performanceByTask:[]},...extra,
});

describe('#280 B03 fast Core health consumer fail-closed gates',()=>{
  it('accepts the producer projection for real Core status representations',()=>{
    const status={ok:true,resources:[
      resource('NV19'),
      resource('NV09',{health_state:'ONLINE',work_state:'ON_DEMAND',status:'ON_DEMAND'}),
      resource('NV12',{health_state:'READY',work_state:'ON_DEMAND',status:'READY'}),
      resource('NV20',{health_state:'ERROR',work_state:'ERROR',status:'ERROR'}),
    ],events:[],routing:{performanceByTask:[]}};
    const projected=projectCodingCoreHealth(status,{generatedAt:new Date(now).toISOString()});
    expect(validateCodingFastHealthResponse(projected,{nowMs:now})).toBe(projected);
  });

  it('accepts the actual PC01 Core READY/READY/READY status while keeping the exact eligibility gate',()=>{
    // Core /api/status on 2026-10-13 exposed NV08 as READY / READY / READY.
    // Core publicStatus() also intentionally maps that exact state to READY.
    const standby=resource('NV08',{health_state:'READY',work_state:'READY',status:'READY'});
    const projected=projectCodingCoreHealth({ok:true,resources:[standby]},
      {generatedAt:new Date(now).toISOString()});
    expect(validateCodingFastHealthResponse(projected,{nowMs:now}).resources[0]).toMatchObject({
      employee_id:'NV08',health_state:'READY',work_state:'READY',status:'READY',
    });
    for(const overrides of [
      {health_state:'UNKNOWN'}, {work_state:'UNKNOWN'}, {status:'UNKNOWN'},
      {enabled:false}, {quota_state:{usable:false}}, {current_job_id:'lease-1'},
    ]){
      expect(()=>validateCodingFastHealthResponse(snapshot([resource('NV08',{
        health_state:'READY',work_state:'READY',status:'READY',...overrides,
      })]),{nowMs:now})).toThrow('CODING_CORE_HEALTH_RESOURCE_INVALID');
    }
  });

  it('accepts a READY resource with a bound BUSY lease without treating it as idle',()=>{
    const busy=resource('NV08',{
      health_state:'READY',work_state:'BUSY',status:'BUSY',current_job_id:'existing-work',
    });
    const response=validateCodingFastHealthResponse(snapshot([busy]),{nowMs:now});
    expect(response.resources[0].current_job_id).toBe('existing-work');
    expect(response.resources[0].work_state).toBe('BUSY');
  });

  it('accepts BUSY resources only as BUSY, without synthesizing a free AI',()=>{
    const row=resource('NV09',{health_state:'ONLINE',work_state:'BUSY',status:'BUSY',current_job_id:'job-123'});
    expect(validateCodingFastHealthResponse(snapshot([row]),{nowMs:now}).resources[0].work_state).toBe('BUSY');
  });

  it('rejects stale, future-dated or invalid generatedAt snapshots',()=>{
    for(const generatedAt of [new Date(now-15001).toISOString(),new Date(now+5001).toISOString(),'bad-time',null]){
      expect(()=>validateCodingFastHealthResponse(snapshot(undefined,{generatedAt}),{nowMs:now}))
        .toThrow('CODING_CORE_HEALTH_RESPONSE_STALE');
    }
  });

  it('rejects overflow and duplicate identities before installing a snapshot',()=>{
    const rows=Array.from({length:65},(_,i)=>resource(`NV${i}`));
    expect(()=>validateCodingFastHealthResponse(snapshot(rows),{nowMs:now})).toThrow('CODING_CORE_HEALTH_RESPONSE_OVERFLOW');
    expect(()=>validateCodingFastHealthResponse(snapshot([resource('NV09'),resource('NV09')]),{nowMs:now}))
      .toThrow('CODING_CORE_HEALTH_RESOURCE_INVALID');
    expect(()=>validateCodingFastHealthResponse(snapshot([resource('NV09'),resource('NV10',{resource_id:'res:provider:sample:NV09'})]),{nowMs:now}))
      .toThrow('CODING_CORE_HEALTH_RESOURCE_INVALID');
  });

  it('rejects contradictory READY or IDLE availability without trusting status text',()=>{
    const invalid=[
      {health_state:'UNKNOWN',work_state:'UNKNOWN',status:'READY'},
      {health_state:'UNKNOWN',work_state:'IDLE',status:'IDLE'},
      {health_state:'ONLINE',work_state:'BUSY',status:'IDLE'},
      {health_state:'ONLINE',work_state:'IDLE',status:'READY'},
      {health_state:'ONLINE',work_state:'IDLE',status:'ON_DEMAND'},
      {quota_state:{usable:false}},
      {enabled:false},
      {current_job_id:'active-lease'},
    ];
    for(const override of invalid){
      expect(()=>validateCodingFastHealthResponse(snapshot([resource('NV20',override)]),{nowMs:now}))
        .toThrow('CODING_CORE_HEALTH_RESOURCE_INVALID');
    }
  });

  it('rejects missing schema, arrays, identifiers and quota gate',()=>{
    for(const bad of [snapshot(undefined,{schema:'wrong'}),snapshot(undefined,{events:null}),snapshot(undefined,{routing:null})]){
      expect(()=>validateCodingFastHealthResponse(bad,{nowMs:now}))
        .toThrow('CODING_CORE_HEALTH_RESPONSE_INVALID');
    }
    for(const override of [{employee_id:''},{resource_id:''},{quota_state:{}}]){
      expect(()=>validateCodingFastHealthResponse(snapshot([resource('NV20',override)]),{nowMs:now}))
        .toThrow('CODING_CORE_HEALTH_RESOURCE_INVALID');
    }
  });

  it('proves Coding Lane uses this response gate only on an explicit default-off opt-in',()=>{
    const src=readFileSync(new URL('../apps/tigeriq-coding-lane/coding-lane.mjs',import.meta.url),'utf8');
    expect(src).toContain("process.env.TIGERIQ_CODING_FAST_CORE_HEALTH==='true'");
    expect(src).toContain('validateCodingFastHealthResponse(snapshot)');
    expect(src).toContain('FAST_CORE_HEALTH_URL');
    expect(src).toContain('setCoreResourceHealthSnapshot(snapshot,Date.now())');
  });
});
