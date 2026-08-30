import { describe, expect, it } from 'vitest';
import {
  CapabilityScheduler,
  TaskQueue,
  WorkforceRegistry,
  type EmployeeRecord,
  type TaskPacket,
  type WorkerAdapter,
  type WorkerResult,
} from '../packages/workforce/src/index.js';
import {
  DurableWorkforceRuntime,
  MemoryWorkforceStateStore,
  captureWorkforceSnapshot,
  restoreWorkforceSnapshot,
} from '../packages/workforce/src/runtime.js';

function task(overrides: Partial<TaskPacket> & Pick<TaskPacket, 'taskId' | 'idempotencyKey' | 'objective'>): TaskPacket {
  return {
    taskId: overrides.taskId,
    idempotencyKey: overrides.idempotencyKey,
    objective: overrides.objective,
    department: overrides.department,
    team: overrides.team,
    priority: overrides.priority ?? 'P1',
    requiredCapabilities: overrides.requiredCapabilities ?? ['research'],
    constraints: overrides.constraints ?? ['no secrets'],
    inputs: overrides.inputs ?? [],
    expectedArtifacts: overrides.expectedArtifacts ?? ['structured-result'],
    deadline: overrides.deadline ?? new Date(Date.now() + 60_000).toISOString(),
    maxAttempts: overrides.maxAttempts ?? 2,
    reviewPolicy: overrides.reviewPolicy ?? {
      independentReview: true,
      judgeRequired: false,
      preferProviderDiversity: true,
    },
  };
}

function addEmployee(
  registry: WorkforceRegistry,
  input: { employeeId: string; provider: string; role: string; capabilities: string[]; healthScore?: number },
): void {
  const nodeId = `node-${input.employeeId}`;
  registry.registerNode({
    nodeId,
    kind: 'simulator',
    platform: 'test',
    agentVersion: '1.0.0',
    capabilities: input.capabilities,
    status: 'online',
    lastHeartbeatAt: new Date().toISOString(),
  });
  registry.registerEmployee({
    employeeId: input.employeeId,
    displayName: input.employeeId,
    department: 'research',
    role: input.role,
    nodeId,
    provider: input.provider,
    capabilities: input.capabilities,
    availability: 'idle',
    healthScore: input.healthScore ?? 90,
    concurrencyLimit: 1,
  });
}

class CountingAdapter implements WorkerAdapter {
  readonly kind = 'simulator' as const;
  calls = 0;
  active = 0;
  maxActive = 0;

  async execute(input: TaskPacket, employee: EmployeeRecord): Promise<WorkerResult> {
    this.calls += 1;
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    this.active -= 1;
    const assurance = employee.capabilities.includes('review') || employee.capabilities.includes('judge');
    return {
      taskId: input.taskId,
      employeeId: employee.employeeId,
      status: 'completed',
      conclusion: `${employee.role} completed ${input.objective}`,
      confidence: 0.9,
      verdict: assurance ? 'pass' : undefined,
      artifacts: [{ kind: 'json', ref: `memory://${input.taskId}` }],
      risks: [],
      completedAt: new Date().toISOString(),
    };
  }
}

function runtimeWith(registry: WorkforceRegistry, queue = new TaskQueue(), store?: MemoryWorkforceStateStore) {
  return {
    queue,
    runtime: new DurableWorkforceRuntime(registry, queue, new CapabilityScheduler(registry), store),
  };
}

