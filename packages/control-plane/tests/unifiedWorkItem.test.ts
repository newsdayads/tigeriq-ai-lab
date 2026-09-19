import { describe, it, expect, beforeEach } from 'vitest';
import { projectWorkItem } from '../src/unifiedWorkItem.js';
import { _resetDb, saveObjective, saveJob, saveEvent } from '../src/dbHelpers.js';

describe('UnifiedWorkItem Projector', () => {
  beforeEach(() => {
    _resetDb();
  });

  it('projects objective, jobs, and events into a UnifiedWorkItem', () => {
    const objectiveId = 'obj-123';
    saveObjective({
      id: objectiveId,
      status: 'pending',
      priority: 5,
      kind: 'feature',
      sourceRef: 'repo/branch',
    });

    saveJob({
      id: 'job-1',
      objectiveId,
      status: 'running',
      executor: 'worker-1',
      lease: { holder: 'worker-1', expiresAt: '2025-12-31T23:59:59Z' },
      evidenceRefs: ['ev-1'],
      nextAction: 'run-tests',
    });

    saveEvent({
      id: 'evt-1',
      objectiveId,
      type: 'blocker',
      message: 'missing dependency',
    });

    const unified = projectWorkItem(objectiveId);

    expect(unified).toEqual({
      workItemId: 'obj-123',
      sourceRef: 'repo/branch',
      kind: 'feature',
      assignedExecutor: 'worker-1',
      stage: 'running',
      priority: 5,
      lease: { holder: 'worker-1', expiresAt: '2025-12-31T23:59:59Z' },
      blockers: ['missing dependency'],
      evidenceRefs: ['ev-1'],
      nextAction: 'run-tests',
    });
  });

  it('throws an error if objective does not exist', () => {
    expect(() => projectWorkItem('non-existent')).toThrowError(/not found/);
  });
});
