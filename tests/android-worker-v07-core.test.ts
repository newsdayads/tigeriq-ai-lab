import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileJournal } from '../packages/event-store/src/index.js';
import {
  AndroidThinWorkerApi,
  AndroidV07Registry,
  DurableAndroidJobQueue,
  MockAndroidThinWorker,
  type AndroidJob,
  type AndroidJobResult,
} from '../packages/workforce/src/android-v07/index.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function harness(start = '2026-08-31T07:00:00.000Z') {
  const dir = await mkdtemp(join(tmpdir(), 'tigeriq-android-v07-'));
  dirs.push(dir);
  let nowMs = Date.parse(start);
  const now = () => new Date(nowMs);
  const advance = (ms: number) => { nowMs += ms; };
  const journal = new FileJournal(join(dir, 'journal.jsonl'));
  const registry = new AndroidV07Registry(journal, now);
  const queue = new DurableAndroidJobQueue(journal, registry, now, 15_000);
  const api = new AndroidThinWorkerApi(queue);
  return { dir, journal, registry, queue, api, now, advance };
}

async function employeeAndDevice(
  registry: AndroidV07Registry,
  employeeId: string,
  deviceId: string,
) {
  await registry.createEmployee({
    employeeId,
    displayName: employeeId,
    roles: ['android-operator'],
    permissions: ['job:pull', 'job:submit', 'evidence:write'],
  });
  const grant = await registry.requestEnrollment({
    employeeId,
    deviceId,
    publicKeyFingerprint: 'a'.repeat(64),
  });
  const binding = await registry.activateEnrollment(grant.enrollmentId, grant.activationToken);
  return { grant, binding };
}

function job(employeeId: string, jobId: string, now: Date, overrides: Partial<AndroidJob> = {}): AndroidJob {
  return {
    jobId,
    idempotencyKey: `${employeeId}:${jobId}`,
    employeeId,
    objective: `execute ${jobId}`,
    requiredPermissions: ['job:pull', 'job:submit'],
    payload: { action: 'mock' },
    expectedEvidence: ['json'],
    maxAttempts: 2,
    createdAt: now.toISOString(),
    ...overrides,
  };
}

function completed(lease: Awaited<ReturnType<DurableAndroidJobQueue['pull']>>): AndroidJobResult {
  if (!lease) throw new Error('lease required');
  return {
    jobId: lease.jobId,
    employeeId: lease.employeeId,
    deviceId: lease.deviceId,
    bindingId: lease.bindingId,
    status: 'completed',
    output: { ok: true },
    evidence: [{ kind: 'json', ref: `memory://${lease.employeeId}/${lease.jobId}/result.json` }],
    completedAt: new Date().toISOString(),
  };
}

