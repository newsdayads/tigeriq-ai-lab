import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startWorkforceController } from '../apps/workforce-controller/src/server.js';
import { FileJournal } from '../packages/event-store/src/index.js';
import { CapabilityScheduler, TaskQueue, WorkforceRegistry, type TaskPacket, type WorkerResult } from '../packages/workforce/src/index.js';
import { DurableAutonomyStore } from '../packages/workforce/src/autonomy-store.js';
import { DurableNodeCredentialStore } from '../packages/workforce/src/node-credentials.js';
import { NodePairingService } from '../packages/workforce/src/pairing.js';
import { RemoteTaskBroker } from '../packages/workforce/src/remote-task-broker.js';
import { DurableWorkforceRuntime, MemoryWorkforceStateStore } from '../packages/workforce/src/runtime.js';
import { DurableTaskMailbox } from '../packages/workforce/src/task-mailbox.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()?.(); });

function task(taskId = 'REMOTE-01', autonomy = false): TaskPacket {
  const constraints = ['no secrets'];
  if (autonomy) constraints.push('autonomy:level=B', 'autonomy:resource=pc01-watchdog', 'autonomy:authorized=true');
  return {
    taskId, idempotencyKey: `remote-${taskId.toLowerCase()}`, objective: 'Execute one bounded Android task',
    department: 'ops', priority: 'P0', requiredCapabilities: ['android-ui'], constraints,
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
  const journal = new FileJournal(join(dir, 'remote.jsonl'));
  const mailbox = new DurableTaskMailbox(journal);
  const autonomy = new DurableAutonomyStore(journal);
  const remoteTasks = new RemoteTaskBroker(runtime, mailbox, () => new Date(), autonomy);
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
  return { ...controller, queue, autonomy };
}

async function json(response: Response) { return await response.json() as any; }
function nodeHeaders(token = 'node-secret') {
  return { 'content-type': 'application/json', 'x-tigeriq-credential-id': 'CRED-01', authorization: `Bearer ${token}` };
}
function adminHeaders(secret = 'admin-secret') {
  return { 'content-type': 'application/json', 'x-tigeriq-admin-secret': secret };
}

function failedResult(taskId: string, employeeId: string): WorkerResult {
  return {
    taskId, employeeId, status: 'failed', conclusion: 'dependency unavailable', confidence: 1,
    artifacts: [{ kind: 'json', ref: 'evidence://blocked' }], risks: ['dependency-wait'], completedAt: new Date().toISOString(),
    failure: { code: 'CAPABILITY_GAP', message: 'waiting for verified capability', retriable: false },
  };
}

describe('Workforce Controller remote task API', () => {
  it('enqueues through admin auth, leases only through task:read and accepts idempotent task:result', async () => {
    const app = await fixture();

    const unauthorizedAdmin = await fetch(`${app.url}/api/admin/tasks`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task: task() }) });
    expect(unauthorizedAdmin.status).toBe(401);

    const enqueue = await fetch(`${app.url}/api/admin/tasks`, {
      method: 'POST', headers: adminHeaders(), body: JSON.stringify({ task: task() }),
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

  it('accepts an explicit blocked result and persists waiting_condition without claiming completion', async () => {
    const app = await fixture();
    const enqueue = await fetch(`${app.url}/api/admin/tasks`, {
      method: 'POST', headers: adminHeaders(), body: JSON.stringify({ task: task('BLOCKED-HTTP', true) }),
    });
    expect(enqueue.status).toBe(201);

    const leaseResponse = await fetch(`${app.url}/api/node/tasks/lease`, { method: 'POST', headers: nodeHeaders() });
    const lease = (await json(leaseResponse)).lease;
    const envelope = {
      taskId: lease.taskId,
      leaseId: lease.leaseId,
      leaseToken: lease.leaseToken,
      result: failedResult(lease.taskId, lease.employeeId),
      blocked: { blocker: 'capability_gap', dependencyKey: 'pc01.task-action-ready', mutationInFlight: false },
    };
    const accepted = await fetch(`${app.url}/api/node/tasks/result`, { method: 'POST', headers: nodeHeaders(), body: JSON.stringify(envelope) });
    expect(accepted.status).toBe(200);
    const payload = await json(accepted);
    expect(payload.result.status).toBe('failed');
    expect(payload.blocked.state).toBe('waiting_condition');
    expect(payload.blocked.dependencyWatch).toBe(true);
    expect(app.queue.get('BLOCKED-HTTP').stage).toBe('failed');
    expect((await app.autonomy.get('BLOCKED-HTTP'))?.dependencyKey).toBe('pc01.task-action-ready');
  });

  it('requires admin authority to reopen a dependency and requeues only the matching bounded task', async () => {
    const app = await fixture();
    await fetch(`${app.url}/api/admin/tasks`, {
      method: 'POST', headers: adminHeaders(), body: JSON.stringify({ task: task('WAIT-HTTP', true) }),
    });
    const leaseResponse = await fetch(`${app.url}/api/node/tasks/lease`, { method: 'POST', headers: nodeHeaders() });
    const lease = (await json(leaseResponse)).lease;
    await fetch(`${app.url}/api/node/tasks/result`, {
      method: 'POST', headers: nodeHeaders(), body: JSON.stringify({
        taskId: lease.taskId, leaseId: lease.leaseId, leaseToken: lease.leaseToken,
        result: failedResult(lease.taskId, lease.employeeId),
        blocked: { blocker: 'external_dependency', dependencyKey: 'dependency-http', mutationInFlight: false },
      }),
    });

    const denied = await fetch(`${app.url}/api/admin/tasks/dependency-ready`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dependencyKey: 'dependency-http' }),
    });
    expect(denied.status).toBe(401);
    expect(app.queue.get('WAIT-HTTP').stage).toBe('failed');

    const unrelated = await fetch(`${app.url}/api/admin/tasks/dependency-ready`, {
      method: 'POST', headers: adminHeaders(), body: JSON.stringify({ dependencyKey: 'other' }),
    });
    expect((await json(unrelated)).resumed).toEqual([]);

    const reopened = await fetch(`${app.url}/api/admin/tasks/dependency-ready`, {
      method: 'POST', headers: adminHeaders(), body: JSON.stringify({ dependencyKey: 'dependency-http' }),
    });
    expect(reopened.status).toBe(200);
    expect((await json(reopened)).resumed).toEqual(['WAIT-HTTP']);
    expect(app.queue.get('WAIT-HTTP').stage).toBe('queued');

    const retry = await fetch(`${app.url}/api/node/tasks/lease`, { method: 'POST', headers: nodeHeaders() });
    expect((await json(retry)).lease.attempt).toBe(2);
  });

  it('rejects malformed task contracts instead of enqueueing ambiguous work', async () => {
    const app = await fixture();
    const invalid = await fetch(`${app.url}/api/admin/tasks`, {
      method: 'POST', headers: adminHeaders(),
      body: JSON.stringify({ task: { taskId: 'BAD', priority: 'P9' } }),
    });
    expect(invalid.status).toBe(400);
    expect(app.queue.list()).toHaveLength(0);
  });
});
