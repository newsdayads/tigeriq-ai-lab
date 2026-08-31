import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startWorkforceController } from '../apps/workforce-controller/src/server.js';
import { FileJournal } from '../packages/event-store/src/index.js';
import { CapabilityScheduler, TaskQueue, WorkforceRegistry, type TaskPacket, type WorkerResult } from '../packages/workforce/src/index.js';
import { DurableNodeCredentialStore } from '../packages/workforce/src/node-credentials.js';
import { NodePairingService, verifyAndroidP256PairingProof } from '../packages/workforce/src/pairing.js';
import { RemoteTaskBroker } from '../packages/workforce/src/remote-task-broker.js';
import { DurableWorkforceRuntime, MemoryWorkforceStateStore } from '../packages/workforce/src/runtime.js';
import { DurableTaskMailbox } from '../packages/workforce/src/task-mailbox.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()?.(); });

async function json(response: Response) { return await response.json() as any; }

function signChallenge(challenge: string) {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return {
    publicKey: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    proof: sign('sha256', Buffer.from(challenge, 'utf8'), privateKey).toString('base64url'),
  };
}

function safeTask(): TaskPacket {
  return {
    taskId: 'EMP001-SAFE-001',
    idempotencyKey: 'emp001-safe-001',
    objective: 'Return a bounded structured readiness result without external provider execution',
    department: 'Research',
    priority: 'P0',
    requiredCapabilities: ['research'],
    constraints: ['no secrets', 'no Gemini UI automation', 'simulator proof only'],
    inputs: [],
    expectedArtifacts: ['structured-result'],
    deadline: '2030-01-01T00:00:00.000Z',
    maxAttempts: 2,
    reviewPolicy: { independentReview: true, judgeRequired: false, preferProviderDiversity: true },
  };
}

describe('EMP-001 generic Controller protocol', () => {
  it('proves pairing -> enrollment -> heartbeat -> lease -> result over one issued device credential', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tigeriq-emp001-e2e-'));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));

    const registry = new WorkforceRegistry();
    const queue = new TaskQueue();
    const runtime = new DurableWorkforceRuntime(registry, queue, new CapabilityScheduler(registry), new MemoryWorkforceStateStore());
    const credentials = new DurableNodeCredentialStore(new FileJournal(join(dir, 'credentials.jsonl')));
    const mailbox = new DurableTaskMailbox(new FileJournal(join(dir, 'mailbox.jsonl')));
    const remoteTasks = new RemoteTaskBroker(runtime, mailbox);
    const controller = await startWorkforceController({
      runtime,
      credentials,
      pairing: new NodePairingService(verifyAndroidP256PairingProof),
      remoteTasks,
      adminSecret: 'test-admin-secret',
      host: '127.0.0.1',
      port: 0,
    });
    cleanups.push(controller.close);

    const challengeResponse = await fetch(`${controller.url}/api/admin/pairing-challenge`, {
      method: 'POST', headers: { 'x-tigeriq-admin-secret': 'test-admin-secret' },
    });
    expect(challengeResponse.status).toBe(201);
    const challenge = (await json(challengeResponse)).pairing;
    const signed = signChallenge(challenge.challenge);

    const pairResponse = await fetch(`${controller.url}/api/node/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        challengeId: challenge.challengeId,
        nodeId: 'PHONE-ZFLIP7-EMP001',
        publicKey: signed.publicKey,
        proof: signed.proof,
        kind: 'android',
        platform: 'Android / Z Flip 7 simulator contract',
        agentVersion: 'wo039-e2e',
        capabilities: ['android-ui', 'research', 'gemini'],
      }),
    });
    expect(pairResponse.status).toBe(201);
    const paired = await json(pairResponse);
    expect(paired.credential.scopes).toEqual(expect.arrayContaining(['register', 'heartbeat', 'task:read', 'task:result']));

    const nodeHeaders = {
      'content-type': 'application/json',
      'x-tigeriq-credential-id': paired.credential.credentialId,
      authorization: `Bearer ${paired.credential.token}`,
    };

    const enrollResponse = await fetch(`${controller.url}/api/node/employee`, {
      method: 'POST', headers: nodeHeaders,
      body: JSON.stringify({
        employeeId: 'EMP-001',
        displayName: 'EMP-001 · Researcher',
        department: 'Research',
        role: 'Researcher',
        provider: 'Gemini',
        capabilities: ['research', 'gemini'],
      }),
    });
    expect(enrollResponse.status).toBe(201);

    const heartbeatResponse = await fetch(`${controller.url}/api/node/heartbeat`, {
      method: 'POST', headers: nodeHeaders,
      body: JSON.stringify({ status: 'online', batteryPct: 80, agentVersion: 'wo039-e2e' }),
    });
    expect(heartbeatResponse.status).toBe(200);

    const enqueueResponse = await fetch(`${controller.url}/api/admin/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-tigeriq-admin-secret': 'test-admin-secret' },
      body: JSON.stringify({ task: safeTask() }),
    });
    expect(enqueueResponse.status).toBe(201);

    const leaseResponse = await fetch(`${controller.url}/api/node/tasks/lease`, { method: 'POST', headers: nodeHeaders });
    expect(leaseResponse.status).toBe(200);
    const lease = (await json(leaseResponse)).lease;
    expect(lease.taskId).toBe('EMP001-SAFE-001');
    expect(lease.employeeId).toBe('EMP-001');

    const result: WorkerResult = {
      taskId: lease.taskId,
      employeeId: lease.employeeId,
      status: 'completed',
      conclusion: 'Generic controller protocol simulator proof completed; no Gemini execution claimed.',
      confidence: 1,
      artifacts: [{ kind: 'json', ref: 'evidence://emp001-controller-protocol-simulator' }],
      risks: ['real PC01 listener, stable-signed install and live device execution remain physical gates'],
      completedAt: new Date().toISOString(),
    };
    const resultResponse = await fetch(`${controller.url}/api/node/tasks/result`, {
      method: 'POST', headers: nodeHeaders,
      body: JSON.stringify({ taskId: lease.taskId, leaseId: lease.leaseId, leaseToken: lease.leaseToken, result }),
    });
    expect(resultResponse.status).toBe(200);
    expect(queue.get('EMP001-SAFE-001').stage).toBe('completed');

    const statusResponse = await fetch(`${controller.url}/api/workforce/status`);
    expect(statusResponse.status).toBe(200);
    const status = await json(statusResponse);
    expect(status.workforce.nodes.total).toBe(1);
    expect(status.workforce.employees.total).toBe(1);
    expect(status.workforce.tasks.completed).toBe(1);
  });
});
