import {describe,expect,it} from 'vitest';
import {CODING_CORE_HEALTH_BOUNDS,projectCodingCoreHealth} from '../apps/shared/coding-core-health-contract.mjs';
import {coreResourceStateEligible,setCoreResourceHealthSnapshot} from '../apps/tigeriq-coding-lane/coding-lane.mjs';

const resource=(id,overrides={})=>({
  employee_id:id,
  resource_id:`res:provider:model:${id}`,
  provider:'nvidia',
  model:'model',
  cost_tier:'FREE',
  health_state:'ONLINE',
  work_state:'IDLE',
  status:'IDLE',
  enabled:true,
  capabilities:['coding','general'],
  current_job_id:null,
  quota_state:{usable:true},
  ...overrides,
});

describe('#280 bounded Core -> Coding health contract (source-only stage)',()=>{
  it('preserves the exact health, quota and lease gates consumed by Coding Lane',()=>{
    const projected=projectCodingCoreHealth({
      ok:true,resources:[
        resource('NV20'),
        resource('NV19',{health_state:'RATE_LIMITED',status:'RATE_LIMITED'}),
        resource('NV09',{work_state:'BUSY',current_job_id:'other-lease'}),
        resource('NV17',{quota_state:{usable:false}}),
      ],events:[],routing:{performanceByTask:[]},
    });
    expect(projected.schema).toBe('TIGERIQ_CODING_CORE_HEALTH_V1');
    expect(projected.resources.map(r=>coreResourceStateEligible(r))).toEqual([true,false,false,false]);
    expect(setCoreResourceHealthSnapshot(projected)).toBe(4);
  });

  it('preserves functional evidence and per-task routing performance, without accepting irrelevant event types',()=>{
    const now='2026-10-12T14:38:00.000Z';
    const r=resource('NV20');
    const projected=projectCodingCoreHealth({ok:true,core:{time:now},resources:[r],events:[
      {type:'RESOURCE_SUCCESS',ts:now,resource_id:r.resource_id,employee_id:'NV20',data:{token:'do-not-leak'}},
      {type:'JOB_DONE',ts:now,resource_id:r.resource_id,employee_id:'NV20'},
      {type:'RESOURCE_FAILURE',ts:now,resource_id:r.resource_id,employee_id:'NV20'},
    ],routing:{performanceByTask:[{resource_id:r.resource_id,task_kind:'coding_manager',success:12,failure:3,retries:2,failovers:1,avg_latency_ms:935,data:{secret:'no'}}]}});
    expect(projected.generatedAt).toBe(now);
    expect(projected.events.map(e=>e.type)).toEqual(['RESOURCE_SUCCESS','RESOURCE_FAILURE']);
    expect(projected.routing.performanceByTask[0]).toMatchObject({task_kind:'coding_manager',success:12,failure:3,avg_latency_ms:935});
    expect(JSON.stringify(projected)).not.toMatch(/do-not-leak|secret|token/);
  });

  it('removes heavyweight job/telemetry/integration records and bounds every collection',()=>{
    const r=resource('NV20',{last_error:'very private key',myApiSecret:'do-not-leak'});
    const expanded={
      ok:true,core:{time:'2026-10-12T14:38:00Z'},
      resources:Array.from({length:64},(_,i)=>resource(`NV${i}`)),
      events:Array.from({length:550},()=>({type:'RESOURCE_SUCCESS',resource_id:r.resource_id,ts:'2026-10-12T14:38:00Z',data:{secret:'hidden'}})),
      routing:{performanceByTask:Array.from({length:330},()=>({resource_id:r.resource_id,task_kind:'coding',success:7}))},
      jobs:Array.from({length:40},()=>({prompt:'X'.repeat(18000)})),
      telemetry:Array.from({length:500},()=>({payload:'Y'.repeat(1000)})),
      integrations:{credentials:'secret-token'},
    };
    const originalBytes=JSON.stringify(expanded).length;
    expect(originalBytes).toBeGreaterThan(854000);
    const projected=projectCodingCoreHealth(expanded);
    const raw=JSON.stringify(projected);
    expect(projected.resources).toHaveLength(CODING_CORE_HEALTH_BOUNDS.resources);
    expect(projected.events).toHaveLength(CODING_CORE_HEALTH_BOUNDS.events);
    expect(projected.routing.performanceByTask).toHaveLength(CODING_CORE_HEALTH_BOUNDS.performance);
    expect(raw.length).toBeLessThan(100000);
    expect(raw).not.toMatch(/do-not-leak|very private|X{100}|Y{100}|secret-token/);
    expect(projected).not.toHaveProperty('jobs');
    expect(projected).not.toHaveProperty('telemetry');
    expect(projected).not.toHaveProperty('integrations');
  });

  it('rejects overflow instead of quietly dropping row 65, including a late conflicting lease identity',()=>{
    const rows=Array.from({length:64},(_,i)=>resource(`NV${i}`));
    const base={ok:true,resources:rows};
    expect(projectCodingCoreHealth(base).resources).toHaveLength(CODING_CORE_HEALTH_BOUNDS.resources);
    expect(()=>projectCodingCoreHealth({ok:true,resources:[...rows,resource('NV64')]}))
      .toThrow('CODING_CORE_HEALTH_RESOURCE_OVERFLOW');
    expect(()=>projectCodingCoreHealth({ok:true,resources:[...rows,resource('NV0',{current_job_id:'another-lease'})]}))
      .toThrow('CODING_CORE_HEALTH_RESOURCE_OVERFLOW');
  });

  it('rejects duplicate employee/resource identity and malformed rows rather than silently filtering',()=>{
    const first=resource('NV20');
    const invalid=[
      [first,resource('NV20',{resource_id:'res:other:duplicate'})],
      [first,resource('NV19',{resource_id:first.resource_id})],
      [first,resource('NV19',{employee_id:''})],
      [first,resource('NV19',{resource_id:''})],
    ];
    for(const resources of invalid){
      expect(()=>projectCodingCoreHealth({ok:true,resources}))
        .toThrow('CODING_CORE_HEALTH_RESOURCE_ID_INVALID');
    }
  });

  it('fails closed when authoritative Core response is unavailable or malformed',()=>{
    for(const bad of [null,{}, {ok:false,resources:[resource('NV20')]},{ok:true,resources:null}]){
      expect(()=>projectCodingCoreHealth(bad)).toThrow('CODING_CORE_HEALTH_SOURCE_INVALID');
    }
  });

  it('allows ON_DEMAND READY workers without inventing ONLINE from null or unknown states',()=>{
    const v=projectCodingCoreHealth({ok:true,resources:[
      resource('NV09',{health_state:'READY',work_state:'ON_DEMAND',status:'READY'}),
      resource('NV15',{health_state:'UNKNOWN',work_state:'IDLE',status:'UNKNOWN'}),
    ]});
    expect(v.resources.map(x=>coreResourceStateEligible(x))).toEqual([true,false]);
  });
});