describe('Android v0.7 employee/device/job core', () => {
  it('runs Job -> Employee -> Device -> Result/Evidence end to end without provider identity', async () => {
    const h = await harness();
    const { binding } = await employeeAndDevice(h.registry, 'EMP-101', 'DEV-ANDROID-101');
    await h.queue.enqueue(job('EMP-101', 'JOB-101', h.now()));

    const worker = new MockAndroidThinWorker('EMP-101', 'DEV-ANDROID-101', h.api);
    const result = await worker.runOnce(async () => ({
      status: 'completed',
      output: { message: 'mock android executed' },
      evidence: [{ kind: 'json', ref: 'memory://EMP-101/JOB-101/result.json' }],
    }));

    expect(result?.employeeId).toBe('EMP-101');
    expect(result?.bindingId).toBe(binding.bindingId);
    expect((await h.queue.get('EMP-101', 'JOB-101')).stage).toBe('completed');
    expect(AndroidV07Registry.namespaces('EMP-101')).toEqual({
      employee: 'workforce:v07:employee:EMP-101',
      queue: 'workforce:v07:employee:EMP-101:queue',
      memory: 'workforce:v07:employee:EMP-101:memory',
      evidence: 'workforce:v07:employee:EMP-101:evidence',
    });
    const identity = await h.registry.employee('EMP-101');
    expect(identity).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(identity, 'provider')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(identity, 'credential')).toBe(false);
  });

  it('isolates queues and device bindings between two employees', async () => {
    const h = await harness();
    await employeeAndDevice(h.registry, 'EMP-201', 'DEV-ANDROID-201');
    await employeeAndDevice(h.registry, 'EMP-202', 'DEV-ANDROID-202');
    await h.queue.enqueue(job('EMP-201', 'JOB-201', h.now()));
    await h.queue.enqueue(job('EMP-202', 'JOB-202', h.now()));

    const a = await h.queue.pull('EMP-201', 'DEV-ANDROID-201');
    const b = await h.queue.pull('EMP-202', 'DEV-ANDROID-202');
    expect(a?.jobId).toBe('JOB-201');
    expect(b?.jobId).toBe('JOB-202');
    await expect(h.queue.pull('EMP-201', 'DEV-ANDROID-202')).rejects.toThrow('active employee-device binding not found');
    await expect(h.queue.get('EMP-201', 'JOB-202')).rejects.toThrow('not found');
    expect((await h.queue.list('EMP-201')).map((item) => item.job.jobId)).toEqual(['JOB-201']);
    expect((await h.queue.list('EMP-202')).map((item) => item.job.jobId)).toEqual(['JOB-202']);
  });

  it('deduplicates jobs, rejects conflicting replay, and accepts duplicate completed submit idempotently', async () => {
    const h = await harness();
    await employeeAndDevice(h.registry, 'EMP-301', 'DEV-ANDROID-301');
    const first = job('EMP-301', 'JOB-301', h.now());
    await h.queue.enqueue(first);
    expect((await h.queue.enqueue({ ...first, jobId: 'JOB-OTHER' })).job.jobId).toBe('JOB-301');
    await expect(h.queue.enqueue({ ...first, jobId: 'JOB-CONFLICT', objective: 'different semantic work' })).rejects.toThrow('idempotency conflict');

    const lease = await h.queue.pull('EMP-301', 'DEV-ANDROID-301');
    if (!lease) throw new Error('expected lease');
    const result = completed(lease);
    const accepted = await h.queue.submit('EMP-301', 'DEV-ANDROID-301', lease.leaseId, lease.leaseToken, result);
    const duplicate = await h.queue.submit('EMP-301', 'DEV-ANDROID-301', lease.leaseId, lease.leaseToken, result);
    expect(duplicate).toEqual(accepted);
  });

  it('recovers an expired lease after reboot and retries within maxAttempts', async () => {
    const h = await harness();
    await employeeAndDevice(h.registry, 'EMP-401', 'DEV-ANDROID-401');
    await h.queue.enqueue(job('EMP-401', 'JOB-401', h.now()));
    const first = await h.queue.pull('EMP-401', 'DEV-ANDROID-401');
    expect(first?.attempt).toBe(1);
    h.advance(16_000);

    const registryAfterReboot = new AndroidV07Registry(h.journal, h.now);
    const queueAfterReboot = new DurableAndroidJobQueue(h.journal, registryAfterReboot, h.now, 15_000);
    expect(await queueAfterReboot.recoverExpired('EMP-401')).toBe(1);
    const second = await queueAfterReboot.pull('EMP-401', 'DEV-ANDROID-401');
    expect(second?.attempt).toBe(2);
    expect(second?.leaseId).not.toBe(first?.leaseId);
  });

  it('blocks lost/revoked devices and supports replacement with a new binding', async () => {
    const h = await harness();
    const old = await employeeAndDevice(h.registry, 'EMP-501', 'DEV-ANDROID-501');
    await h.queue.enqueue(job('EMP-501', 'JOB-501', h.now()));
    await h.registry.markDeviceLost('DEV-ANDROID-501');
    await expect(h.queue.pull('EMP-501', 'DEV-ANDROID-501')).rejects.toThrow();

    const replacement = await h.registry.replaceDevice({
      employeeId: 'EMP-501',
      oldDeviceId: 'DEV-ANDROID-501',
      newDeviceId: 'DEV-ANDROID-502',
      publicKeyFingerprint: 'b'.repeat(64),
    });
    const newBinding = await h.registry.activateEnrollment(replacement.enrollmentId, replacement.activationToken);
    expect(newBinding.bindingId).not.toBe(old.binding.bindingId);
    expect((await h.registry.device('DEV-ANDROID-501'))?.state).toBe('replaced');
    expect((await h.registry.device('DEV-ANDROID-502'))?.state).toBe('active');

    const lease = await h.queue.pull('EMP-501', 'DEV-ANDROID-502');
    expect(lease?.bindingId).toBe(newBinding.bindingId);
    await h.registry.revokeDevice('DEV-ANDROID-502');
    if (!lease) throw new Error('expected lease');
    await expect(h.queue.submit('EMP-501', 'DEV-ANDROID-502', lease.leaseId, lease.leaseToken, completed(lease))).rejects.toThrow('device is not active');
  });
});
