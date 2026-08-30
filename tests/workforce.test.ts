import { describe, expect, it } from 'vitest';
import {
  CapabilityScheduler,
  OrganizationChart,
  TaskQueue,
  WorkforceOrchestrator,
  WorkforceRegistry,
  type EmployeeRecord,
  type TaskPacket,
  type WorkerAdapter,
  type WorkerResult,
} from '../packages/workforce/src/index.js';

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

function addNodeAndEmployee(
  registry: WorkforceRegistry,
  input: {
    employeeId: string;
    provider: string;
    role: string;
    capabilities: string[];
    department?: string;
    healthScore?: number;
  },
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
    department: input.department ?? 'research',
    role: input.role,
    nodeId,
    provider: input.provider,
    capabilities: input.capabilities,
    availability: 'idle',
    healthScore: input.healthScore ?? 90,
    concurrencyLimit: 1,
  });
}

class SimAdapter implements WorkerAdapter {
  readonly kind = 'simulator' as const;
  active = 0;
  maxActive = 0;
  readonly calls: Array<{ taskId: string; employeeId: string }> = [];

  async execute(input: TaskPacket, employee: EmployeeRecord): Promise<WorkerResult> {
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    this.calls.push({ taskId: input.taskId, employeeId: employee.employeeId });
    await new Promise((resolve) => setTimeout(resolve, 10));
    this.active -= 1;
    return {
      taskId: input.taskId,
      employeeId: employee.employeeId,
      status: 'completed',
      conclusion: `${employee.role} completed ${input.objective}`,
      confidence: 0.9,
      verdict: employee.capabilities.includes('review') || employee.capabilities.includes('judge') ? 'pass' : undefined,
      artifacts: [{ kind: 'json', ref: `memory://${input.taskId}`, summary: 'simulated structured evidence' }],
      risks: [],
      completedAt: new Date().toISOString(),
    };
  }
}

