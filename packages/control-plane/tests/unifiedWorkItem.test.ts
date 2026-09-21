import { describe, it, expect, beforeEach } from 'vitest';
import { projectWorkItem } from '../src/unifiedWorkItem.js';
import { objectivesStore, jobsStore, eventsStore } from '../src/dbHelpers.js';

describe('projectWorkItem', () => {
  beforeEach(() => {
    objectivesStore.clear();
    jobsStore.clear();
    eventsStore.clear();
  });

  it('should project a unified work item from objectives, jobs, and events', () => {
    const id = 'obj-123';
    objectivesStore.set(id, {
      workItemId: id,
      sourceRef: 'github://repo/1',
      kind: 'coding',
      assignedExecutor: 'agent-1',
      stage: 'QUEUED',
      priority: 10,
      lease: 'lease-abc',
      blockers: ['missing-key'],
      evidenceRefs: ['ev-1'],
      nextAction: 'review',
      telemetry: { req: 42 },
    });

    jobsStore.set(id, {
      workItemId: id,
      stage: 'WORKING',
      telemetry: { req: 99 },
    });

    eventsStore.set(id, [
      { id: 'ev-01', objectiveId: id, stage: 'EVIDENCE', timestamp: new Date().toISOString() },
    ]);

    const unified = projectWorkItem(id);
    expect(unified.workItemId).toBe(id);
    expect(unified.sourceRef).toBe('github://repo/1');
    expect(unified.kind).toBe('coding');
    expect(unified.assignedExecutor).toBe('agent-1');
    expect(unified.stage).toBe('EVIDENCE');
    expect(unified.priority).toBe(10);
    expect(unified.lease).toBe('lease-abc');
    expect(unified.blockers).toEqual(['missing-key']);
    expect(unified.evidenceRefs).toEqual(['ev-1']);
    expect(unified.nextAction).toBe('review');
  });

  it('should include telemetry in projection', () => {
    const id = 'obj-456';
    objectivesStore.set(id, { workItemId: id, telemetry: { req: 100 } });
    const unified = projectWorkItem(id);
    expect(unified).toHaveProperty('telemetry');
  });
});
