import { describe, expect, it } from 'vitest';
import { planBlockedWork, planNearEmptyAudit } from '../packages/workforce/src/autonomy.js';

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

describe('near-empty-not-idle self audit', () => {
  const valid = (workId: string, kind: 'bug' | 'manual_work' | 'self_heal' | 'observability' | 'small_improvement') => ({
    workId,
    kind,
    level: 'A' as const,
    resourceScope: `scope-${workId}`,
    evidenceRefs: [`evidence:${workId}`],
    acceptanceCriteria: [`${workId} regression passes`],
    rollback: `revert ${workId}`,
  });

  it('triggers at one eligible work item and selects at most three evidenced Level A findings by value order', () => {
    const plan = planNearEmptyAudit({
      eligibleWorkCount: 1,
      primaryWaiting: false,
      mutationInFlight: false,
      findings: [
        valid('obs', 'observability'),
        valid('heal', 'self_heal'),
        valid('bug', 'bug'),
        valid('manual', 'manual_work'),
      ],
    });
    expect(plan.triggered).toBe(true);
    expect(plan.reason).toBe('near_empty');
    expect(plan.selected.map((item) => item.workId)).toEqual(['bug', 'manual', 'heal']);
  });

  it('does not invent work: rejects missing evidence, owner conflicts, and non-Level-A findings', () => {
    const plan = planNearEmptyAudit({
      eligibleWorkCount: 0,
      primaryWaiting: true,
      mutationInFlight: false,
      findings: [
        { ...valid('no-evidence', 'bug'), evidenceRefs: [] },
        { ...valid('conflict', 'manual_work'), ownerConflict: true },
        { ...valid('level-b', 'self_heal'), level: 'B' as const },
      ],
    });
    expect(plan.triggered).toBe(true);
    expect(plan.reason).toBe('waiting');
    expect(plan.selected).toEqual([]);
  });

  it('does not start a self-audit work transition while a mutation is in flight', () => {
    const plan = planNearEmptyAudit({
      eligibleWorkCount: 0,
      primaryWaiting: true,
      mutationInFlight: true,
      findings: [valid('bug', 'bug')],
    });
    expect(plan).toEqual({ triggered: false, reason: 'mutation_in_flight', selected: [] });
  });

  it('does nothing when more than one eligible work item remains and the primary item is not waiting', () => {
    const plan = planNearEmptyAudit({
      eligibleWorkCount: 2,
      primaryWaiting: false,
      mutationInFlight: false,
      findings: [valid('bug', 'bug')],
    });
    expect(plan).toEqual({ triggered: false, reason: 'not_needed', selected: [] });
  });
});