describe('distributed AI workforce', () => {
  it('models company -> department -> team hierarchy', () => {
    const chart = new OrganizationChart();
    chart.add({ id: 'company', name: 'TigerIQ', type: 'company', managerAgentId: 'chief' });
    chart.add({ id: 'research', name: 'Research', type: 'department', parentId: 'company', managerAgentId: 'head-research' });
    chart.add({ id: 'research-a', name: 'Research Team A', type: 'team', parentId: 'research', managerAgentId: 'lead-research-a' });
    expect(chart.ancestry('research-a').map((unit) => unit.id)).toEqual(['research-a', 'research', 'company']);
  });

  it('registers worker nodes, tracks heartbeat and propagates offline state', () => {
    const registry = new WorkforceRegistry();
    addNodeAndEmployee(registry, { employeeId: 'RES-01', provider: 'gemini', role: 'researcher', capabilities: ['research'] });
    registry.heartbeat('node-RES-01', { status: 'offline', batteryPct: 20, lastHeartbeatAt: new Date().toISOString() });
    expect(registry.getEmployee('RES-01')?.availability).toBe('offline');
    expect(registry.getNode('node-RES-01')?.batteryPct).toBe(20);
  });

  it('deduplicates task packets by idempotency key', () => {
    const queue = new TaskQueue();
    const first = task({ taskId: 'TASK-1', idempotencyKey: 'same-goal', objective: 'research A' });
    const second = task({ taskId: 'TASK-2', idempotencyKey: 'same-goal', objective: 'research A duplicate' });
    expect(queue.enqueue(first).task.taskId).toBe('TASK-1');
    expect(queue.enqueue(second).task.taskId).toBe('TASK-1');
    expect(queue.list()).toHaveLength(1);
  });

  it('runs two employees in parallel then routes independent reviewer and judge with provider diversity', async () => {
    const registry = new WorkforceRegistry();
    addNodeAndEmployee(registry, { employeeId: 'RES-01', provider: 'gemini', role: 'researcher', capabilities: ['research'], healthScore: 99 });
    addNodeAndEmployee(registry, { employeeId: 'RES-02', provider: 'openai', role: 'researcher', capabilities: ['research'], healthScore: 98 });
    addNodeAndEmployee(registry, { employeeId: 'REV-01', provider: 'anthropic', role: 'reviewer', capabilities: ['review'], healthScore: 97 });
    addNodeAndEmployee(registry, { employeeId: 'JDG-01', provider: 'ollama', role: 'judge', capabilities: ['judge'], healthScore: 96 });

    const queue = new TaskQueue();
    const scheduler = new CapabilityScheduler(registry);
    const orchestrator = new WorkforceOrchestrator(registry, queue, scheduler);
    const adapter = new SimAdapter();
    orchestrator.registerAdapter(adapter);

    const primary = [
      task({ taskId: 'RES-A', idempotencyKey: 'res-a', objective: 'research architecture A', requiredCapabilities: ['research'] }),
      task({ taskId: 'RES-B', idempotencyKey: 'res-b', objective: 'research architecture B', requiredCapabilities: ['research'] }),
    ];

    const outcome = await orchestrator.executeBatchWithAssurance(
      primary,
      () => task({
        taskId: 'REV-A',
        idempotencyKey: 'review-a',
        objective: 'independently review combined research',
        requiredCapabilities: ['review'],
        reviewPolicy: { independentReview: true, judgeRequired: true, preferProviderDiversity: true },
      }),
      () => task({
        taskId: 'JDG-A',
        idempotencyKey: 'judge-a',
        objective: 'judge evidence and review',
        requiredCapabilities: ['judge'],
        reviewPolicy: { independentReview: true, judgeRequired: false, preferProviderDiversity: true },
      }),
    );

    expect(adapter.maxActive).toBe(2);
    expect(new Set(outcome.primary.map((result) => result.employeeId))).toEqual(new Set(['RES-01', 'RES-02']));
    expect(outcome.review?.employeeId).toBe('REV-01');
    expect(outcome.judgment?.employeeId).toBe('JDG-01');
    expect(outcome.passed).toBe(true);
    expect(queue.list().filter((record) => record.stage === 'completed')).toHaveLength(4);
  });

  it('reassigns a retriable failure to another eligible employee within maxAttempts', async () => {
    const registry = new WorkforceRegistry();
    addNodeAndEmployee(registry, { employeeId: 'OPS-01', provider: 'gemini', role: 'operator', capabilities: ['ops'], healthScore: 100 });
    addNodeAndEmployee(registry, { employeeId: 'OPS-02', provider: 'openai', role: 'operator', capabilities: ['ops'], healthScore: 90 });
    const queue = new TaskQueue();
    const orchestrator = new WorkforceOrchestrator(registry, queue, new CapabilityScheduler(registry));
    let first = true;
    orchestrator.registerAdapter({
      kind: 'simulator',
      async execute(input, employee) {
        if (first) {
          first = false;
          return {
            taskId: input.taskId,
            employeeId: employee.employeeId,
            status: 'failed',
            conclusion: 'temporary failure',
            confidence: 0,
            artifacts: [],
            risks: ['temporary'],
            completedAt: new Date().toISOString(),
            failure: { code: 'TEMP', message: 'temporary', retriable: true },
          };
        }
        return {
          taskId: input.taskId,
          employeeId: employee.employeeId,
          status: 'completed',
          conclusion: 'recovered',
          confidence: 0.8,
          artifacts: [{ kind: 'log', ref: 'memory://recovered' }],
          risks: [],
          completedAt: new Date().toISOString(),
        };
      },
    });

    const result = await orchestrator.execute(task({
      taskId: 'OPS-TASK',
      idempotencyKey: 'ops-task',
      objective: 'operate safely',
      requiredCapabilities: ['ops'],
      maxAttempts: 2,
    }));

    expect(result.status).toBe('completed');
    expect(result.employeeId).toBe('OPS-02');
    expect(queue.get('OPS-TASK').attempts).toBe(2);
    expect(registry.getEmployee('OPS-01')?.failedTasks).toBe(1);
    expect(registry.getEmployee('OPS-02')?.completedTasks).toBe(1);
  });
});
