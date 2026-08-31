import { describe, expect, it } from 'vitest';
import { WorkforceRegistry } from '../packages/workforce/src/index.js';
import {
  AutonomousWorkManager,
  WorkforceRegistryBridge,
  WorkManagementStore,
  type PlannedWorkItem,
  type WorkDriver,
} from '../packages/work-management/src/index.js';

const at = '2026-08-31T05:00:00.000Z';

function workItem(): PlannedWorkItem {
  return {
    workId: 'W-PC01',
    title: 'Run bounded PC01 work',
    objective: 'Execute on PC01 and independently verify with AI workers',
    dependencies: [],
    scopeKeys: ['packages/work-management'],
    requiredCapabilities: ['work-management'],
    expectedEvidence: ['commit'],
    maxAttempts: 2,
    independentReview: true,
    judgeRequired: true,
  };
}

function registerNodeAndEmployee(
  registry: WorkforceRegistry,
  input: {
    nodeId: string;
    kind: 'local' | 'api';
    employeeId: string;
    activeTaskCount?: number;
    concurrencyLimit?: number;
  },
): void {
  registry.registerNode({
    nodeId: input.nodeId,
    kind: input.kind,
    platform: input.kind === 'local' ? 'windows' : 'cloud',
    agentVersion: 'test',
    capabilities: ['work-management'],
    status: 'online',
    lastHeartbeatAt: at,
  });
  registry.registerEmployee({
    employeeId: input.employeeId,
    displayName: input.employeeId,
    department: 'Engineering',
    role: 'test',
    nodeId: input.nodeId,
    capabilities: ['work-management'],
    availability: 'idle',
    healthScore: 100,
    concurrencyLimit: input.concurrencyLimit ?? 1,
    activeTaskCount: input.activeTaskCount ?? 0,
  });
}

describe('WO-044 Workforce Registry bridge', () => {
  it('routes execution to available PC01 and keeps reviewer/judge independent AI identities', async () => {
    const registry = new WorkforceRegistry();
    registerNodeAndEmployee(registry, {
      nodeId: 'NODE-PC01-BUSY',
      kind: 'local',
      employeeId: 'EMP-PC01-BUSY',
      activeTaskCount: 1,
      concurrencyLimit: 1,
    });
    registerNodeAndEmployee(registry, { nodeId: 'NODE-PC01', kind: 'local', employeeId: 'EMP-PC01' });
    registerNodeAndEmployee(registry, { nodeId: 'NODE-REV', kind: 'api', employeeId: 'EMP-REV' });
    registerNodeAndEmployee(registry, { nodeId: 'NODE-JUDGE', kind: 'api', employeeId: 'EMP-JUDGE' });

    const manager = new AutonomousWorkManager(new WorkManagementStore(), 60_000);
    const seen: string[] = [];
    const bridge = new WorkforceRegistryBridge(registry, manager, {
      rolesForEmployee: (employee) => {
        if (employee.employeeId.startsWith('EMP-PC01')) return ['executor'];
        if (employee.employeeId === 'EMP-REV') return ['reviewer'];
        if (employee.employeeId === 'EMP-JUDGE') return ['judge'];
        return [];
      },
      driverForEmployee: (employee): WorkDriver => {
        if (employee.employeeId.startsWith('EMP-PC01')) {
          return {
            execute: async ({ worker }) => {
              seen.push(`execute:${worker.workerId}`);
              return {
                status: 'completed',
                conclusion: 'PC01 completed bounded work',
                evidence: [{ kind: 'commit', ref: 'pc01-proof' }],
              };
            },
          };
        }
        if (employee.employeeId === 'EMP-REV') {
          return {
            review: async ({ worker }) => {
              seen.push(`review:${worker.workerId}`);
              return {
                verdict: 'pass',
                conclusion: 'Independent review passed',
                evidence: [{ kind: 'text', ref: 'review-proof' }],
              };
            },
          };
        }
        return {
          judge: async ({ worker }) => {
            seen.push(`judge:${worker.workerId}`);
            return {
              verdict: 'pass',
              conclusion: 'Independent judge passed',
              evidence: [{ kind: 'text', ref: 'judge-proof' }],
            };
          },
        };
      },
    });

    expect(bridge.sync()).toEqual(['EMP-PC01-BUSY', 'EMP-PC01', 'EMP-REV', 'EMP-JUDGE']);
    await manager.submitGoal(
      {
        goalId: 'G-WORKFORCE',
        idempotencyKey: 'goal-workforce',
        objective: 'Route work using authoritative workforce state',
        priority: 'P0',
        constraints: ['no duplicate execution'],
        maxParallelism: 1,
        createdAt: at,
      },
      { decompose: async () => [workItem()] },
      at,
    );

    const result = await manager.runUntilQuiescent('G-WORKFORCE', {
      maxCycles: 5,
      now: () => '2026-08-31T05:00:10.000Z',
    });

    expect(result.goal.status).toBe('completed');
    expect(result.goal.work[0].executorIds).toEqual(['EMP-PC01']);
    expect(result.goal.work[0].reviewerIds).toEqual(['EMP-REV']);
    expect(result.goal.work[0].judgeIds).toEqual(['EMP-JUDGE']);
    expect(seen).toEqual(['execute:EMP-PC01', 'review:EMP-REV', 'judge:EMP-JUDGE']);
  });
});
