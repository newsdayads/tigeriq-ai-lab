import { describe, expect, it } from 'vitest';
import {
  WorkManagementStore,
  normalizeScope,
  scopeKeysConflict,
  type PlannedWorkItem,
} from '../packages/work-management/src/index.js';

const goal = {
  goalId: 'G-SCOPE-HARDEN',
  idempotencyKey: 'g-scope-harden',
  objective: 'Reject ambiguous or traversing edit scopes',
  priority: 'P0' as const,
  constraints: ['repo-relative scopes only'],
  maxParallelism: 2,
  createdAt: '2026-09-01T16:30:00.000Z',
};

function work(scopeKey: string): PlannedWorkItem {
  return {
    workId: 'W-SCOPE-HARDEN',
    title: 'Scope hardening',
    objective: 'Prove scope authorization cannot be bypassed with path traversal',
    dependencies: [],
    scopeKeys: [scopeKey],
    requiredCapabilities: ['code'],
    expectedEvidence: ['commit'],
    maxAttempts: 1,
    independentReview: true,
    judgeRequired: true,
  };
}

describe('WO-044 scope-key hardening', () => {
  it('requires every work item to declare at least one conflict scope', () => {
    expect(() => new WorkManagementStore().submit({
      goal,
      items: [{ ...work('packages/work-management'), scopeKeys: [] }],
    })).toThrow(/scopeKeys is required/i);
  });

  it('rejects traversal, absolute, drive-qualified, and ambiguous scope keys at plan intake', () => {
    for (const scope of [
      'packages/work-management/../web',
      'packages/./work-management',
      '/packages/work-management',
      'C:/repo/packages/work-management',
      'packages//work-management',
    ]) {
      expect(() => new WorkManagementStore().submit({ goal, items: [work(scope)] })).toThrow(/invalid scopeKey/i);
    }
  });

  it('keeps normal repo-relative scopes canonical and treats invalid conflict input as unsafe', () => {
    expect(normalizeScope('Packages\\Work-Management/')).toBe('packages/work-management');
    expect(normalizeScope('packages/work-management/../web')).toBe('');
    expect(scopeKeysConflict('packages/work-management/../web', 'packages/web')).toBe(true);
  });
});
