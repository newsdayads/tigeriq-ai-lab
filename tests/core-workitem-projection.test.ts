import { describe, expect, it } from 'vitest';
import { ControlPlane, projectCoreWorkItem, type Actor } from '../packages/control-plane/src/index.js';
import type { EvidenceRecord } from '../packages/evidence/src/index.js';
import type { WorkOrder } from '../packages/work-orders/src/index.js';

const planner: Actor = { id: 'planner-1', role: 'planner' };
const approver: Actor = { id: 'approver-1', role: 'approver' };
const coder: Actor = { id: 'NV12', role: 'coder' };
const judge: Actor = { id: 'NV19', role: 'judge' };

const order: WorkOrder = {
  id: 'CORE-1033',
  project: 'TigerIQ',
  goal: 'Core WorkItem V1 + owner-visible Coding Lane projection',
  scope: ['packages/control-plane/src/index.ts', 'apps/api/src/server.ts'],
  invariants: ['No second queue', 'Evidence > AI opinion'],
  acceptanceCriteria: ['Active Coding Lane work is visible in Core projection'],
  status: 'draft',
  issueRef: 'https://github.com/newsdayads/tigeriq-ai-lab/issues/1033',
  sourceRef: 'https://github.com/newsdayads/tigeriq-ai-lab/issues/1033',
  pr: 'https://github.com/newsdayads/tigeriq-ai-lab/pull/1087',
  kind: 'coding',
  priority: 'P0',
  stage: 'queued',
  nextAction: 'Claim Coding Lane work',
};

const evidence: EvidenceRecord = {
  id: 'EV-1033',
  workOrderId: 'CORE-1033',
  gate: 'DONE',
  commitSha: 'abcdef1234567890',
  command: 'npm run ci',
  exitCode: 0,
  status: 'pass',
  artifactUris: ['https://github.com/newsdayads/tigeriq-ai-lab/pull/1087/checks'],
  timestamp: '2026-09-20T00:00:00Z',
};

