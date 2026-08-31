import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileJournal } from '../packages/event-store/src/index.js';
import {
  AndroidV07Registry,
  DurableAndroidJobQueue,
  type AndroidJob,
  type AndroidJobResult,
} from '../packages/workforce/src/android-v07/index.js';
import { startInferenceGatewayServer } from '../apps/inference-gateway/src/server.js';
import {
  BackendRequestError,
  DeviceSessionService,
  InferenceGateway,
  type BackendAdapter,
  type BackendTarget,
  type GatewayProvider,
} from '../packages/inference-gateway/src/index.js';

const dirs: string[] = [];
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (closers.length) await closers.pop()?.();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const targets: BackendTarget[] = [
  { provider: 'gemini', model: 'gemini-gate130', tier: 'primary', costRank: 0, qualityRank: 4, kinds: ['general', 'coding', 'analysis', 'research'] },
  { provider: 'groq', model: 'groq-gate130', tier: 'primary', costRank: 0, qualityRank: 4, kinds: ['general', 'coding', 'analysis', 'research'] },
  { provider: 'openrouter', model: 'openrouter-gate130', tier: 'fallback', costRank: 1, qualityRank: 4, kinds: ['general', 'coding', 'analysis', 'research'] },
];

function adapter(provider: GatewayProvider, execute: BackendAdapter['execute']): BackendAdapter {
  return { provider, execute };
}

async function workforceHarness() {
  const dir = await mkdtemp(join(tmpdir(), 'tigeriq-gate130-'));
  dirs.push(dir);
  let nowMs = Date.parse('2026-08-31T08:00:00.000Z');
  const now = () => new Date(nowMs);
  const journalPath = join(dir, 'journal.jsonl');
  const journal = new FileJournal(journalPath);
  const registry = new AndroidV07Registry(journal, now);
  const queue = new DurableAndroidJobQueue(journal, registry, now, 15_000);
  return { dir, journalPath, journal, registry, queue, now, advance: (ms: number) => { nowMs += ms; } };
}

async function enroll(registry: AndroidV07Registry, employeeId: string, deviceId: string) {
  if (!(await registry.employee(employeeId))) {
    await registry.createEmployee({
      employeeId,
      displayName: employeeId,
      roles: ['android-operator'],
      permissions: ['job:pull', 'job:submit', 'evidence:write'],
    });
  }
  const grant = await registry.requestEnrollment({ employeeId, deviceId, publicKeyFingerprint: 'a'.repeat(64) });
  const binding = await registry.activateEnrollment(grant.enrollmentId, grant.activationToken);
  return binding;
}

function job(employeeId: string, jobId: string, createdAt: string): AndroidJob {
  return {
    jobId,
    idempotencyKey: `${employeeId}:${jobId}`,
    employeeId,
    objective: `Gate #130 ${jobId}`,
    requiredPermissions: ['job:pull', 'job:submit'],
    payload: { kind: 'general', prompt: `execute ${jobId}` },
    expectedEvidence: ['json'],
    maxAttempts: 2,
    createdAt,
  };
}

async function mintSession(baseUrl: string, employeeId: string, deviceId: string) {
  const response = await fetch(`${baseUrl}/v1/inference/sessions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer bootstrap:${employeeId}:${deviceId}`,
      'x-tigeriq-credential-id': `CRED-${deviceId}`,
    },
    body: JSON.stringify({
      employeeId,
      nodeId: `NODE-${deviceId}`,
      deviceId,
      requestedScopes: ['inference:invoke'],
      client: { name: 'gate130-mock-device', version: '0.7' },
    }),
  });
  expect(response.status).toBe(201);
  return await response.json() as { session: { accessToken: string } };
}

async function infer(baseUrl: string, token: string, employeeId: string, idempotencyKey: string, requestId: string, requiredDistinctFrom: string[] = []) {
  return fetch(`${baseUrl}/v1/inference`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      'idempotency-key': idempotencyKey,
    },
    body: JSON.stringify({
      requestId,
      employeeId,
      workId: 'GATE-130',
      role: requiredDistinctFrom.length ? 'reviewer' : 'executor',
      task: { kind: 'general', risk: 'low', prompt: `Gate #130 ${requestId}` },
      routing: { requiredDistinctFrom, maxAttempts: 3 },
      budgetClass: 'free-first',
    }),
  });
}

