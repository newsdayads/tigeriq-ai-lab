import { describe,expect,it } from 'vitest';
import { SELF_AUDIT_CONTRACTS, anomalyMaterializationDecision, evaluateSelfAudit, syntheticSelfAuditCanary } from './self-audit.mjs';

const now=Date.parse('2026-10-02T03:00:00+07:00');
const ids=result=>result.anomalies.map(x=>x.contractId);

describe('Core Self-Audit expected behavior engine',()=>{
  it('publishes at least six machine-readable contracts',()=>{
    expect(SELF_AUDIT_CONTRACTS.length).toBeGreaterThanOrEqual(6);
    expect(new Set(SELF_AUDIT_CONTRACTS.map(x=>x.id)).size).toBe(SELF_AUDIT_CONTRACTS.length);
  });

  it('detects backlog + healthy idle worker without dispatch after grace period',()=>{
    const out=evaluateSelfAudit({queue:{eligibleBacklogCount:3,eligibleIdleWorkers:2,activeWorkCount:0,backlogStableForMs:30000}},{nowMs:now});
    expect(ids(out)).toContain('AUTO_DISPATCH_CONTINUITY');
  });

  it('detects reviewer equal to implementer',()=>{
    const out=evaluateSelfAudit({reviews:[{
      jobId:'R1',status:'done',reviewerEmployeeId:'NV12',reviewerResourceId:'res-review',
      implementerEmployeeIds:['NV12'],implementerResourceIds:['res-other']
    }]},{nowMs:now});
    expect(ids(out)).toContain('REVIEW_INDEPENDENCE');
  });

  it('detects terminal job retaining lease/resource binding',()=>{
    const out=evaluateSelfAudit({terminalJobs:[{
      id:'J1',status:'done',leaseUntil:'2026-10-02T03:05:00+07:00',resourceStillBound:true,completedAgeMs:10000
    }]},{nowMs:now});
    expect(ids(out)).toContain('TERMINAL_LEASE_RELEASE');
  });

  it('detects ERROR resource receiving active work',()=>{
    const out=evaluateSelfAudit({activeAssignments:[{
      jobId:'J2',status:'running',resourceId:'res-bad',employeeId:'NV10',healthState:'ERROR',credentialState:'READY'
    }]},{nowMs:now});
    expect(ids(out)).toContain('DEGRADED_RESOURCE_ROUTING');
  });

  it('detects stale installed runtime SHA',()=>{
    const out=evaluateSelfAudit({runtime:{expectedSha:'aaaaaaaa',installedSha:'bbbbbbbb'}},{nowMs:now});
    expect(ids(out)).toContain('RUNTIME_SOURCE_SHA');
  });

  it('detects healthy service with failed expected behavior',()=>{
    const out=evaluateSelfAudit({service:{healthy:true,functionalFailures:['routing-continuity']}},{nowMs:now});
    expect(ids(out)).toContain('SERVICE_FUNCTIONAL_INTEGRITY');
  });

  it('detects dependency terminal-gate violation',()=>{
    const out=evaluateSelfAudit({dependencies:[{
      objectiveId:'OBJ-GH-2707',status:'completed',dependencyGateRequired:true,dependencyGatePass:false,
      dependencyGateReason:'dependency_not_terminal_accepted'
    }]},{nowMs:now});
    expect(ids(out)).toContain('DEPENDENCY_TERMINAL_GATE');
  });

  it('guards false positives during grace/settle windows',()=>{
    const out=evaluateSelfAudit({
      queue:{eligibleBacklogCount:1,eligibleIdleWorkers:1,activeWorkCount:0,backlogStableForMs:500},
      terminalJobs:[{id:'J3',status:'done',leaseUntil:'x',resourceStillBound:true,completedAgeMs:500}],
    },{nowMs:now,minBacklogStableMs:15000,minTerminalSettleMs:5000});
    expect(out.anomalies).toEqual([]);
  });

  it('dedupes the same anomaly signature until cooldown elapses',()=>{
    const anomaly={signature:'sig'};
    expect(anomalyMaterializationDecision(null,anomaly,{nowMs:now,cooldownMs:60000})).toMatchObject({materialize:true,reason:'NEW_SIGNATURE'});
    const existing={status:'OPEN',last_materialized_at:new Date(now-1000).toISOString()};
    expect(anomalyMaterializationDecision(existing,anomaly,{nowMs:now,cooldownMs:60000})).toMatchObject({materialize:false,reason:'DEDUP_COOLDOWN'});
    expect(anomalyMaterializationDecision(existing,anomaly,{nowMs:now+61000,cooldownMs:60000})).toMatchObject({materialize:true,reason:'COOLDOWN_ELAPSED'});
  });

  it('bounded synthetic canary detects two anomalies without queue mutation',()=>{
    const out=syntheticSelfAuditCanary({nowMs:now});
    expect(out.pass).toBe(true);
    expect(out.queueMutation).toBe(false);
    expect(ids(out)).toEqual(expect.arrayContaining(['AUTO_DISPATCH_CONTINUITY','TERMINAL_LEASE_RELEASE']));
  });
});
