import { describe, expect, it } from 'vitest';
import { buildDashboard, emptyDashboard } from '../apps/dashboard/src/index.js';
import type { WorkOrderSnapshot } from '../packages/control-plane/src/index.js';

function snapshot(id: string, status: WorkOrderSnapshot['order']['status'], gateStatus?: 'pass'|'fail'|'blocked'): WorkOrderSnapshot {
  return {
    order: { id, project: 'TigerIQ', goal: `Goal ${id}`, scope: ['scope'], invariants: ['safe'], acceptanceCriteria: ['verified'], status },
    evidence: [{ id: `e-${id}`, workOrderId: id, gate: 'CI', commitSha: 'abc1234', command: 'npm run ci', exitCode: gateStatus === 'fail' ? 1 : 0, status: gateStatus === 'fail' ? 'fail' : 'pass', timestamp: '2026-08-29T00:00:00Z' }],
    decisions: gateStatus ? [{ gate: 'CI', status: gateStatus, evaluatorId: 'reviewer', evidenceIds: [`e-${id}`], timestamp: '2026-08-29T00:00:00Z' }] : [],
    audit: [],
  };
}

describe('control center dashboard', () => {
  it('summarizes active, blocked, failing gates and evidence', () => {
    const result = buildDashboard([
      snapshot('WO-1', 'running'),
      snapshot('WO-2', 'blocked', 'blocked'),
      snapshot('WO-3', 'failed', 'fail'),
    ], new Date('2026-08-29T08:00:00Z'));
    expect(result.activeWorkOrders).toBe(2);
    expect(result.blockedWorkOrders).toBe(1);
    expect(result.failingGates).toBe(2);
    expect(result.evidenceCount).toBe(3);
    expect(result.releaseEligible).toBe(false);
    expect(result.workOrders[2]?.failingEvidence).toBe(1);
  });

  it('is release eligible only when every work order is verified with passing evidence', () => {
    expect(buildDashboard([snapshot('WO-1', 'verified', 'pass')]).releaseEligible).toBe(true);
    expect(emptyDashboard().releaseEligible).toBe(false);
  });
});