describe('Core WorkItem projection', () => {
  it('maps one logical Coding Lane item through the canonical lifecycle', () => {
    const plane = new ControlPlane();
    let snapshot = plane.create(order, planner);
    expect(projectCoreWorkItem(snapshot)).toMatchObject({
      workItemId: 'CORE-1033',
      status: 'QUEUED',
      kind: 'coding',
      issueRef: order.issueRef,
      pr: order.pr,
      priority: 'P0',
      assignedExecutor: null,
    });

    snapshot = plane.transition(order.id, 'approved', approver);
    expect(projectCoreWorkItem(snapshot)).toMatchObject({ status: 'CLAIMED' });

    snapshot = plane.transition(order.id, 'running', coder);
    expect(projectCoreWorkItem(snapshot)).toMatchObject({
      status: 'WORKING',
      assignedExecutor: 'NV12',
      implementer: 'NV12',
      scopeLease: { ownerId: 'NV12', state: 'active' },
    });

    snapshot = plane.recordEvidence(order.id, evidence, coder);
    expect(projectCoreWorkItem(snapshot)).toMatchObject({
      status: 'EVIDENCE',
      evidenceRefs: ['https://github.com/newsdayads/tigeriq-ai-lab/pull/1087/checks'],
      scopeLease: { ownerId: 'NV12', state: 'active' },
    });

    snapshot = plane.recordGateDecision(order.id, {
      gate: 'DONE', status: 'pass', evaluatorId: judge.id, evidenceIds: [evidence.id], timestamp: '2026-09-20T00:01:00Z',
    }, judge);
    expect(projectCoreWorkItem(snapshot)).toMatchObject({
      status: 'DONE',
      reviewer: 'NV19',
      nextAction: null,
      scopeLease: { ownerId: 'NV12', state: 'released' },
    });
  });

  it('maps failed and blocked-gate WorkItems to blocked scope leases', () => {
    const plane = new ControlPlane();
    plane.create({ ...order, id: 'CORE-1033-BLOCKED', status: 'draft', pr: 'https://github.com/newsdayads/tigeriq-ai-lab/pull/1088' }, planner);
    plane.transition('CORE-1033-BLOCKED', 'approved', approver);
    plane.transition('CORE-1033-BLOCKED', 'running', coder);
    plane.recordEvidence('CORE-1033-BLOCKED', {
      ...evidence,
      id: 'EV-BLOCKED',
      workOrderId: 'CORE-1033-BLOCKED',
      gate: 'CI',
      status: 'fail',
      exitCode: 1,
    }, coder);

    const gateBlocked = plane.recordGateDecision('CORE-1033-BLOCKED', {
      gate: 'CI',
      status: 'blocked',
      evaluatorId: judge.id,
      evidenceIds: ['EV-BLOCKED'],
      timestamp: '2026-09-20T00:02:00Z',
      reason: 'CI_FAILED',
    }, judge);

    expect(projectCoreWorkItem(gateBlocked)).toMatchObject({
      status: 'BLOCKED',
      blockers: ['CI:fail:exitCode=1', 'CI:blocked:CI_FAILED'],
      nextAction: 'Resolve blocker and retry safely',
      scopeLease: { ownerId: 'NV12', state: 'blocked' },
    });

    const failed = plane.recordGateDecision('CORE-1033-BLOCKED', {
      gate: 'CI',
      status: 'fail',
      evaluatorId: judge.id,
      evidenceIds: ['EV-BLOCKED'],
      timestamp: '2026-09-20T00:03:00Z',
      reason: 'REVIEW_FAIL',
    }, judge);

    expect(projectCoreWorkItem(failed)).toMatchObject({
      status: 'BLOCKED',
      scopeLease: { ownerId: 'NV12', state: 'blocked' },
    });
  });

  it('updates Coding Lane projection metadata idempotently on the same WorkItem identity', () => {
    const plane = new ControlPlane();
    const pending: WorkOrder = {
      id: 'CORE-1033-ATTACH',
      project: order.project,
      goal: order.goal,
      scope: order.scope,
      invariants: order.invariants,
      acceptanceCriteria: order.acceptanceCriteria,
      status: 'draft',
      issueRef: order.issueRef,
      sourceRef: order.sourceRef,
      kind: 'coding',
      priority: 'P0',
      stage: 'claimed',
      nextAction: 'Open PR',
    };
    plane.create(pending, planner);
    plane.transition('CORE-1033-ATTACH', 'approved', approver);
    let snapshot = plane.transition('CORE-1033-ATTACH', 'running', coder);

    expect(projectCoreWorkItem(snapshot)).toMatchObject({
      workItemId: 'CORE-1033-ATTACH',
      pr: null,
      reviewer: null,
      stage: 'claimed',
      nextAction: 'Open PR',
    });

    const patch = {
      pr: 'https://github.com/newsdayads/tigeriq-ai-lab/pull/1145',
      reviewer: 'NV19',
      stage: 'waiting_ci',
      nextAction: 'Wait exact-head checks',
      evidenceRefs: ['https://github.com/newsdayads/tigeriq-ai-lab/pull/1145/checks'],
    };

    snapshot = plane.updateProjectionMetadata('CORE-1033-ATTACH', patch, coder);
    const updated = projectCoreWorkItem(snapshot);
    expect(updated).toMatchObject({
      workItemId: 'CORE-1033-ATTACH',
      pr: 'https://github.com/newsdayads/tigeriq-ai-lab/pull/1145',
      reviewer: 'NV19',
      stage: 'waiting_ci',
      nextAction: 'Wait exact-head checks',
      evidenceRefs: ['https://github.com/newsdayads/tigeriq-ai-lab/pull/1145/checks'],
    });

    const auditLength = snapshot.audit.length;
    snapshot = plane.updateProjectionMetadata('CORE-1033-ATTACH', patch, coder);
    expect(snapshot.audit).toHaveLength(auditLength);
    expect(projectCoreWorkItem(snapshot)).toMatchObject(updated);
  });

  it('projects Core-selected WorkItem UI routing and integration mapping for autopilot snapshot consumption', () => {
    const plane = new ControlPlane();
    const orderItem: WorkOrder = {
      id: 'CORE-CORE-SELECTED',
      project: 'TigerIQ',
      goal: 'Core UI routing integration',
      scope: ['apps/tigeriq-core/ui-autopilot-snapshot.mjs'],
      invariants: ['Core is sole selector'],
      acceptanceCriteria: ['Core-selected WorkItem mapped cleanly'],
      status: 'draft',
      issueRef: 'https://github.com/newsdayads/tigeriq-ai-lab/issues/1150',
      sourceRef: 'https://github.com/newsdayads/tigeriq-ai-lab/issues/1150',
      kind: 'coding',
      priority: 'P0',
      stage: 'queued',
      nextAction: 'Execute Core-selected WorkItem',
    };
    plane.create(orderItem, planner);
    plane.transition('CORE-CORE-SELECTED', 'approved', approver);
    const snapshot = plane.transition('CORE-CORE-SELECTED', 'running', coder);
    const projected = projectCoreWorkItem(snapshot);
    expect(projected).toMatchObject({
      workItemId: 'CORE-CORE-SELECTED',
      status: 'IN_PROGRESS',
      stage: 'running',
    });
  });
});
