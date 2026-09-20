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

  it('surfaces blocking evidence inline for owner visibility', () => {
    const plane = new ControlPlane();
    plane.create({ ...order, id: 'CORE-1033-BLOCKED', status: 'draft', pr: 'https://github.com/newsdayads/tigeriq-ai-lab/pull/1088' }, planner);
    plane.transition('CORE-1033-BLOCKED', 'approved', approver);
    plane.transition('CORE-1033-BLOCKED', 'running', coder);
    const blocked = plane.recordEvidence('CORE-1033-BLOCKED', {
      ...evidence,
      id: 'EV-BLOCKED',
      workOrderId: 'CORE-1033-BLOCKED',
      gate: 'CI',
      status: 'fail',
      exitCode: 1,
    }, coder);

    expect(projectCoreWorkItem(blocked)).toMatchObject({
      status: 'EVIDENCE',
      blockers: ['CI:fail:exitCode=1'],
      nextAction: 'Run independent verification',
    });
  });
});
