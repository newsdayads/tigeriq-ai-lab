import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileJournal } from '../packages/event-store/src/index.js';
import {
  AutonomousWorkManager,
  WorkManagementStore,
  scopeKeysConflict,
  type GoalPlan,
  type ManagedWorker,
  type PlannedWorkItem,
  type WorkDriver,
  type WorkManagementSnapshot,
  type WorkManagementStateStore,
} from '../packages/work-management/src/index.js';
import { FileJournalWorkManagementStateStore } from '../packages/work-management/src/journal-store.js';

const baseGoal = {
  goalId: 'G-1',
  idempotencyKey: 'goal-1',
  objective: 'Deliver verified work',
  priority: 'P0' as const,
  constraints: ['no secrets'],
  maxParallelism: 2,
  createdAt: '2026-08-31T00:00:00.000Z',
};

function item(workId: string, dependencies: string[] = [], scopeKeys: string[] = [workId]): PlannedWorkItem {
  return {
    workId,
    title: workId,
    objective: `Do ${workId}`,
    dependencies,
    scopeKeys,
    requiredCapabilities: ['code'],
    expectedEvidence: ['commit'],
    maxAttempts: 2,
    independentReview: true,
    judgeRequired: true,
  };
}

const reviewerDriver: WorkDriver = {
  review: async ({ worker, work }) => ({
    verdict: 'pass',
    conclusion: `${worker.workerId} reviewed ${work.workId}`,
    evidence: [{ kind: 'text', ref: 'review://pass' }],
  }),
};

const judgeDriver: WorkDriver = {
  judge: async ({ worker, work }) => ({
    verdict: 'pass',
    conclusion: `${worker.workerId} judged ${work.workId}`,
    evidence: [{ kind: 'text', ref: 'judge://pass' }],
  }),
};

function worker(workerId: string, roles: ManagedWorker['roles'], kind: ManagedWorker['kind'] = 'ai'): ManagedWorker {
  return { workerId, kind, roles, capabilities: ['code'], concurrencyLimit: 2, online: true };
}

class CapturingStateStore implements WorkManagementStateStore {
  readonly saves: WorkManagementSnapshot[] = [];

  async load(): Promise<WorkManagementSnapshot | undefined> {
    return this.saves.at(-1) ? structuredClone(this.saves.at(-1)) : undefined;
  }

  async save(snapshot: WorkManagementSnapshot): Promise<void> {
    this.saves.push(structuredClone(snapshot));
  }
}

