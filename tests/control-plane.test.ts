import { describe, expect, it } from 'vitest';
import { ControlPlane, type Actor } from '../packages/control-plane/src/index.js';
import type { EvidenceRecord } from '../packages/evidence/src/index.js';
import type { WorkOrder } from '../packages/work-orders/src/index.js';

const planner: Actor = { id: 'planner-1', role: 'planner' };
const approver: Actor = { id: 'approver-1', role: 'approver' };
const coder: Actor = { id: 'coder-1', role: 'coder' };
const judge: Actor = { id: 'judge-1', role: 'judge' };
const order: WorkOrder = {
  id: 'WO-001', project: 'TigerIQ', goal: 'Verify a controlled change', scope: ['core'],
  invariants: ['Evidence > AI opinion'], acceptanceCriteria: ['tests pass'], status: 'draft',
};
const evidence: EvidenceRecord = {
  id: 'EV-001', workOrderId: 'WO-001', gate: 'DONE', commitSha: '1234567890abcdef',
  command: 'npm run ci', exitCode: 0, status: 'pass', timestamp: '2026-08-29T00:00:00Z',
};

function runningPlane() {
  const plane = new ControlPlane();
  plane.create(order, planner);
  plane.transition(order.id, 'approved', approver);
  plane.transition(order.id, 'running', coder);
  plane.recordEvidence(order.id, evidence, coder);
  return plane;
}

describe('ControlPlane', () => {
  it('enforces the approved lifecycle and records an audit chain', () => {
    const plane = runningPlane();
    const snapshot = plane.get(order.id);
    expect(snapshot.order.status).toBe('running');
    expect(snapshot.audit).toHaveLength(4);
    expect(snapshot.audit[0]?.metadata?.previousHash).toBeNull();
    expect(snapshot.audit[1]?.metadata?.previousHash).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshot.evidence[0]?.logDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects skipped approval', () => {
    const plane = new ControlPlane();
    plane.create(order, planner);
    expect(() => plane.transition(order.id, 'running', coder)).toThrow('invalid transition');
  });

  it('prevents the coder from declaring verified', () => {
    const plane = runningPlane();
    expect(() => plane.transition(order.id, 'verified', coder)).toThrow('only by recordGateDecision');
    expect(() => plane.recordGateDecision(order.id, {
      gate: 'DONE', status: 'pass', evaluatorId: coder.id, evidenceIds: [evidence.id], timestamp: evidence.timestamp,
    }, coder)).toThrow('reviewer or judge');
  });

  it('allows an independent judge to verify passing evidence', () => {
    const plane = runningPlane();
    const snapshot = plane.recordGateDecision(order.id, {
      gate: 'DONE', status: 'pass', evaluatorId: judge.id, evidenceIds: [evidence.id], timestamp: evidence.timestamp,
    }, judge);
    expect(snapshot.order.status).toBe('verified');
    expect(snapshot.decisions).toHaveLength(1);
  });

  it('fails closed for missing, unknown, or failing evidence', () => {
    const plane = runningPlane();
    const base = { gate: 'DONE' as const, status: 'pass' as const, evaluatorId: judge.id, timestamp: evidence.timestamp };
    expect(() => plane.recordGateDecision(order.id, { ...base, evidenceIds: [] }, judge)).toThrow('requires evidence');
    expect(() => plane.recordGateDecision(order.id, { ...base, evidenceIds: ['unknown'] }, judge)).toThrow('unknown evidence');
    plane.recordEvidence(order.id, { ...evidence, id: 'EV-FAIL', status: 'fail', exitCode: 1 }, coder);
    expect(() => plane.recordGateDecision(order.id, { ...base, evidenceIds: ['EV-FAIL'] }, judge)).toThrow('failing evidence');
  });
});
