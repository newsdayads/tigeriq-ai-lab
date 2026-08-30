import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileJournal } from '../packages/event-store/src/index.js';
import { CapabilityScheduler, TaskQueue, WorkforceRegistry, type TaskPacket, type WorkerResult } from '../packages/workforce/src/index.js';
import { DurableWorkforceRuntime, MemoryWorkforceStateStore } from '../packages/workforce/src/runtime.js';
import { DurableTaskMailbox } from '../packages/workforce/src/task-mailbox.js';
import { RemoteTaskBroker } from '../packages/workforce/src/remote-task-broker.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()?.(); });

function task(taskId: string, priority: TaskPacket['priority'] = 'P1', maxAttempts = 2): TaskPacket {
  return {
    taskId,
    idempotencyKey: `idem-${taskId}`,
    objective: `execute ${taskId}`,
    department: 'ops',
    priority,
    requiredCapabilities: ['android-ui'],
    constraints: ['no secrets'],
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
  const mailbox = new DurableTaskMailbox(new FileJournal(join(dir, 'mailbox.jsonl')), now, 15_000);
  const broker = new RemoteTaskBroker(runtime, mailbox, now);
  return { broker, queue, registry, advance(ms: number) { nowMs += ms; } };
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

describe('RemoteTaskBroker', () => {
  it('prioritizes queued work, leases it to the scheduler-selected node and accepts one authoritative result', async () => {
    const app = await fixture();
    await app.broker.enqueue(task('LOW', 'P2'));
    await app.broker.enqueue(task('HIGH', 'P0'));

    const lease = await app.broker.poll('PHONE-01');
    expect(lease?.taskId).toBe('HIGH');
    expect(lease?.leaseToken).toBeTruthy();
    expect(app.queue.get('HIGH').stage).toBe('running');

    const result = completed(lease!);
    await app.broker.acceptResult('PHONE-01', lease!.taskId, lease!.leaseId, lease!.leaseToken, result);
    expect(app.queue.get('HIGH').stage).toBe('completed');
    expect(app.registry.getEmployee('OPS-01')?.completedTasks).toBe(1);
    await expect(app.broker.acceptResult('PHONE-01', lease!.taskId, lease!.leaseId, lease!.leaseToken, result)).rejects.toThrow('task is not running');
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
});
