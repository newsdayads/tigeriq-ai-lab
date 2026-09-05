import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileJournal } from '../packages/event-store/src/index.js';
import { CapabilityScheduler, TaskQueue, WorkforceRegistry, type TaskPacket, type WorkerResult } from '../packages/workforce/src/index.js';
import { DurableAutonomyStore } from '../packages/workforce/src/autonomy-store.js';
import { DurableWorkforceRuntime, MemoryWorkforceStateStore } from '../packages/workforce/src/runtime.js';
import { DurableTaskMailbox } from '../packages/workforce/src/task-mailbox.js';
import { RemoteTaskBroker } from '../packages/workforce/src/remote-task-broker.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()?.(); });

interface AutonomyPolicyInput {
  level: 'A' | 'B' | 'C';
  resource: string;
  authorized?: boolean;
}

function task(
  taskId: string,
  priority: TaskPacket['priority'] = 'P1',
  maxAttempts = 2,
  autonomy?: AutonomyPolicyInput,
): TaskPacket {
  const constraints = ['no secrets'];
  if (autonomy) {
    constraints.push(`autonomy:level=${autonomy.level}`, `autonomy:resource=${autonomy.resource}`);
    if (autonomy.authorized) constraints.push('autonomy:authorized=true');
  }
  return {
    taskId,
    idempotencyKey: `idem-${taskId}`,
    objective: `execute ${taskId}`,
    department: 'ops',
    priority,
    requiredCapabilities: ['android-ui'],
    constraints,
    inputs: [],
    expectedArtifacts: ['structured-result'],
    deadline: '2030-01-01T00:00:00.000Z',
    maxAttempts,
    reviewPolicy: { independentReview: true, judgeRequired: false, preferProviderDiversity: true },
  };
}

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'tigeriq-remote-broker-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  let nowMs = Date.parse('2026-08-31T00:00:00.000Z');
  const now = () => new Date(nowMs);
  const registry = new WorkforceRegistry();
  registry.registerNode({ nodeId: 'PHONE-01', kind: 'android', platform: 'test', agentVersion: '0.1.0', capabilities: ['android-ui'], status: 'online', lastHeartbeatAt: now().toISOString() });
  registry.registerEmployee({ employeeId: 'OPS-01', displayName: 'Operator 01', department: 'ops', role: 'operator', nodeId: 'PHONE-01', capabilities: ['android-ui'], availability: 'idle', healthScore: 100, concurrencyLimit: 1 });
  const queue = new TaskQueue();
  const runtime = new DurableWorkforceRuntime(registry, queue, new CapabilityScheduler(registry), new MemoryWorkforceStateStore());
  const journal = new FileJournal(join(dir, 'mailbox.jsonl'));
  const mailbox = new DurableTaskMailbox(journal, now, 15_000);
  const autonomy = new DurableAutonomyStore(journal, now);
  const broker = new RemoteTaskBroker(runtime, mailbox, now, autonomy);
  return { broker, queue, registry, autonomy, advance(ms: number) { nowMs += ms; } };
}

function completed(lease: { taskId: string; employeeId: string }): WorkerResult {
  return {
    taskId: lease.taskId,
    employeeId: lease.employeeId,
    status: 'completed',
    conclusion: 'done',
    confidence: 0.95,
    artifacts: [{ kind: 'json', ref: 'memory://result' }],
    risks: [],
    completedAt: '2026-08-31T00:00:01.000Z',
  };
}

function blocked(lease: { taskId: string; employeeId: string }): WorkerResult {
  return {
    taskId: lease.taskId,
    employeeId: lease.employeeId,
    status: 'failed',
    conclusion: 'waiting for a verified dependency',
    confidence: 1,
    artifacts: [{ kind: 'json', ref: 'memory://blocker' }],
    risks: ['dependency-wait'],
    completedAt: '2026-08-31T00:00:01.000Z',
    failure: { code: 'CAPABILITY_GAP', message: 'required capability is not available yet', retriable: false },
  };
}

