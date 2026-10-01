import { describe,it,expect } from 'vitest';
import {
  AUTONOMOUS_RCA_TAXONOMY,
  classifyAutonomousRca,
  dedupeAutonomousRca,
  buildImprovementWorkOrder,
  buildOwnerException,
  syntheticAutonomousRcaCanary,
} from '../apps/tigeriq-core/autonomous-rca.mjs';

describe('Core autonomous RCA + Improvement Work Order',()=>{
  it('implements the canonical 14-class taxonomy and classifies five distinct fault fixtures',()=>{
    expect(AUTONOMOUS_RCA_TAXONOMY).toHaveLength(14);
    const fixtures=[
      [{signature:'q',contractId:'AUTO_DISPATCH_CONTINUITY',evidence:{}},'QUEUE'],
      [{signature:'r',contractId:'REVIEW_INDEPENDENCE',evidence:{}},'REVIEW'],
      [{signature:'rt',contractId:'RUNTIME_SOURCE_SHA',evidence:{}},'RUNTIME'],
      [{signature:'rl',contractId:'SERVICE_FUNCTIONAL_INTEGRITY',evidence:{status:429,kind:'rate_limit'}},'RATE_LIMIT'],
      [{signature:'auth',contractId:'SERVICE_FUNCTIONAL_INTEGRITY',evidence:{status:401,kind:'auth'}},'AUTH'],
    ];
    for(const [input,expected] of fixtures)expect(classifyAutonomousRca(input).class).toBe(expected);
  });

  it('dedupes the same root/anomaly signature into one RCA candidate',()=>{
    const a={signature:'same',contractId:'AUTO_DISPATCH_CONTINUITY',evidence:{eligibleBacklogCount:2}};
    expect(dedupeAutonomousRca([a,a])).toHaveLength(1);
  });

  it('fails closed to Owner exception for auth/credential gates and never creates a safe mutation Work Order',()=>{
    const rca=classifyAutonomousRca({signature:'auth',contractId:'SERVICE_FUNCTIONAL_INTEGRITY',evidence:{kind:'auth',message:'credential required'}});
    expect(rca).toMatchObject({class:'AUTH',hardGate:true,selfFixable:false});
    expect(buildOwnerException(rca)).toMatchObject({type:'OWNER_EXCEPTION',reason:'AUTH_OR_CREDENTIAL'});
    expect(()=>buildImprovementWorkOrder(rca)).toThrow('RCA_WORK_ORDER_NOT_SAFE');
  });

  it('creates a bounded evidence-backed Work Order proposal for safe reversible RCA',()=>{
    const rca=classifyAutonomousRca({signature:'route',contractId:'DEGRADED_RESOURCE_ROUTING',evidence:{resourceScope:'CORE_ROUTING',resourceId:'res:test'}});
    const wo=buildImprovementWorkOrder(rca);
    expect(wo.body).toContain('RESOURCE_SCOPE=AUTO_RCA_ROUTING_');
    expect(wo.body).toContain('SELF_UPGRADE_CANDIDATE=true');
    expect(wo.body).toContain('AUTO_QUEUE=EXCLUDED_UNTIL_SELF_UPGRADE_GATE');
    expect(wo.body).toContain('NO_DIRECT_MAIN=true');
    expect(wo.body).toContain('APP_CHROME_MUTATION=FORBIDDEN');
    expect(wo.body).toContain('EVIDENCE_HASH=');
    expect(wo.body).toContain('REQUIRED_TESTS=');
    expect(wo.body).toContain('PROVENANCE=SELF_AUDIT|DEGRADED_RESOURCE_ROUTING|route');
  });

  it('bounded synthetic canary produces one safe WO action + one Owner exception without mutation',()=>{
    const canary=syntheticAutonomousRcaCanary();
    expect(canary).toMatchObject({ok:true,pass:true,fixtureCount:5,dedupedCount:5,mutation:false});
    expect(canary.safeAction.type).toBe('IMPROVEMENT_WORK_ORDER');
    expect(canary.hardGateAction.type).toBe('OWNER_EXCEPTION');
  });
});
