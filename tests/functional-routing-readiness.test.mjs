import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {
  FUNCTIONAL_FAILURE_STREAK_LIMIT,
  FUNCTIONAL_REPROBE_MAX,
  FUNCTIONAL_SUCCESS_TTL_MS,
  functionalReprobeCandidates,
  functionalRoutingReadiness,
  rankCandidates,
} from '../apps/tigeriq-core/smart-router.mjs';

const now=Date.parse('2026-10-02T04:00:00Z');
const recent=new Date(now-60_000).toISOString();
const stale=new Date(now-FUNCTIONAL_SUCCESS_TTL_MS-1).toISOString();
const base=(overrides={})=>({
  resource_id:'res:groq:test:default:core',
  employee_id:'NV11',
  provider:'groq',
  model:'test',
  enabled:true,
  credential_state:'READY',
  health_state:'ONLINE',
  cooldown_until:null,
  cost_tier:'FREE',
  capabilities:['general','reasoning','review'],
  rank:10,
  quota_state:{known:false,usable:true},
  functionalEvidence:{lastSuccessAt:recent,lastFailureAt:null,failureStreak:0},
  ...overrides,
});

describe('#2806 functional routing readiness',()=>{
  it('does not treat ONLINE as sufficient when functional success is missing or stale',()=>{
    expect(functionalRoutingReadiness(base({functionalEvidence:{lastSuccessAt:null,lastFailureAt:null,failureStreak:0}}),{nowMs:now,requireEvidence:true})).toMatchObject({ready:false,reason:'functional_success_missing'});
    expect(functionalRoutingReadiness(base({functionalEvidence:{lastSuccessAt:stale,lastFailureAt:null,failureStreak:0}}),{nowMs:now,requireEvidence:true})).toMatchObject({ready:false,reason:'functional_success_stale'});
    const decision=rankCandidates([
      base({resource_id:'res:stale',functionalEvidence:{lastSuccessAt:stale,lastFailureAt:null,failureStreak:0}}),
      base({resource_id:'res:recent',rank:20}),
    ],{nowMs:now});
    expect(decision.chosen?.resourceId).toBe('res:recent');
    expect(decision.candidates.find(x=>x.resourceId==='res:stale')?.reasons).toContain('functional_success_stale');
  });

  it('degrades a bounded failure streak and restores eligibility after a newer success',()=>{
    const failing=base({functionalEvidence:{lastSuccessAt:recent,lastFailureAt:new Date(now-10_000).toISOString(),failureStreak:FUNCTIONAL_FAILURE_STREAK_LIMIT}});
    expect(functionalRoutingReadiness(failing,{nowMs:now,requireEvidence:true})).toMatchObject({ready:false,state:'DEGRADED',reason:'functional_failure_streak'});
    expect(rankCandidates([failing],{nowMs:now}).chosen).toBeNull();

    const recovered=base({functionalEvidence:{lastSuccessAt:new Date(now-1_000).toISOString(),lastFailureAt:new Date(now-10_000).toISOString(),failureStreak:0}});
    expect(functionalRoutingReadiness(recovered,{nowMs:now,requireEvidence:true})).toMatchObject({ready:true,reason:'functional_success_recent'});
    expect(rankCandidates([recovered],{nowMs:now}).chosen?.employeeId).toBe('NV11');
  });

  it('fails closed when a newer functional failure follows the last success',()=>{
    const resource=base({functionalEvidence:{lastSuccessAt:new Date(now-20_000).toISOString(),lastFailureAt:new Date(now-5_000).toISOString(),failureStreak:1}});
    expect(functionalRoutingReadiness(resource,{nowMs:now,requireEvidence:true})).toMatchObject({ready:false,reason:'functional_failure_newer'});
    expect(rankCandidates([resource],{nowMs:now}).chosen).toBeNull();
  });

  it('bounds immediate reprobe candidates and can recover a stale-only pool before terminal no-resource',()=>{
    const missing=base({resource_id:'res:missing',rank:5,functionalEvidence:{lastSuccessAt:null,lastFailureAt:null,failureStreak:0}});
    const staleOne=base({resource_id:'res:stale-one',rank:10,functionalEvidence:{lastSuccessAt:stale,lastFailureAt:null,failureStreak:0}});
    const staleTwo=base({resource_id:'res:stale-two',rank:20,functionalEvidence:{lastSuccessAt:stale,lastFailureAt:null,failureStreak:0}});
    const degraded=base({resource_id:'res:degraded',rank:1,functionalEvidence:{lastSuccessAt:recent,lastFailureAt:new Date(now-5_000).toISOString(),failureStreak:FUNCTIONAL_FAILURE_STREAK_LIMIT}});
    const plan=functionalReprobeCandidates([degraded,staleTwo,missing,staleOne],{nowMs:now,maxProbes:2});
    expect(plan).toEqual([
      expect.objectContaining({resourceId:'res:missing',reason:'functional_success_missing'}),
      expect.objectContaining({resourceId:'res:stale-one',reason:'functional_success_stale'}),
    ]);
    expect(plan).toHaveLength(2);
    expect(FUNCTIONAL_REPROBE_MAX).toBeGreaterThanOrEqual(2);

    const before=rankCandidates([staleOne],{nowMs:now,requireFunctionalEvidence:true});
    expect(before.chosen).toBeNull();
    const after=rankCandidates([
      {...staleOne,functionalEvidence:{lastSuccessAt:new Date(now-500).toISOString(),lastFailureAt:null,failureStreak:0}},
    ],{nowMs:now,requireFunctionalEvidence:true});
    expect(after.chosen?.resourceId).toBe('res:stale-one');
  });

  it('fails closed instead of taking the LEGACY path when a caller requires functional evidence',()=>{
    const noEvidence={...base({resource_id:'res:no-evidence'})};
    delete noEvidence.functionalEvidence;
    const strict=rankCandidates([noEvidence],{nowMs:now,requireFunctionalEvidence:true});
    expect(strict.chosen).toBeNull();
    expect(strict.candidates[0]?.reasons).toContain('functional_success_missing');
    expect(functionalRoutingReadiness(noEvidence,{nowMs:now})).toMatchObject({ready:true,state:'LEGACY'});
  });

  it('always skips non-routable health or credential states without blocking a healthy peer',()=>{
    const broken=[
      base({resource_id:'res:rate',employee_id:'NV12',health_state:'RATE_LIMITED'}),
      base({resource_id:'res:offline',employee_id:'NV13',health_state:'OFFLINE'}),
      base({resource_id:'res:auth',employee_id:'NV18',credential_state:'BLOCKED'}),
    ];
    const healthy=base({resource_id:'res:healthy',employee_id:'NV19',rank:50});
    const decision=rankCandidates([...broken,healthy],{nowMs:now});
    expect(decision.chosen?.resourceId).toBe('res:healthy');
    expect(decision.candidates.filter(x=>x.resourceId!=='res:healthy').every(x=>x.eligible===false)).toBe(true);
  });

  it('wires bounded stale reprobe and a fresh lock-time readiness check into Core',()=>{
    const core=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
    expect(core).toContain('async function routingFunctionalEvidence');
    expect(core).toContain("limit 20");
    expect(core).toContain('apiDoctorHealthEvidenceEvents(events)');
    expect(core).toContain('functionalProbeDue');
    expect(core).toContain('FUNCTIONAL_SUCCESS_TTL_MS');
    expect(core).toContain("event('ROUTING_FUNCTIONAL_REPROBE'");
    expect(core).toContain('functionalReprobeCandidates(rows');
    expect(core).toContain('selfAuditFunctionalEvidence=await routingFunctionalEvidence');
    expect(core).toContain('requireFunctionalEvidence:true');
    expect(core).toContain('routingFunctionalEvidence(client,[r.resource_id])');
    expect(core).toContain('functionalRoutingReadiness(freshResource,{requireEvidence:true})');
  });
});
