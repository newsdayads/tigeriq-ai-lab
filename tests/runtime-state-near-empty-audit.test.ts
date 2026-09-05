import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileJournal } from '../packages/event-store/src/index.js';
import { CapabilityScheduler, TaskQueue, WorkforceRegistry, type TaskPacket, type WorkerResult } from '../packages/workforce/src/index.js';
import { DurableAutonomyStore } from '../packages/workforce/src/autonomy-store.js';
import { RuntimeStateNearEmptyAuditProvider } from '../packages/workforce/src/runtime-state-near-empty-audit.js';
import { DurableWorkforceRuntime, MemoryWorkforceStateStore } from '../packages/workforce/src/runtime.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()?.(); });

function task(taskId: string, generated = false): TaskPacket {
  return {
    taskId,
    idempotencyKey: `idem-${taskId}`,
    objective: `execute ${taskId}`,
    department: 'ops',
    priority: 'P1',
    requiredCapabilities: ['android-ui'],
    constraints: generated ? ['autonomy:self-audit-generated=true'] : [],
    inputs: [],
    expectedArtifacts: ['structured-result'],
    deadline: '2030-01-01T00:00:00.000Z',
    maxAttempts: 2,
    reviewPolicy: { independentReview: true, judgeRequired: false, preferProviderDiversity: true },
  };
}

function retriableFailure(taskId: string): WorkerResult {
  return {
    taskId,
    employeeId: 'OPS-01',
    status: 'failed',
    conclusion: 'transient failure',
    confidence: 1,
    artifacts: [{ kind: 'json', ref: 'memory://failure' }],
    risks: [],
    completedAt: '2026-09-05T05:00:00.000Z',
    failure: { code: 'TRANSIENT', message: 'retry me', retriable: true },
  };
}

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'tigeriq-near-empty-provider-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const registry = new WorkforceRegistry();
  registry.registerNode({
    nodeId: 'PHONE-01', kind: 'android', platform: 'test', agentVersion: '0.1.0',
    capabilities: ['android-ui'], status: 'online', lastHeartbeatAt: '2026-09-05T05:00:00.000Z',
  });
  registry.registerEmployee({
    employeeId: 'OPS-01', displayName: 'Khoa', department: 'ops', role: 'operator', nodeId: 'PHONE-01',
    capabilities: ['android-ui'], availability: 'idle', healthScore: 100, concurrencyLimit: 1,
  });
  const queue = new TaskQueue();
  const runtime = new DurableWorkforceRuntime(registry, queue, new CapabilityScheduler(registry), new MemoryWorkforceStateStore());
  const journal = new FileJournal(join(dir, 'workforce.jsonl'));
  const autonomy = new DurableAutonomyStore(journal, () => new Date('2026-09-05T05:00:00.000Z'));
  const provider = new RuntimeStateNearEmptyAuditProvider(runtime, autonomy, () => new Date('2026-09-05T05:00:00.000Z'));
  return { runtime, queue, autonomy, provider };
}

describe('RuntimeStateNearEmptyAuditProvider', () => {
  it('returns no invented work when runtime state has no machine-verifiable anomaly', async () => {
    const app = await fixture();
    const proposals = await app.provider.inspect({ nodeId: 'PHONE-01', eligibleWorkCount: 0, primaryWaiting: false });
    expect(proposals).toEqual([]);
  });

  it('proposes a Level-A repair task for an orphaned autonomy wait record', async () => {
    const app = await fixture();
    await app.autonomy.record({
      workId: 'MISSING-WORK', nodeId: 'PHONE-01', employeeId: 'OPS-01', blocker: 'external_dependency',
      dependencyKey: 'dep', resourceScope: 'source-scope', state: 'waiting_condition', dependencyWatch: true,
      ownerActionRequired: false, retry: { maxAttempts: 1, backoffSeconds: [300] },
    });

    const proposals = await app.provider.inspect({ nodeId: 'PHONE-01', eligibleWorkCount: 0, primaryWaiting: true });
    expect(proposals).toHaveLength(1);
    expect(proposals[0].finding.kind).toBe('bug');
    expect(proposals[0].finding.level).toBe('A');
    expect(proposals[0].finding.evidenceRefs[0]).toContain('queue record is missing');
    expect(proposals[0].task.constraints).toContain('autonomy:self-audit-generated=true');
    expect(proposals[0].task.constraints).toContain('autonomy:level=A');
    expect(app.runtime.scheduler.select(proposals[0].task)?.nodeId).toBe('PHONE-01');
  });

  it('proposes self-heal work for a retriable failed task with retry budget that is neither queued nor waiting', async () => {
    const app = await fixture();
    app.queue.enqueue(task('STALE-RETRY'));
    app.queue.assign('STALE-RETRY', 'OPS-01');
    app.queue.start('STALE-RETRY');
    app.queue.fail('STALE-RETRY', retriableFailure('STALE-RETRY'));

    const proposals = await app.provider.inspect({ nodeId: 'PHONE-01', eligibleWorkCount: 0, primaryWaiting: false });
    expect(proposals).toHaveLength(1);
    expect(proposals[0].finding.kind).toBe('self_heal');
    expect(proposals[0].finding.evidenceRefs[0]).toContain('failed-retriable:TRANSIENT:attempts=1/2');
    expect(proposals[0].task.maxAttempts).toBe(2);
  });

  it('does not recursively generate audits from a previously generated self-audit task', async () => {
    const app = await fixture();
    app.queue.enqueue(task('SELF-AUDIT-OLD', true));
    app.queue.assign('SELF-AUDIT-OLD', 'OPS-01');
    app.queue.start('SELF-AUDIT-OLD');
    app.queue.fail('SELF-AUDIT-OLD', retriableFailure('SELF-AUDIT-OLD'));

    const proposals = await app.provider.inspect({ nodeId: 'PHONE-01', eligibleWorkCount: 0, primaryWaiting: false });
    expect(proposals).toEqual([]);
  });

  it('keeps generated repair ids distinct when long source ids share the same prefix', async () => {
    const app = await fixture();
    const prefix = 'SAME-PREFIX-'.padEnd(64, 'X');
    await app.autonomy.record({
      workId: `${prefix}-A`, nodeId: 'PHONE-01', employeeId: 'OPS-01', blocker: 'external_dependency',
      dependencyKey: 'dep-a', resourceScope: 'scope-a', state: 'waiting_condition', dependencyWatch: true,
      ownerActionRequired: false, retry: { maxAttempts: 1, backoffSeconds: [300] },
    });
    await app.autonomy.record({
      workId: `${prefix}-B`, nodeId: 'PHONE-01', employeeId: 'OPS-01', blocker: 'external_dependency',
      dependencyKey: 'dep-b', resourceScope: 'scope-b', state: 'waiting_condition', dependencyWatch: true,
      ownerActionRequired: false, retry: { maxAttempts: 1, backoffSeconds: [300] },
    });

    const proposals = await app.provider.inspect({ nodeId: 'PHONE-01', eligibleWorkCount: 0, primaryWaiting: true });
    expect(proposals).toHaveLength(2);
    expect(new Set(proposals.map((proposal) => proposal.task.taskId)).size).toBe(2);
    expect(new Set(proposals.map((proposal) => proposal.finding.resourceScope)).size).toBe(2);
  });
});