describe('Gate #130 cross-stream Android v0.7 contract integration', () => {
  it('proves Job -> Employee/Device lease -> Gateway session/inference -> Result/Evidence -> durable completion with 429 fallback, idempotency and redaction', async () => {
    const h = await workforceHarness();
    const employeeId = 'EMP-001';
    const deviceId = 'DEV-001';
    const binding = await enroll(h.registry, employeeId, deviceId);
    await h.queue.enqueue(job(employeeId, 'JOB-130-A', h.now().toISOString()));
    const lease = await h.queue.pull(employeeId, deviceId);
    expect(lease).toBeDefined();

    const providerSecret = 'GEMINI_GATE130_SERVER_ONLY_SECRET';
    let geminiCalls = 0;
    let groqCalls = 0;
    const gateway = new InferenceGateway([
      adapter('gemini', async () => { geminiCalls += 1; throw new BackendRequestError('gemini', 'quota', providerSecret, 5_000); }),
      adapter('groq', async () => { groqCalls += 1; return 'gate130 integrated result'; }),
      adapter('openrouter', async () => 'fallback'),
    ], { targets, cooldownMs: 1_000 });
    const sessions = new DeviceSessionService('GATE130_SESSION_SECRET_012345678901234567890123', {
      async authenticate(input) {
        await h.registry.authorize(input.employeeId, input.deviceId ?? '', 'job:pull');
        if (input.credentialId !== `CRED-${input.deviceId}` || input.bearerToken !== `bootstrap:${input.employeeId}:${input.deviceId}`) return undefined;
        return { employeeId: input.employeeId, nodeId: input.nodeId, deviceId: input.deviceId, scopes: ['inference:invoke'] };
      },
    });
    const server = await startInferenceGatewayServer({ gateway, sessions });
    closers.push(server.close);
    const session = await mintSession(server.baseUrl, employeeId, deviceId);

    const first = await infer(server.baseUrl, session.session.accessToken, employeeId, 'IDEMP-G130-A', 'REQ-G130-A');
    expect(first.status).toBe(200);
    const firstBody = await first.json() as any;
    expect(firstBody.evidence.selectedBackendIdentity).toBe('groq/groq-gate130');
    expect(firstBody.evidence.attempts).toEqual([
      { sequence: 1, backendIdentity: 'gemini/gemini-gate130', outcome: 'failure', failureKind: 'quota' },
      { sequence: 2, backendIdentity: 'groq/groq-gate130', outcome: 'success', failureKind: null },
    ]);
    expect(JSON.stringify(firstBody)).not.toContain(providerSecret);

    const replay = await infer(server.baseUrl, session.session.accessToken, employeeId, 'IDEMP-G130-A', 'REQ-G130-A');
    expect(replay.status).toBe(200);
    expect(geminiCalls).toBe(1);
    expect(groqCalls).toBe(1);

    const conflict = await infer(server.baseUrl, session.session.accessToken, employeeId, 'IDEMP-G130-A', 'REQ-G130-CONFLICT');
    expect(conflict.status).toBe(400);
    expect(geminiCalls).toBe(1);
    expect(groqCalls).toBe(1);

    if (!lease) throw new Error('lease required');
    const result: AndroidJobResult = {
      jobId: lease.jobId,
      employeeId,
      deviceId,
      bindingId: binding.bindingId,
      status: 'completed',
      output: {
        text: firstBody.result.text,
        backend: firstBody.evidence.selectedBackendIdentity,
        attempts: firstBody.evidence.attempts,
      },
      evidence: [{ kind: 'json', ref: `memory://${employeeId}/${lease.jobId}/gateway-result.json`, sha256: firstBody.evidence.outputSha256 }],
      completedAt: h.now().toISOString(),
    };
    await h.queue.submit(employeeId, deviceId, lease.leaseId, lease.leaseToken, result);
    expect((await h.queue.get(employeeId, lease.jobId)).stage).toBe('completed');
    const duplicate = await h.queue.submit(employeeId, deviceId, lease.leaseId, lease.leaseToken, result);
    expect(duplicate).toEqual(result);
    await expect(h.queue.submit(employeeId, deviceId, lease.leaseId, lease.leaseToken, { ...result, output: { conflict: true } })).rejects.toThrow('duplicate result conflict');

    const journalText = await readFile(h.journalPath, 'utf8');
    expect(journalText).not.toContain(providerSecret);
    expect(journalText).not.toContain('bootstrap:');
  });

  it('proves outage fallback and independent reviewer metadata remains non-secret', async () => {
    const h = await workforceHarness();
    await enroll(h.registry, 'EMP-010', 'DEV-010');
    const secret = 'OPENROUTER_SECRET_MUST_NOT_APPEAR';
    const gateway = new InferenceGateway([
      adapter('gemini', async () => { throw new BackendRequestError('gemini', 'outage', 'down'); }),
      adapter('groq', async () => 'executor result'),
      adapter('openrouter', async () => `PASS reviewer result`),
    ], { targets });
    const executor = await gateway.infer({
      requestId: 'REQ-EXEC', employeeId: 'EMP-010', workId: 'GATE-130', role: 'executor',
      task: { kind: 'general', risk: 'low', prompt: 'execute' },
      routing: { requiredDistinctFrom: [], maxAttempts: 3 }, budgetClass: 'free-first',
    });
    expect(executor.selectedBackendIdentity).toBe('groq/groq-gate130');
    const reviewer = await gateway.infer({
      requestId: 'REQ-REVIEW', employeeId: 'EMP-010', workId: 'GATE-130', role: 'reviewer',
      task: { kind: 'general', risk: 'low', prompt: 'review' },
      routing: { requiredDistinctFrom: [executor.selectedBackendIdentity], maxAttempts: 3 }, budgetClass: 'free-first',
    });
    expect(reviewer.selectedBackendIdentity).toBe('openrouter/openrouter-gate130');
    expect(reviewer.decision).toBe('PASS');
    const exported = JSON.stringify({ executor: executor.selectedBackendIdentity, reviewer: reviewer.selectedBackendIdentity, attempts: reviewer.attempts });
    expect(exported).not.toContain(secret);
    expect(exported).not.toMatch(/api[_-]?key|bearer|credential/i);
  });

  it('proves restart/recovery, namespace isolation and stale lost/replaced authorization fail closed', async () => {
    const h = await workforceHarness();
    await enroll(h.registry, 'EMP-020', 'DEV-020');
    await enroll(h.registry, 'EMP-021', 'DEV-021');
    await h.queue.enqueue(job('EMP-020', 'JOB-130-R', h.now().toISOString()));
    const lease = await h.queue.pull('EMP-020', 'DEV-020');
    expect(lease?.jobId).toBe('JOB-130-R');
    await expect(h.queue.pull('EMP-020', 'DEV-021')).rejects.toThrow();
    await expect(h.queue.get('EMP-021', 'JOB-130-R')).rejects.toThrow();

    h.advance(16_000);
    const restartedJournal = new FileJournal(h.journalPath);
    const restartedRegistry = new AndroidV07Registry(restartedJournal, h.now);
    const restartedQueue = new DurableAndroidJobQueue(restartedJournal, restartedRegistry, h.now, 15_000);
    expect(await restartedQueue.recoverExpired('EMP-020')).toBe(1);
    expect((await restartedQueue.get('EMP-020', 'JOB-130-R')).stage).toBe('queued');

    await restartedRegistry.markDeviceLost('DEV-020');
    await expect(restartedQueue.pull('EMP-020', 'DEV-020')).rejects.toThrow();
    if (lease) {
      const stale: AndroidJobResult = {
        jobId: lease.jobId, employeeId: 'EMP-020', deviceId: 'DEV-020', bindingId: lease.bindingId,
        status: 'completed', output: { stale: true }, evidence: [{ kind: 'json', ref: 'memory://stale.json' }], completedAt: h.now().toISOString(),
      };
      await expect(restartedQueue.submit('EMP-020', 'DEV-020', lease.leaseId, lease.leaseToken, stale)).rejects.toThrow();
    }

    const replacement = await restartedRegistry.replaceDevice({
      employeeId: 'EMP-020', oldDeviceId: 'DEV-020', newDeviceId: 'DEV-020-B', publicKeyFingerprint: 'b'.repeat(64),
    });
    await restartedRegistry.activateEnrollment(replacement.enrollmentId, replacement.activationToken);
    await expect(restartedRegistry.authorize('EMP-020', 'DEV-020', 'job:pull')).rejects.toThrow();
    await expect(restartedRegistry.authorize('EMP-020', 'DEV-020-B', 'job:pull')).resolves.toMatchObject({ deviceId: 'DEV-020-B' });
  });
});
