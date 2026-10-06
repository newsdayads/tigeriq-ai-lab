import { readFileSync } from 'node:fs';
import { describe,it,expect } from 'vitest';
// @ts-expect-error runtime module intentionally has no TS declaration file.
import {AUTONOMOUS_RCA_TAXONOMY,autonomousRcaCanonicalAction,autonomousRcaMaterializationDedupe,classifyAutonomousRca,dedupeAutonomousRca,buildImprovementWorkOrder,buildOwnerException,syntheticAutonomousRcaCanary} from '../apps/tigeriq-core/autonomous-rca.mjs';

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

  it('dedupes the same root/anomaly signature even as observation evidence changes',()=>{
    const a={signature:'same',contractId:'AUTO_DISPATCH_CONTINUITY',evidence:{eligibleBacklogCount:2,observationCount:2}};
    const b={signature:'same',contractId:'AUTO_DISPATCH_CONTINUITY',evidence:{eligibleBacklogCount:3,observationCount:3}};
    expect(classifyAutonomousRca(a).rcaSignature).toBe(classifyAutonomousRca(b).rcaSignature);
    expect(dedupeAutonomousRca([a,b])).toHaveLength(1);
  });

  it('dedupes changing anomaly signatures inside one logical RCA family but preserves concrete scope separation',()=>{
    const a=classifyAutonomousRca({signature:'obs-a',contractId:'SERVICE_FUNCTIONAL_INTEGRITY',evidence:{}});
    const b=classifyAutonomousRca({signature:'obs-b',contractId:'SERVICE_FUNCTIONAL_INTEGRITY',evidence:{}});
    expect(a.rcaSignature).not.toBe(b.rcaSignature);
    expect(a.rcaFamilyKey).toBe(b.rcaFamilyKey);
    expect(dedupeAutonomousRca([a,b])).toHaveLength(1);

    const apiA=classifyAutonomousRca({signature:'api-a',contractId:'SERVICE_FUNCTIONAL_INTEGRITY',evidence:{resourceScope:'API_PROVIDER_NV11'}});
    const apiB=classifyAutonomousRca({signature:'api-b',contractId:'SERVICE_FUNCTIONAL_INTEGRITY',evidence:{resourceScope:'API_PROVIDER_NV17'}});
    expect(apiA.rcaFamilyKey).not.toBe(apiB.rcaFamilyKey);
    expect(dedupeAutonomousRca([apiA,apiB])).toHaveLength(2);
  });

  it('keeps one canonical RCA Work Order across open/closed/reopened lifecycle history',()=>{
    const priorType='AUTONOMOUS_RCA_WORK_ORDER';
    expect(autonomousRcaCanonicalAction({mode:'WORK_ORDER',priorType,priorIssueState:'open'})).toBe('DEDUPE_ACTIVE');
    expect(autonomousRcaCanonicalAction({mode:'WORK_ORDER',priorType,priorIssueState:'reopened'})).toBe('DEDUPE_ACTIVE');
    expect(autonomousRcaCanonicalAction({mode:'WORK_ORDER',priorType,priorIssueState:'closed',priorStateReason:'completed'})).toBe('REARM_CANONICAL');
    expect(autonomousRcaCanonicalAction({mode:'WORK_ORDER',priorType,priorIssueState:'closed',priorStateReason:'not_planned'})).toBe('SUPPRESS_CLOSED');
    expect(autonomousRcaCanonicalAction({mode:'WORK_ORDER',priorType,priorIssueState:'closed',priorStateReason:'duplicate'})).toBe('SUPPRESS_CLOSED');
    expect(autonomousRcaCanonicalAction({mode:'WORK_ORDER',priorType,priorIssueState:'unknown'})).toBe('DEDUPE_UNKNOWN');
    for(const fixture of [
      {priorIssueState:'open'},
      {priorIssueState:'reopened'},
      {priorIssueState:'closed',priorStateReason:'completed'},
      {priorIssueState:'closed',priorStateReason:'not_planned'},
      {priorIssueState:'closed',priorStateReason:'duplicate'},
      {priorIssueState:'unknown'},
    ]){
      expect(autonomousRcaMaterializationDedupe({mode:'WORK_ORDER',priorType,...fixture})).toBe(true);
    }
    expect(autonomousRcaMaterializationDedupe({mode:'WORK_ORDER',priorType:'AUTONOMOUS_RCA_OWNER_EXCEPTION',priorIssueState:'open'})).toBe(false);
  });

  it('fails closed to Owner exception for auth/credential gates and never creates a safe mutation Work Order',()=>{
    const rca=classifyAutonomousRca({signature:'auth',contractId:'SERVICE_FUNCTIONAL_INTEGRITY',evidence:{kind:'auth',message:'credential required'}});
    expect(rca).toMatchObject({class:'AUTH',hardGate:true,selfFixable:false});
    expect(buildOwnerException(rca)).toMatchObject({type:'OWNER_EXCEPTION',reason:'AUTH_OR_CREDENTIAL'});
    expect(()=>buildImprovementWorkOrder(rca)).toThrow('RCA_WORK_ORDER_NOT_SAFE');
  });

  it('creates a bounded evidence-backed Work Order proposal for safe reversible RCA',()=>{
    const rca=classifyAutonomousRca({signature:'route',contractId:'DEGRADED_RESOURCE_ROUTING',evidence:{resourceScope:'CORE_ROUTING',resourceId:'res:test',severity:'HIGH'}});
    const wo=buildImprovementWorkOrder(rca);
    expect(wo.priority).toBe('P1');
    expect(wo.body).toContain('RESOURCE_SCOPE=AUTO_RCA_ROUTING_');
    expect(wo.body).toContain('SELF_UPGRADE_CANDIDATE=true');
    expect(wo.body).toContain('AUTO_QUEUE=EXCLUDED_UNTIL_SELF_UPGRADE_GATE');
    expect(wo.body).toContain('NO_DIRECT_MAIN=true');
    expect(wo.body).toContain('APP_CHROME_MUTATION=FORBIDDEN');
    expect(wo.body).toContain('EVIDENCE_HASH=');
    expect(wo.body).toContain('ACCEPTANCE=');
    expect(wo.body).toContain('REQUIRED_TESTS=');
    expect(wo.body).toContain('PROVENANCE=SELF_AUDIT|DEGRADED_RESOURCE_ROUTING|route');
  });

  it('bounded synthetic canary produces one safe WO action + one Owner exception without mutation',()=>{
    const canary=syntheticAutonomousRcaCanary();
    expect(canary).toMatchObject({ok:true,pass:true,fixtureCount:5,dedupedCount:5,mutation:false});
    expect(canary.safeAction.type).toBe('IMPROVEMENT_WORK_ORDER');
    expect(canary.hardGateAction.type).toBe('OWNER_EXCEPTION');
  });

  it('wires RCA only after repeated durable OPEN evidence and exposes a read-only canary',()=>{
    const source=readFileSync(new URL('../apps/tigeriq-core/core.mjs',import.meta.url),'utf8');
    expect(source).toContain("where status='OPEN' and count>=2");
    expect(source).toContain("data->>'rcaFamilyKey'=$2");
    expect(source).toContain("data#>>'{provenance,contractId}'=$3");
    expect(source).toContain('githubAutonomousRcaIssueLifecycle');
    expect(source).toContain('AUTONOMOUS_RCA_CANONICAL_REARMED');
    expect(source).toContain("stateReason==='completed'");
    expect(source).toContain("req.method==='GET'&&url.pathname==='/api/self-audit/rca-canary'");
    expect(source).not.toContain("req.method==='POST'&&url.pathname==='/api/self-audit/rca-canary'");
  });
});