describe('WO-044 work management system', () => {
  it('detects hierarchical scope conflicts', () => {
    expect(scopeKeysConflict('packages/workforce', 'packages/workforce/src/index.ts')).toBe(true);
    expect(scopeKeysConflict('packages/workforce', 'packages/work-orders')).toBe(false);
  });

  it('deduplicates goals, resolves dependencies, and rejects dependency cycles', () => {
    const plan: GoalPlan = { goal: baseGoal, items: [item('A'), item('B'), item('C', ['A', 'B'])] };
    const store = new WorkManagementStore();
    const first = store.submit(plan, '2026-08-31T00:00:00.000Z');
    const duplicate = store.submit({ ...plan, goal: { ...baseGoal, goalId: 'G-duplicate' } }, '2026-08-31T00:00:01.000Z');
    expect(first.goal.goalId).toBe('G-1');
    expect(duplicate.goal.goalId).toBe('G-1');
    expect(store.readyWork('G-1', '2026-08-31T00:00:01.000Z').map((work) => work.work.workId)).toEqual(['A', 'B']);

    expect(() => new WorkManagementStore().submit({
      goal: { ...baseGoal, goalId: 'G-CYCLE', idempotencyKey: 'goal-cycle' },
      items: [item('X', ['Y']), item('Y', ['X'])],
    })).toThrow(/dependency cycle/i);
  });

  it('locks overlapping scopes and safely requeues an expired execution lease after restart', () => {
    const store = new WorkManagementStore();
    store.submit({ goal: baseGoal, items: [item('A'), item('B')] }, '2026-08-31T00:00:00.000Z');
    store.claim('A', worker('EXEC-1', ['executor']), 'executor', 60_000, '2026-08-31T00:00:02.000Z');
    expect(store.canLockScopes('B', ['A/file.ts'], '2026-08-31T00:00:03.000Z')).toBe(false);

    const restored = new WorkManagementStore(store.exportSnapshot());
    restored.recover('2026-08-31T00:02:00.000Z');
    expect(restored.getWork('A').stage).toBe('ready');
    expect(restored.history('G-1').some((event) => event.detail === 'execution_lease_expired_retry')).toBe(true);
  });

  it('runs independent work in parallel, then dependencies, reviewer, and judge with role separation', async () => {
    const executionOrder: string[] = [];
    let active = 0;
    let maxActive = 0;
    const manager = new AutonomousWorkManager(new WorkManagementStore(), 60_000);
    await manager.submitGoal(baseGoal, { decompose: async () => [item('A'), item('B'), item('C', ['A', 'B'])] }, '2026-08-31T00:00:00.000Z');

    const execDriver = (id: string): WorkDriver => ({
      execute: async ({ work }) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        executionOrder.push(`${id}:${work.workId}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return { status: 'completed', conclusion: 'done', evidence: [{ kind: 'commit', ref: `${work.workId}-sha` }] };
      },
    });

    manager.registerWorker({ ...worker('EXEC-1', ['executor']), concurrencyLimit: 1 }, execDriver('EXEC-1'));
    manager.registerWorker({ ...worker('EXEC-2', ['executor'], 'pc01'), concurrencyLimit: 1 }, execDriver('EXEC-2'));
    manager.registerWorker(worker('REVIEW-1', ['reviewer']), reviewerDriver);
    manager.registerWorker(worker('JUDGE-1', ['judge']), judgeDriver);

    const result = await manager.runUntilQuiescent('G-1', { maxCycles: 10, now: () => '2026-08-31T00:00:10.000Z' });
    expect(result.goal.status).toBe('completed');
    expect(result.goal.work.every((work) => work.stage === 'completed')).toBe(true);
    expect(maxActive).toBe(2);

    const cIndex = executionOrder.findIndex((entry) => entry.endsWith(':C'));
    expect(cIndex).toBeGreaterThan(executionOrder.findIndex((entry) => entry.endsWith(':A')));
    expect(cIndex).toBeGreaterThan(executionOrder.findIndex((entry) => entry.endsWith(':B')));
    for (const record of result.goal.work) {
      expect(record.reviewerIds.some((id) => record.executorIds.includes(id))).toBe(false);
      expect(record.judgeIds.some((id) => record.executorIds.includes(id) || record.reviewerIds.includes(id))).toBe(false);
    }
  });

  it('self-retries retriable failures and refuses false DONE without evidence', async () => {
    const manager = new AutonomousWorkManager(new WorkManagementStore(), 60_000);
    await manager.submitGoal({ ...baseGoal, goalId: 'G-R', idempotencyKey: 'goal-r', maxParallelism: 1 }, { decompose: async () => [item('R')] });
    let attempts = 0;
    manager.registerWorker({ ...worker('E-R', ['executor']), concurrencyLimit: 1 }, {
      execute: async () => {
        attempts += 1;
        return attempts === 1
          ? { status: 'completed', conclusion: 'claimed done without proof', evidence: [] }
          : { status: 'completed', conclusion: 'fixed and proved', evidence: [{ kind: 'commit', ref: 'fixed-sha' }] };
      },
    });
    manager.registerWorker(worker('R-R', ['reviewer']), reviewerDriver);
    manager.registerWorker(worker('J-R', ['judge']), judgeDriver);

    const result = await manager.runUntilQuiescent('G-R', { maxCycles: 10 });
    expect(result.goal.status).toBe('completed');
    expect(result.goal.work[0].attempts).toBe(2);
    expect(result.goal.work[0].execution?.evidence).toHaveLength(1);
    expect(result.goal.work[0].executorIds).toEqual(['E-R']);
    expect(manager.store.history('G-R').some((event) => event.detail === 'execution_failed_retry')).toBe(true);
  });

  it('rejects stale worker results returned after lease expiry and exhausts bounded retries', async () => {
    const staleItem = { ...item('S'), independentReview: false, judgeRequired: false };
    const manager = new AutonomousWorkManager(new WorkManagementStore(), 1_000);
    await manager.submitGoal({ ...baseGoal, goalId: 'G-S', idempotencyKey: 'goal-s', maxParallelism: 1 }, { decompose: async () => [staleItem] });
    manager.registerWorker({ ...worker('E-S', ['executor']), concurrencyLimit: 1 }, {
      execute: async () => ({ status: 'completed', conclusion: 'late result', evidence: [{ kind: 'commit', ref: 'late-sha' }] }),
    });
    let tick = 0;
    const result = await manager.runUntilQuiescent('G-S', {
      maxCycles: 10,
      now: () => new Date(Date.parse('2026-08-31T00:00:00.000Z') + tick++ * 2_000).toISOString(),
    });
    expect(result.goal.status).toBe('failed');
    expect(result.goal.work[0].attempts).toBe(2);
    expect(result.goal.work[0].execution).toBeUndefined();
    expect(manager.store.history('G-S').some((event) => event.detail === 'execution_lease_expired_exhausted')).toBe(true);
  });

  it('automatically checkpoints running and terminal states before and after external work', async () => {
    const persistence = new CapturingStateStore();
    const terminalItem = { ...item('P'), independentReview: false, judgeRequired: false };
    const manager = new AutonomousWorkManager(new WorkManagementStore(), 60_000, persistence);
    await manager.submitGoal({ ...baseGoal, goalId: 'G-P', idempotencyKey: 'goal-p', maxParallelism: 1 }, { decompose: async () => [terminalItem] }, '2026-08-31T00:00:00.000Z');
    manager.registerWorker(worker('E-P', ['executor']), {
      execute: async () => ({ status: 'completed', conclusion: 'persisted', evidence: [{ kind: 'commit', ref: 'persisted-sha' }] }),
    });
    const result = await manager.runUntilQuiescent('G-P', { maxCycles: 5, now: () => '2026-08-31T00:00:10.000Z' });
    expect(result.goal.status).toBe('completed');
    const stages = persistence.saves.flatMap((snapshot) => snapshot.goals.flatMap((goal) => goal.work.map((work) => work.stage)));
    expect(stages).toContain('running');
    expect(stages).toContain('completed');
  });

  it('persists snapshots in the existing hash-chained FileJournal and restores them', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tigeriq-wo044-'));
    try {
      const journal = new FileJournal(join(dir, 'work-management.jsonl'));
      const persistence = new FileJournalWorkManagementStateStore(journal);
      const store = new WorkManagementStore();
      store.submit({ goal: baseGoal, items: [item('A')] }, '2026-08-31T00:00:00.000Z');
      await persistence.save(store.exportSnapshot(), '2026-08-31T00:00:01.000Z');
      const snapshot = await persistence.load();
      expect(snapshot).toBeDefined();
      const restored = new WorkManagementStore(snapshot);
      expect(restored.getGoal('G-1').work[0].stage).toBe('ready');
      expect((await journal.readAll())).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