describe('durable workforce runtime', () => {
  it('executes an idempotent alias against the canonical task and never the alias taskId', async () => {
    const registry = new WorkforceRegistry();
    addEmployee(registry, { employeeId: 'RES-01', provider: 'gemini', role: 'researcher', capabilities: ['research'] });
    const { runtime, queue } = runtimeWith(registry);
    const adapter = new CountingAdapter();
    runtime.registerAdapter(adapter);

    const canonical = task({ taskId: 'TASK-1', idempotencyKey: 'same-work', objective: 'research canonical' });
    const alias = task({ taskId: 'TASK-2', idempotencyKey: 'same-work', objective: 'research duplicate alias' });

    const first = await runtime.execute(canonical);
    const second = await runtime.execute(alias);

    expect(first.taskId).toBe('TASK-1');
    expect(second.taskId).toBe('TASK-1');
    expect(adapter.calls).toBe(1);
    expect(queue.list()).toHaveLength(1);
    expect(() => queue.get('TASK-2')).toThrow('task TASK-2 not found');
  });

  it('prefers provider diversity but falls back to a different employee when only the same provider is available', async () => {
    const registry = new WorkforceRegistry();
    addEmployee(registry, { employeeId: 'RES-01', provider: 'gemini', role: 'researcher', capabilities: ['research'], healthScore: 99 });
    addEmployee(registry, { employeeId: 'RES-02', provider: 'gemini', role: 'researcher', capabilities: ['research'], healthScore: 98 });
    addEmployee(registry, { employeeId: 'REV-01', provider: 'gemini', role: 'reviewer', capabilities: ['review'], healthScore: 97 });
    addEmployee(registry, { employeeId: 'JDG-01', provider: 'gemini', role: 'judge', capabilities: ['judge'], healthScore: 96 });
    const { runtime } = runtimeWith(registry);
    const adapter = new CountingAdapter();
    runtime.registerAdapter(adapter);

    const outcome = await runtime.executeBatchWithAssurance(
      [
        task({ taskId: 'P-A', idempotencyKey: 'p-a', objective: 'primary A', requiredCapabilities: ['research'] }),
        task({ taskId: 'P-B', idempotencyKey: 'p-b', objective: 'primary B', requiredCapabilities: ['research'] }),
      ],
      () => task({
        taskId: 'R-A', idempotencyKey: 'r-a', objective: 'review', requiredCapabilities: ['review'],
        reviewPolicy: { independentReview: true, judgeRequired: true, preferProviderDiversity: true },
      }),
      () => task({
        taskId: 'J-A', idempotencyKey: 'j-a', objective: 'judge', requiredCapabilities: ['judge'],
        reviewPolicy: { independentReview: true, judgeRequired: false, preferProviderDiversity: true },
      }),
    );

    expect(outcome.passed).toBe(true);
    expect(new Set(outcome.primary.map((result) => result.employeeId))).toEqual(new Set(['RES-01', 'RES-02']));
    expect(outcome.review?.employeeId).toBe('REV-01');
    expect(outcome.judgment?.employeeId).toBe('JDG-01');
    expect(new Set([...outcome.primary.map((result) => result.employeeId), outcome.review?.employeeId, outcome.judgment?.employeeId]).size).toBe(4);
  });

  it('restores a completed task and suppresses duplicate execution after restart', async () => {
    const store = new MemoryWorkforceStateStore();
    const registry1 = new WorkforceRegistry();
    addEmployee(registry1, { employeeId: 'RES-01', provider: 'gemini', role: 'researcher', capabilities: ['research'] });
    const { runtime: runtime1 } = runtimeWith(registry1, new TaskQueue(), store);
    const adapter1 = new CountingAdapter();
    runtime1.registerAdapter(adapter1);
    await runtime1.execute(task({ taskId: 'RESTORE-1', idempotencyKey: 'restore-key', objective: 'persist me' }));
    expect(adapter1.calls).toBe(1);

    const registry2 = new WorkforceRegistry();
    const queue2 = new TaskQueue();
    const runtime2 = await DurableWorkforceRuntime.restore(
      registry2,
      queue2,
      new CapabilityScheduler(registry2),
      store,
    );
    const adapter2 = new CountingAdapter();
    runtime2.registerAdapter(adapter2);

    const result = await runtime2.execute(task({ taskId: 'RESTORE-ALIAS', idempotencyKey: 'restore-key', objective: 'same work after restart' }));
    expect(result.taskId).toBe('RESTORE-1');
    expect(adapter2.calls).toBe(0);
    expect(queue2.get('RESTORE-1').stage).toBe('completed');
  });

  it('recovers an in-flight task as queued and consumes only the remaining bounded attempt', async () => {
    const registry1 = new WorkforceRegistry();
    addEmployee(registry1, { employeeId: 'OPS-01', provider: 'gemini', role: 'operator', capabilities: ['ops'] });
    addEmployee(registry1, { employeeId: 'OPS-02', provider: 'openai', role: 'operator', capabilities: ['ops'] });
    const queue1 = new TaskQueue();
    const input = task({
      taskId: 'INFLIGHT-1',
      idempotencyKey: 'inflight-key',
      objective: 'recover in-flight',
      requiredCapabilities: ['ops'],
      maxAttempts: 2,
    });
    queue1.enqueue(input);
    queue1.assign(input.taskId, 'OPS-01');
    registry1.acquire('OPS-01', input.taskId);
    queue1.start(input.taskId);

    const snapshot = captureWorkforceSnapshot(registry1, queue1);
    const registry2 = new WorkforceRegistry();
    const queue2 = new TaskQueue();
    restoreWorkforceSnapshot(snapshot, registry2, queue2);

    expect(queue2.get(input.taskId).stage).toBe('queued');
    expect(queue2.get(input.taskId).attempts).toBe(1);
    expect(registry2.getEmployee('OPS-01')?.activeTaskCount).toBe(0);

    const runtime2 = new DurableWorkforceRuntime(registry2, queue2, new CapabilityScheduler(registry2));
    const adapter2 = new CountingAdapter();
    runtime2.registerAdapter(adapter2);
    const result = await runtime2.execute(input);

    expect(result.status).toBe('completed');
    expect(result.employeeId).toBe('OPS-01');
    expect(queue2.get(input.taskId).attempts).toBe(2);
    expect(adapter2.calls).toBe(1);
  });
});
