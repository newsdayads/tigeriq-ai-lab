import { describe, expect, it } from 'vitest';
import {
  AutonomousWorkManager,
  WorkManagementStore,
  type ManagedWorker,
  type PlannedWorkItem,
} from '../packages/work-management/src/index.js';

const goal = {
  goalId: 'G-HARDEN',
  idempotencyKey: 'g-harden',
  objective: 'Verify work-management hardening',
  priority: 'P0' as const,
  constraints: ['independent assurance'],
  maxParallelism: 1,
  createdAt: '2026-08-31T06:00:00.000Z',
};

function work(overrides: Partial<PlannedWorkItem> = {}): PlannedWorkItem {
  return {
    workId: 'W-HARDEN',
    title: 'Harden manager',
    objective: 'Prove identity, evidence and timeout gates',
    dependencies: [],
    scopeKeys: ['packages/work-management'],
    requiredCapabilities: ['code'],
    expectedEvidence: ['commit'],
    maxAttempts: 1,
    independentReview: false,
    judgeRequired: false,
    ...overrides,
  };
}

function worker(workerId: string, role: ManagedWorker['roles'][number], independenceKey: string): ManagedWorker {
  return {
    workerId,
    kind: 'ai',
    roles: [role],
    capabilities: ['code'],
    concurrencyLimit: 1,
    independenceKey,
    online: true,
  };
}

describe('WO-044 independent hardening gate', () => {
  it('rejects the same underlying identity registered across assurance roles', () => {
    const manager = new AutonomousWorkManager(new WorkManagementStore());
    manager.registerWorker(worker('EXEC-A', 'executor', 'openai:gpt-x'), {
      execute: async () => ({ status: 'completed', conclusion: 'done', evidence: [{ kind: 'commit', ref: 'abc' }] }),
    });
    expect(() => manager.registerWorker(worker('REVIEW-ALIAS', 'reviewer', 'openai:gpt-x'), {
      review: async () => ({ verdict: 'pass', conclusion: 'same model alias', evidence: [{ kind: 'text', ref: 'review' }] }),
    })).toThrow(/cannot span multiple assurance roles/i);
  });

  it('does not leave a ghost assurance identity after base registration validation fails', () => {
    const manager = new AutonomousWorkManager(new WorkManagementStore());
    expect(() => manager.registerWorker({ ...worker('BAD-EXEC', 'executor', 'shared:identity'), concurrencyLimit: 0 }, {
      execute: async () => ({ status: 'completed', conclusion: 'invalid worker', evidence: [{ kind: 'commit', ref: 'bad' }] }),
    })).toThrow(/concurrencyLimit/i);

    expect(() => manager.registerWorker(worker('VALID-REVIEW', 'reviewer', 'shared:identity'), {
      review: async () => ({ verdict: 'pass', conclusion: 'valid reviewer after rejected worker', evidence: [{ kind: 'text', ref: 'review' }] }),
    })).not.toThrow();
  });

  it('fails closed when execution evidence does not satisfy expectedEvidence', async () => {
    const manager = new AutonomousWorkManager(new WorkManagementStore());
    await manager.submitGoal(goal, { decompose: async () => [work()] });
    manager.registerWorker(worker('EXEC-EVIDENCE', 'executor', 'ollama:qwen'), {
      execute: async () => ({
        status: 'completed',
        conclusion: 'claimed completion with wrong artifact kind',
        evidence: [{ kind: 'text', ref: 'not-a-commit' }],
      }),
    });

    const result = await manager.runUntilQuiescent(goal.goalId, { maxCycles: 3 });
    expect(result.goal.status).toBe('failed');
    expect(result.goal.work[0].lastFailureCode).toBe('EXPECTED_EVIDENCE_MISSING');
    expect(result.goal.work[0].stage).toBe('failed');
  });

  it('bounds a never-resolving driver and aborts its signal', async () => {
    const manager = new AutonomousWorkManager(new WorkManagementStore(), 60_000, undefined, 20);
    await manager.submitGoal(
      { ...goal, goalId: 'G-TIMEOUT', idempotencyKey: 'g-timeout' },
      { decompose: async () => [work({ workId: 'W-TIMEOUT' })] },
    );
    let aborted = false;
    manager.registerWorker(worker('EXEC-HUNG', 'executor', 'local:hung'), {
      execute: async ({ signal }) => new Promise((resolve) => {
        signal?.addEventListener('abort', () => {
          aborted = true;
          // Intentionally do not resolve: manager must stop waiting independently.
        }, { once: true });
        void resolve;
      }),
    });

    const started = Date.now();
    const result = await manager.runUntilQuiescent('G-TIMEOUT', { maxCycles: 3 });
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(500);
    expect(aborted).toBe(true);
    expect(result.goal.status).toBe('failed');
    expect(result.goal.work[0].lastFailureCode).toBe('WORK_DRIVER_TIMEOUT');
  });
});