describe('RemoteTaskBroker', () => {
  it('prioritizes queued work and keeps authenticated result submission idempotent', async () => {
    const app = await fixture();
    await app.broker.enqueue(task('LOW', 'P2'));
    await app.broker.enqueue(task('HIGH', 'P0'));

    const lease = await app.broker.poll('PHONE-01');
    expect(lease?.taskId).toBe('HIGH');
    expect(lease?.leaseToken).toBeTruthy();
    expect(app.queue.get('HIGH').stage).toBe('running');

    const result = completed(lease!);
    const first = await app.broker.acceptResult('PHONE-01', lease!.taskId, lease!.leaseId, lease!.leaseToken, result);
    const duplicate = await app.broker.acceptResult('PHONE-01', lease!.taskId, lease!.leaseId, lease!.leaseToken, result);
    expect(first.conclusion).toBe('done');
    expect(duplicate.conclusion).toBe('done');
    expect(app.queue.get('HIGH').stage).toBe('completed');
    expect(app.registry.getEmployee('OPS-01')?.completedTasks).toBe(1);
    await expect(app.broker.acceptResult('PHONE-01', lease!.taskId, lease!.leaseId, 'wrong-token', result)).rejects.toThrow('invalid task lease token');
  });

  it('recovers an expired lease, consumes one bounded attempt and re-leases on the next poll', async () => {
    const app = await fixture();
    await app.broker.enqueue(task('RETRY', 'P1', 2));
    const first = await app.broker.poll('PHONE-01');
    expect(first?.attempt).toBe(1);

    app.advance(16_000);
    const second = await app.broker.poll('PHONE-01');
    expect(second?.taskId).toBe('RETRY');
    expect(second?.attempt).toBe(2);
    expect(second?.leaseId).not.toBe(first?.leaseId);
    expect(app.queue.get('RETRY').attempts).toBe(2);
    expect(app.registry.getEmployee('OPS-01')?.failedTasks).toBe(1);
  });

  it('does not lease work to a node that the canonical scheduler did not select', async () => {
    const app = await fixture();
    app.registry.registerNode({ nodeId: 'PHONE-02', kind: 'android', platform: 'test', agentVersion: '0.1.0', capabilities: ['android-ui'], status: 'online', lastHeartbeatAt: '2026-08-31T00:00:00.000Z' });
    app.registry.registerEmployee({ employeeId: 'OPS-02', displayName: 'Operator 02', department: 'ops', role: 'operator', nodeId: 'PHONE-02', capabilities: ['android-ui'], availability: 'idle', healthScore: 50, concurrencyLimit: 1 });
    await app.broker.enqueue(task('SELECTED'));

    expect(await app.broker.poll('PHONE-02')).toBeUndefined();
    expect((await app.broker.poll('PHONE-01'))?.employeeId).toBe('OPS-01');
  });

  it('persists a blocker and leases only the exact next safe independent work', async () => {
    const app = await fixture();
    await app.broker.enqueue(task('BLOCKED', 'P0', 2, { level: 'B', resource: 'pc01-watchdog', authorized: true }));
    await app.broker.enqueue(task('SAME-SCOPE', 'P0', 2, { level: 'A', resource: 'pc01-watchdog' }));
    await app.broker.enqueue(task('UNAUTHORIZED-B', 'P0', 2, { level: 'B', resource: 'repo-b', authorized: false }));
    await app.broker.enqueue(task('SAFE-A', 'P2', 2, { level: 'A', resource: 'repo-autonomy' }));

    const lease = await app.broker.poll('PHONE-01');
    expect(lease?.taskId).toBe('BLOCKED');
    const accepted = await app.broker.acceptBlockedResult(
      'PHONE-01', lease!.taskId, lease!.leaseId, lease!.leaseToken, blocked(lease!),
      { blocker: 'capability_gap', dependencyKey: 'pc01.task-action-mutation', mutationInFlight: false },
    );

    expect(accepted.plan.state).toBe('waiting_condition');
    expect(accepted.plan.releaseLease).toBe(true);
    expect(accepted.plan.dependencyWatch).toBe(true);
    expect(accepted.plan.nextWorkId).toBe('SAFE-A');
    expect((await app.autonomy.get('BLOCKED'))?.nextWorkId).toBe('SAFE-A');
    expect(app.queue.get('BLOCKED').stage).toBe('failed');

    const next = await app.broker.poll('PHONE-01');
    expect(next?.taskId).toBe('SAFE-A');
    expect(next?.taskId).not.toBe('SAME-SCOPE');
    expect(next?.taskId).not.toBe('UNAUTHORIZED-B');
  });

  it('requeues blocked work only after its dependency opens and attempts remain', async () => {
    const app = await fixture();
    await app.broker.enqueue(task('WAITING', 'P0', 2, { level: 'B', resource: 'pc01-watchdog', authorized: true }));
    const lease = await app.broker.poll('PHONE-01');
    await app.broker.acceptBlockedResult(
      'PHONE-01', lease!.taskId, lease!.leaseId, lease!.leaseToken, blocked(lease!),
      { blocker: 'external_dependency', dependencyKey: 'task-action-ready', mutationInFlight: false },
    );

    expect(await app.broker.poll('PHONE-01')).toBeUndefined();
    expect(await app.broker.resumeDependency('other-dependency')).toEqual([]);
    expect(app.queue.get('WAITING').stage).toBe('failed');

    expect(await app.broker.resumeDependency('task-action-ready')).toEqual(['WAITING']);
    expect(app.queue.get('WAITING').stage).toBe('queued');
    expect(await app.autonomy.get('WAITING')).toBeUndefined();
    const retry = await app.broker.poll('PHONE-01');
    expect(retry?.taskId).toBe('WAITING');
    expect(retry?.attempt).toBe(2);
  });

  it('refuses blocked lease release while a mutation is still in flight', async () => {
    const app = await fixture();
    await app.broker.enqueue(task('MUTATING', 'P0', 2, { level: 'B', resource: 'pc01-watchdog', authorized: true }));
    const lease = await app.broker.poll('PHONE-01');
    await expect(app.broker.acceptBlockedResult(
      'PHONE-01', lease!.taskId, lease!.leaseId, lease!.leaseToken, blocked(lease!),
      { blocker: 'capability_gap', dependencyKey: 'pc01.task-action-mutation', mutationInFlight: true },
    )).rejects.toThrow('blocked result cannot release an in-flight mutation');
    expect(app.queue.get('MUTATING').stage).toBe('running');
  });
});
