import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startWorkforceController } from '../apps/workforce-controller/src/server.js';
import { FileJournal } from '../packages/event-store/src/index.js';
import { CapabilityScheduler, TaskQueue, WorkforceRegistry, type TaskPacket, type WorkerResult } from '../packages/workforce/src/index.js';
import { DurableNodeCredentialStore } from '../packages/workforce/src/node-credentials.js';
import { NodePairingService } from '../packages/workforce/src/pairing.js';
import { RemoteTaskBroker } from '../packages/workforce/src/remote-task-broker.js';
import { DurableWorkforceRuntime, MemoryWorkforceStateStore } from '../packages/workforce/src/runtime.js';
import { DurableTaskMailbox } from '../packages/workforce/src/task-mailbox.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()?.(); });

function task(): TaskPacket {
  return {
    taskId: 'REMOTE-01', idempotencyKey: 'remote-01', objective: 'Execute one bounded Android task',
    department: 'ops', priority: 'P0', requiredCapabilities: ['android-ui'], constraints: ['no secrets'],
    inputs: [], expectedArtifacts: ['structured-result'], deadline: '2030-01-01T00:00:00.000Z', maxAttempts: 2,
    reviewPolicy: { independentReview: true, judgeRequired: false, preferProviderDiversity: true },
  };
}

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'tigeriq-controller-remote-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const registry = new WorkforceRegistry();
  registry.registerNode({ nodeId: 'PHONE-01', kind: 'android', platform: 'Android test', agentVersion: '0.1.0', capabilities: ['android-ui'], status: 'online', lastHeartbeatAt: new Date().toISOString() });
  registry.registerEmployee({ employeeId: 'OPS-01', displayName: 'Operator 01', department: 'ops', role: 'operator', nodeId: 'PHONE-01', capabilities: ['android-ui'], availability: 'idle', healthScore: 100, concurrencyLimit: 1 });
  const queue = new TaskQueue();
  const runtime = new DurableWorkforceRuntime(registry, queue, new CapabilityScheduler(registry), new MemoryWorkforceStateStore());
  const credentials = new DurableNodeCredentialStore(new FileJournal(join(dir, 'credentials.jsonl')));
  await credentials.issue({
    credentialId: 'CRED-01', nodeId: 'PHONE-01', token: 'node-secret',
    scopes: ['register', 'heartbeat', 'task:read', 'task:result'], createdAt: new Date().toISOString(),
  }, Buffer.from('test-public-key').toString('base64'));
  const mailbox = new DurableTaskMailbox(new FileJournal(join(dir, 'mailbox.jsonl')));
  const remoteTasks = new RemoteTaskBroker(runtime, mailbox);
  const controller = await startWorkforceController({
    runtime,
    credentials,
    pairing: new NodePairingService(() => true),
    remoteTasks,
    adminSecret: 'admin-secret',
    host: '127.0.0.1',
    port: 0,
  });
  cleanups.push(controller.close);
  return { ...controller, queue };
}

async function json(response: Response) { return await response.json() as any; }
function nodeHeaders(token = 'node-secret') {
  return { 'content-type': 'application/json', 'x-tigeriq-credential-id': 'CRED-01', authorization: `Bearer ${token}` };
}

describe('Workforce Controller remote task API', () => {
  it('enqueues through admin auth, leases only through task:read and accepts idempotent task:result', async () => {
    const app = await fixture();

    const unauthorizedAdmin = await fetch(`${app.url}/api/admin/tasks`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task: task() }) });
    expect(unauthorizedAdmin.status).toBe(401);

    const enqueue = await fetch(`${app.url}/api/admin/tasks`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-tigeriq-admin-secret': 'admin-secret' },
      body: JSON.stringify({ task: task() }),
    });
    expect(enqueue.status).toBe(201);
    expect((await json(enqueue)).task.stage).toBe('queued');

    const deniedLease = await fetch(`${app.url}/api/node/tasks/lease`, { method: 'POST', headers: nodeHeaders('wrong') });
    expect(deniedLease.status).toBe(401);

    const leaseResponse = await fetch(`${app.url}/api/node/tasks/lease`, { method: 'POST', headers: nodeHeaders() });
    expect(leaseResponse.status).toBe(200);
    const lease = (await json(leaseResponse)).lease;
    expect(lease.taskId).toBe('REMOTE-01');
    expect(lease.employeeId).toBe('OPS-01');
    expect(lease.leaseToken).toBeTruthy();
    expect(app.queue.get('REMOTE-01').stage).toBe('running');

    const result: WorkerResult = {
      taskId: lease.taskId, employeeId: lease.employeeId, status: 'completed', conclusion: 'remote done', confidence: 0.9,
      artifacts: [{ kind: 'json', ref: 'evidence://remote-01' }], risks: [], completedAt: new Date().toISOString(),
    };
    const envelope = { taskId: lease.taskId, leaseId: lease.leaseId, leaseToken: lease.leaseToken, result };
    const accepted = await fetch(`${app.url}/api/node/tasks/result`, { method: 'POST', headers: nodeHeaders(), body: JSON.stringify(envelope) });
    expect(accepted.status).toBe(200);
    expect((await json(accepted)).result.conclusion).toBe('remote done');
    expect(app.queue.get('REMOTE-01').stage).toBe('completed');

    const duplicate = await fetch(`${app.url}/api/node/tasks/result`, { method: 'POST', headers: nodeHeaders(), body: JSON.stringify(envelope) });
    expect(duplicate.status).toBe(200);
    expect((await json(duplicate)).result.conclusion).toBe('remote done');
  });

  it('rejects malformed task contracts instead of enqueueing ambiguous work', async () => {
    const app = await fixture();
    const invalid = await fetch(`${app.url}/api/admin/tasks`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-tigeriq-admin-secret': 'admin-secret' },
      body: JSON.stringify({ task: { taskId: 'BAD', priority: 'P9' } }),
    });
    expect(invalid.status).toBe(400);
    expect(app.queue.list()).toHaveLength(0);
  });
});
