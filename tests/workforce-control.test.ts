import { describe, expect, it } from 'vitest';
import { CapabilityScheduler, TaskQueue, WorkforceRegistry, type TaskPacket } from '../packages/workforce/src/index.js';
import { DurableWorkforceRuntime } from '../packages/workforce/src/runtime.js';
import { buildWorkforceStatus } from '../packages/workforce/src/status.js';
import { NodePairingService } from '../packages/workforce/src/pairing.js';

function inputTask(): TaskPacket {
  return {
    taskId: 'STATUS-1',
    idempotencyKey: 'status-1',
    objective: 'status test',
    priority: 'P1',
    requiredCapabilities: ['research'],
    constraints: [],
    inputs: [],
    expectedArtifacts: ['result'],
    deadline: new Date(Date.now() + 60_000).toISOString(),
    maxAttempts: 1,
    reviewPolicy: { independentReview: false, judgeRequired: false, preferProviderDiversity: false },
  };
}

function addEmployee(registry: WorkforceRegistry): void {
  registry.registerNode({
    nodeId: 'node-1',
    kind: 'simulator',
    platform: 'test',
    agentVersion: '1.0.0',
    capabilities: ['research'],
    status: 'online',
    lastHeartbeatAt: new Date().toISOString(),
  });
  registry.registerEmployee({
    employeeId: 'RES-01',
    displayName: 'Researcher 01',
    department: 'research',
    role: 'researcher',
    nodeId: 'node-1',
    provider: 'gemini',
    capabilities: ['research'],
    availability: 'idle',
    healthScore: 95,
    concurrencyLimit: 2,
  });
}

describe('workforce operational controls', () => {
  it('projects a sanitized workforce status snapshot with utilization and task lifecycle counts', async () => {
    const registry = new WorkforceRegistry();
    addEmployee(registry);
    const queue = new TaskQueue();
    const runtime = new DurableWorkforceRuntime(registry, queue, new CapabilityScheduler(registry));
    runtime.registerAdapter({
      kind: 'simulator',
      async execute(task, employee) {
        return {
          taskId: task.taskId,
          employeeId: employee.employeeId,
          status: 'completed',
          conclusion: 'done',
          confidence: 1,
          artifacts: [{ kind: 'json', ref: 'memory://result' }],
          risks: [],
          completedAt: new Date().toISOString(),
        };
      },
    });

    await runtime.execute(inputTask());
    const status = buildWorkforceStatus(registry, queue, () => new Date('2026-08-30T17:00:00.000Z'));

    expect(status.generatedAt).toBe('2026-08-30T17:00:00.000Z');
    expect(status.nodes.total).toBe(1);
    expect(status.nodes.byStatus.online).toBe(1);
    expect(status.employees.total).toBe(1);
    expect(status.employees.departments.research).toBe(1);
    expect(status.employees.providers.gemini).toBe(1);
    expect(status.employees.concurrencyCapacity).toBe(2);
    expect(status.employees.utilization).toBe(0);
    expect(status.tasks.byStage.completed).toBe(1);
    expect(status.tasks.terminal).toBe(1);
  });

  it('pairs a node with a one-time challenge, stores only a token hash, enforces scopes and supports revocation', async () => {
    let expectedChallenge = '';
    const pairing = new NodePairingService(({ publicKey, challenge, proof }) => {
      expectedChallenge = challenge;
      return publicKey === 'device-public-key' && proof === `signed:${challenge}`;
    }, () => new Date('2026-08-30T17:00:00.000Z'));

    const challenge = pairing.issueChallenge();
    const credential = await pairing.pair({
      challengeId: challenge.challengeId,
      nodeId: 'PHONE-01',
      publicKey: 'device-public-key',
      proof: `signed:${challenge.challenge}`,
    });

    expect(expectedChallenge).toBe(challenge.challenge);
    expect(credential.nodeId).toBe('PHONE-01');
    expect(credential.token.length).toBeGreaterThan(20);
    expect(pairing.authenticate(credential.credentialId, credential.token, 'heartbeat')).toBe(true);
    expect(pairing.authenticate(credential.credentialId, 'wrong-token', 'heartbeat')).toBe(false);
    expect(pairing.credentialMetadata(credential.credentialId)).not.toHaveProperty('tokenHash');
    await expect(pairing.pair({
      challengeId: challenge.challengeId,
      nodeId: 'PHONE-02',
      publicKey: 'device-public-key',
      proof: `signed:${challenge.challenge}`,
    })).rejects.toThrow('pairing challenge already used');
    expect(pairing.revoke(credential.credentialId)).toBe(true);
    expect(pairing.authenticate(credential.credentialId, credential.token, 'heartbeat')).toBe(false);
  });

  it('rejects expired pairing challenges', async () => {
    let now = new Date('2026-08-30T17:00:00.000Z');
    const pairing = new NodePairingService(() => true, () => now, 30_000);
    const challenge = pairing.issueChallenge();
    now = new Date('2026-08-30T17:00:31.000Z');
    await expect(pairing.pair({
      challengeId: challenge.challengeId,
      nodeId: 'PHONE-01',
      publicKey: 'pk',
      proof: 'proof',
    })).rejects.toThrow('pairing challenge expired');
  });
});
