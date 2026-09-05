import { describe, expect, it } from 'vitest';
import { planBlockedWork } from '../packages/workforce/src/autonomy.js';

describe('blocked-not-idle routing', () => {
  it('releases lease and selects next safe Level A work when dependency blocks current scope', () => {
    const plan = planBlockedWork({
      workId: '#368',
      blocker: 'capability_gap',
      dependencyKey: 'pc01.task-action-mutation',
      mutationInFlight: false,
      currentResourceScope: 'pc01-worker-watchdog',
      candidates: [
        { workId: '#401', priority: 1, level: 'A', resourceScope: 'repo-workforce-autonomy' },
        { workId: '#306', priority: 2, level: 'B', authorized: true, resourceScope: 'auto-worker' },
      ],
    });

    expect(plan.state).toBe('waiting_condition');
    expect(plan.releaseLease).toBe(true);
    expect(plan.dependencyWatch).toBe(true);
    expect(plan.ownerActionRequired).toBe(false);
    expect(plan.nextWorkId).toBe('#401');
  });

  it('does not release an in-flight mutation lease', () => {
    const plan = planBlockedWork({
      workId: 'A',
      blocker: 'transient',
      mutationInFlight: true,
      currentResourceScope: 'scope-a',
      candidates: [{ workId: 'B', priority: 1, level: 'A', resourceScope: 'scope-b' }],
    });
    expect(plan.releaseLease).toBe(false);
    expect(plan.retry).toEqual({ maxAttempts: 3, backoffSeconds: [30, 120, 300] });
  });

  it('routes authorization blockers to owner queue while still allowing unrelated safe work', () => {
    const plan = planBlockedWork({
      workId: 'C',
      blocker: 'authorization',
      mutationInFlight: false,
      currentResourceScope: 'production',
      candidates: [
        { workId: 'unsafe-c', priority: 0, level: 'C', resourceScope: 'other-production' },
        { workId: 'safe-a', priority: 1, level: 'A', resourceScope: 'repo-only' },
      ],
    });
    expect(plan.state).toBe('waiting_owner');
    expect(plan.ownerActionRequired).toBe(true);
    expect(plan.nextWorkId).toBe('safe-a');
  });

  it('rejects unauthorized Level B and same-resource work', () => {
    const plan = planBlockedWork({
      workId: 'A',
      blocker: 'external_dependency',
      mutationInFlight: false,
      currentResourceScope: 'scope-a',
      candidates: [
        { workId: 'same', priority: 0, level: 'A', resourceScope: 'scope-a' },
        { workId: 'b-no', priority: 1, level: 'B', authorized: false, resourceScope: 'scope-b' },
        { workId: 'b-yes', priority: 2, level: 'B', authorized: true, resourceScope: 'scope-c' },
      ],
    });
    expect(plan.nextWorkId).toBe('b-yes');
  });
});
