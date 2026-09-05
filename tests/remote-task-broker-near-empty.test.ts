import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileJournal } from '../packages/event-store/src/index.js';
import { CapabilityScheduler, TaskQueue, WorkforceRegistry, type TaskPacket, type WorkerResult } from '../packages/workforce/src/index.js';
import { DurableAutonomyStore } from '../packages/workforce/src/autonomy-store.js';
import { DurableWorkforceRuntime, MemoryWorkforceStateStore } from '../packages/workforce/src/runtime.js';
import { DurableTaskMailbox } from '../packages/workforce/src/task-mailbox.js';
import { RemoteTaskBroker, type NearEmptyAuditProvider, type NearEmptyAuditProposal } from '../packages/workforce/src/remote-task-broker.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()?.(); });

function task(taskId: string, priority: TaskPacket['priority'], level: 'A' | 'B' = 'A', resource = `scope-${taskId}`): TaskPacket {
  return {
    taskId,
    idempotencyKey: `idem-${taskId}`,
    objective: `Improve ${taskId}`,
    department: 'ops',
    priority,
    requiredCapabilities: ['android-ui'],
    constraints: ['no secrets', `autonomy:level=${level}`, `autonomy:resource=${resource}`],
    inputs: [],
    expectedArtifacts: ['structured-result'],
    deadline: '2030-01-01T00:00:00.000Z',
    maxAttempts: 2,
    reviewPolicy: { independentReview: true, judgeRequired: false, preferProviderDiversity: true },
  };
}

function proposal(taskId: string, kind: NearEmptyAuditProposal['finding']['kind'], level: 'A' | 'B' = 'A'): NearEmptyAuditProposal {
  const packet = task(taskId, 'P1', level);
  return {
    task: packet,
    finding: {
      workId: taskId,
      objective: packet.objective,
      kind,
      level,
      resourceScope: `scope-${taskId}`,
      evidenceRefs: [`evidence:${taskId}`],
      acceptanceCriteria: [`${taskId} regression passes`],
      rollback: `revert ${taskId}`,
    },
  };
}

async function fixture(provider: NearEmptyAuditProvider) {
  const dir = await mkdtemp(join(tmpdir(), 'tigeriq-near-empty-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const now = () => new Date('2026-09-05T05:00:00.000Z');
  const registry = new WorkforceRegistry();
  registry.registerNode({ nodeId: 'PHONE-01', kind: 'android', platform: 'test', agentVersion: '0.1.0', capabilities: ['android-ui'], status: 'online', lastHeartbeatAt: now().toISOString() });
  registry.registerEmployee({ employeeId: 'OPS-01', displayName: 'Operator 01', department: 'ops', role: 'operator', nodeId: 'PHONE-01', capabilities: ['android-ui'], availability: 'idle', healthScore: 100, concurrencyLimit: 1 });
  const queue = new TaskQueue();
  const runtime = new DurableWorkforceRuntime(registry, queue, new CapabilityScheduler(registry), new MemoryWorkforceStateStore());
  const journal = new FileJournal(join(dir, 'mailbox.jsonl'));
  const mailbox = new DurableTaskMailbox(journal, now, 15_000);
  const autonomy = new DurableAutonomyStore(journal, now);
  const broker = new RemoteTaskBroker(runtime, mailbox, now, autonomy, provider);
  return { broker, queue, autonomy };
}

function blocked(lease: { taskId: string; employeeId: string }): WorkerResult {
  return {
    taskId: lease.taskId,
    employeeId: lease.employeeId,
    status: 'failed',
    conclusion: 'waiting for dependency',
    confidence: 1,
    artifacts: [{ kind: 'json', ref: 'memory://blocker' }],
    risks: ['dependency-wait'],
    completedAt: '2026-09-05T05:00:01.000Z',
    failure: { code: 'CAPABILITY_GAP', message: 'dependency unavailable', retriable: false },
  };
}

describe('RemoteTaskBroker near-empty self audit', () => {
  it('auto-creates at most three evidenced Level A tasks before the worker becomes idle', async () => {
    const provider: NearEmptyAuditProvider = {
      async inspect() {
        return [
          proposal('OBS', 'observability'),
          proposal('MANUAL', 'manual_work'),
          proposal('BUG', 'bug'),
          proposal('HEAL', 'self_heal'),
        ];
      },
    };
    const app = await fixture(provider);
    await app.broker.enqueue(task('BASE', 'P3'));

    const lease = await app.broker.poll('PHONE-01');
    expect(lease?.taskId).toBe('BUG');
    expect(app.queue.list().map((record) => record.task.taskId).sort()).toEqual(['BASE', 'BUG', 'HEAL', 'MANUAL']);
    expect(app.queue.list().some((record) => record.task.taskId === 'OBS')).toBe(false);
  });

  it('turns a waiting blocker into a newly audited next-safe-work continuation', async () => {
    let calls = 0;
    const provider: NearEmptyAuditProvider = {
      async inspect() {
        calls += 1;
        return calls === 1 ? [] : [proposal('SELF-HEAL', 'self_heal')];
      },
    };
    const app = await fixture(provider);
    await app.broker.enqueue(task('WAITING', 'P0', 'B', 'scope-waiting'));
    const first = await app.broker.poll('PHONE-01');
    expect(first?.taskId).toBe('WAITING');
    await app.broker.acceptBlockedResult(
      'PHONE-01', first!.taskId, first!.leaseId, first!.leaseToken, blocked(first!),
      { blocker: 'capability_gap', dependencyKey: 'external-ready', mutationInFlight: false },
    );

    const next = await app.broker.poll('PHONE-01');
    expect(next?.taskId).toBe('SELF-HEAL');
    expect((await app.autonomy.get('WAITING'))?.nextWorkId).toBe('SELF-HEAL');
  });

  it('fails closed on unsafe proposal metadata and queue duplicates', async () => {
    const badObjective = proposal('BAD-OBJECTIVE', 'bug');
    badObjective.task.objective = 'mismatch';
    const duplicate = proposal('DUPLICATE', 'self_heal');
    const provider: NearEmptyAuditProvider = {
      async inspect() {
        return [badObjective, proposal('LEVEL-B', 'self_heal', 'B'), duplicate, proposal('VALID-A', 'manual_work')];
      },
    };
    const app = await fixture(provider);
    await app.broker.enqueue(duplicate.task);

    const created = await app.broker.runNearEmptyAudit('PHONE-01');
    expect(created).toEqual(['VALID-A']);
    expect(app.queue.list().map((record) => record.task.taskId).sort()).toEqual(['DUPLICATE', 'VALID-A']);
  });
});
