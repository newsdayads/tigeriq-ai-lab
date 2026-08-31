import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { FileJournal } from '../../../event-store/src/index.js';
import { AndroidV07Registry } from './registry.js';
import type {
  AndroidJob,
  AndroidJobLease,
  AndroidJobResult,
  AndroidJobSnapshot,
  StoredAndroidJobLease,
} from './types.js';

const ID_PATTERN = /^[A-Z0-9][A-Z0-9._:-]{2,63}$/;

type JobEvent =
  | { action: 'queued'; job: AndroidJob }
  | { action: 'leased'; lease: StoredAndroidJobLease }
  | { action: 'lease-expired'; leaseId: string; at: string }
  | { action: 'result'; leaseId: string; result: AndroidJobResult; acceptedAt: string }
  | { action: 'retry-queued'; at: string; failure: NonNullable<AndroidJobResult['failure']> }
  | { action: 'terminal-failed'; at: string; failure: NonNullable<AndroidJobResult['failure']> };

export class DurableAndroidJobQueue {
  constructor(
    private readonly journal: FileJournal,
    private readonly registry: AndroidV07Registry,
    private readonly now: () => Date = () => new Date(),
    private readonly leaseTtlMs = 2 * 60_000,
    private readonly actor = 'workforce-android-v07-job',
  ) {
    if (leaseTtlMs < 15_000 || leaseTtlMs > 15 * 60_000) throw new Error('lease TTL must be between 15 seconds and 15 minutes');
  }

  async enqueue(job: AndroidJob): Promise<AndroidJobSnapshot> {
    validateJob(job);
    const employee = await this.registry.employee(job.employeeId);
    if (!employee || employee.state !== 'active') throw new Error('job employee is not active');
    for (const permission of job.requiredPermissions) {
      if (!employee.permissions.includes(permission)) throw new Error(`job requires unauthorized permission ${permission}`);
    }

    const existing = await this.#findByIdempotency(job.employeeId, job.idempotencyKey);
    if (existing) {
      if (stableJobSignature(existing.job) !== stableJobSignature(job)) throw new Error('job idempotency conflict');
      return existing;
    }

    const stream = jobStream(job.employeeId, job.jobId);
    if ((await this.journal.readStream<JobEvent>(stream)).length) throw new Error(`job ${job.jobId} already exists in employee namespace`);
    await this.journal.append(stream, 0, {
      type: 'workforce.v07.job.queued',
      actor: this.actor,
      payload: { action: 'queued', job: structuredClone(job) } satisfies JobEvent,
      timestamp: job.createdAt,
    });
    return this.get(job.employeeId, job.jobId);
  }

  async pull(employeeId: string, deviceId: string): Promise<AndroidJobLease | undefined> {
    const binding = await this.registry.authorize(employeeId, deviceId, 'job:pull');
    await this.recoverExpired(employeeId);
    const candidate = (await this.list(employeeId))
      .filter((item) => item.stage === 'queued' && item.attempts < item.job.maxAttempts)
      .sort((a, b) => Date.parse(a.job.createdAt) - Date.parse(b.job.createdAt) || a.job.jobId.localeCompare(b.job.jobId))[0];
    if (!candidate) return undefined;

    for (const permission of candidate.job.requiredPermissions) await this.registry.authorize(employeeId, deviceId, permission);
    const leaseToken = randomBytes(32).toString('base64url');
    const leasedAt = this.now().toISOString();
    const lease: AndroidJobLease = {
      jobId: candidate.job.jobId,
      employeeId,
      deviceId,
      bindingId: binding.bindingId,
      leaseId: `LS-${randomUUID()}`.toUpperCase(),
      leaseToken,
      attempt: candidate.attempts + 1,
      leasedAt,
      expiresAt: new Date(this.now().getTime() + this.leaseTtlMs).toISOString(),
      job: structuredClone(candidate.job),
    };
    const stored: StoredAndroidJobLease = {
      jobId: lease.jobId,
      employeeId: lease.employeeId,
      deviceId: lease.deviceId,
      bindingId: lease.bindingId,
      leaseId: lease.leaseId,
      leaseTokenHash: sha256(leaseToken),
      attempt: lease.attempt,
      leasedAt: lease.leasedAt,
      expiresAt: lease.expiresAt,
      job: structuredClone(lease.job),
    };
    await this.#append(employeeId, candidate.job.jobId, { action: 'leased', lease: stored });
    return structuredClone(lease);
  }

  async submit(
    employeeId: string,
    deviceId: string,
    leaseId: string,
    leaseToken: string,
    result: AndroidJobResult,
  ): Promise<AndroidJobResult> {
    const binding = await this.registry.authorize(employeeId, deviceId, 'job:submit');
    if (result.employeeId !== employeeId || result.deviceId !== deviceId || result.bindingId !== binding.bindingId) throw new Error('result identity mismatch');

    const snapshot = await this.get(employeeId, result.jobId);
    if (snapshot.result && snapshot.stage === 'completed') {
      if (stableResultSignature(snapshot.result) !== stableResultSignature(result)) throw new Error('duplicate result conflict');
      return structuredClone(snapshot.result);
    }

    const lease = snapshot.lease;
    if (!lease || snapshot.stage !== 'leased' || lease.leaseId !== leaseId) throw new Error('stale job lease');
    if (lease.deviceId !== deviceId || lease.bindingId !== binding.bindingId) throw new Error('lease is bound to another device');
    if (!safeHashEqual(lease.leaseTokenHash, sha256(leaseToken))) throw new Error('invalid job lease token');
    if (this.now().getTime() > Date.parse(lease.expiresAt)) throw new Error('job lease expired');
    if (result.jobId !== snapshot.job.jobId) throw new Error('result job mismatch');

    if (result.status === 'completed') {
      if (result.evidence.length === 0) throw new Error('completed result requires evidence');
      for (const expected of snapshot.job.expectedEvidence) {
        if (!result.evidence.some((artifact) => artifact.kind === expected || artifact.ref.includes(expected))) {
          throw new Error(`missing expected evidence ${expected}`);
        }
      }
    } else if (!result.failure) {
      throw new Error('failed result requires failure details');
    }

    const acceptedAt = this.now().toISOString();
    await this.#append(employeeId, result.jobId, { action: 'result', leaseId, result: structuredClone(result), acceptedAt });
    if (result.status === 'failed' && result.failure) {
      const latest = await this.get(employeeId, result.jobId);
      if (result.failure.retriable && latest.attempts < latest.job.maxAttempts) {
        await this.#append(employeeId, result.jobId, { action: 'retry-queued', at: acceptedAt, failure: result.failure });
      } else {
        await this.#append(employeeId, result.jobId, { action: 'terminal-failed', at: acceptedAt, failure: result.failure });
      }
    }
    return structuredClone(result);
  }

  async recoverExpired(employeeId: string): Promise<number> {
    let recovered = 0;
    for (const snapshot of await this.list(employeeId)) {
      if (snapshot.stage !== 'leased' || !snapshot.lease || snapshot.result) continue;
      if (Date.parse(snapshot.lease.expiresAt) >= this.now().getTime()) continue;
      const at = this.now().toISOString();
      await this.#append(employeeId, snapshot.job.jobId, { action: 'lease-expired', leaseId: snapshot.lease.leaseId, at });
      const failure = { code: 'LEASE_EXPIRED', message: 'Android worker lease expired before a result was accepted.', retriable: true };
      if (snapshot.attempts < snapshot.job.maxAttempts) {
        await this.#append(employeeId, snapshot.job.jobId, { action: 'retry-queued', at, failure });
      } else {
        await this.#append(employeeId, snapshot.job.jobId, { action: 'terminal-failed', at, failure });
      }
      recovered += 1;
    }
    return recovered;
  }

  async get(employeeId: string, jobId: string): Promise<AndroidJobSnapshot> {
    assertId(employeeId, 'employeeId');
    assertId(jobId, 'jobId');
    const events = await this.journal.readStream<JobEvent>(jobStream(employeeId, jobId));
    if (!events.length) throw new Error(`job ${jobId} not found in employee namespace ${employeeId}`);
    return reduceJob(events.map((entry) => entry.payload));
  }

  async list(employeeId: string): Promise<AndroidJobSnapshot[]> {
    assertId(employeeId, 'employeeId');
    const prefix = `${AndroidV07Registry.namespaces(employeeId).queue}:job:`;
    const all = await this.journal.readAll();
    const streamIds = [...new Set(all.map((entry) => entry.streamId).filter((streamId) => streamId.startsWith(prefix)))];
    const result: AndroidJobSnapshot[] = [];
    for (const streamId of streamIds) {
      const events = await this.journal.readStream<JobEvent>(streamId);
      if (events.length) result.push(reduceJob(events.map((entry) => entry.payload)));
    }
    return result;
  }

  async #findByIdempotency(employeeId: string, idempotencyKey: string): Promise<AndroidJobSnapshot | undefined> {
    return (await this.list(employeeId)).find((item) => item.job.idempotencyKey === idempotencyKey);
  }

  async #append(employeeId: string, jobId: string, event: JobEvent): Promise<void> {
    const stream = jobStream(employeeId, jobId);
    const events = await this.journal.readStream<JobEvent>(stream);
    await this.journal.append(stream, events.length, {
      type: `workforce.v07.job.${event.action}`,
      actor: this.actor,
      payload: event,
      timestamp: this.now().toISOString(),
    });
  }
}

function reduceJob(events: JobEvent[]): AndroidJobSnapshot {
  const queued = events.find((event): event is Extract<JobEvent, { action: 'queued' }> => event.action === 'queued');
  if (!queued) throw new Error('job stream is missing queued event');
  const snapshot: AndroidJobSnapshot = { job: structuredClone(queued.job), stage: 'queued', attempts: 0 };
  for (const event of events) {
    if (event.action === 'leased') {
      snapshot.stage = 'leased';
      snapshot.attempts = Math.max(snapshot.attempts, event.lease.attempt);
      snapshot.lease = structuredClone(event.lease);
      snapshot.result = undefined;
    } else if (event.action === 'lease-expired' && snapshot.lease?.leaseId === event.leaseId) {
      snapshot.stage = 'failed';
    } else if (event.action === 'result' && snapshot.lease?.leaseId === event.leaseId) {
      snapshot.result = structuredClone(event.result);
      snapshot.lastFailure = event.result.failure ? { ...event.result.failure } : undefined;
      snapshot.stage = event.result.status === 'completed' ? 'completed' : 'failed';
    } else if (event.action === 'retry-queued') {
      snapshot.stage = 'queued';
      snapshot.result = undefined;
      snapshot.lastFailure = { ...event.failure };
      snapshot.lease = undefined;
    } else if (event.action === 'terminal-failed') {
      snapshot.stage = 'failed';
      snapshot.lastFailure = { ...event.failure };
      snapshot.lease = undefined;
    }
  }
  return structuredClone(snapshot);
}

function validateJob(job: AndroidJob): void {
  assertId(job.jobId, 'jobId');
  assertId(job.employeeId, 'employeeId');
  if (!job.idempotencyKey.trim()) throw new Error('idempotencyKey is required');
  if (!job.objective.trim()) throw new Error('objective is required');
  if (!job.requiredPermissions.includes('job:pull') || !job.requiredPermissions.includes('job:submit')) {
    throw new Error('job must require job:pull and job:submit permissions');
  }
  if (!Number.isInteger(job.maxAttempts) || job.maxAttempts < 1 || job.maxAttempts > 10) throw new Error('maxAttempts must be between 1 and 10');
  if (!Number.isFinite(Date.parse(job.createdAt))) throw new Error('createdAt must be ISO date');
}

function jobStream(employeeId: string, jobId: string): string {
  return `${AndroidV07Registry.namespaces(employeeId).queue}:job:${jobId}`;
}
function stableJobSignature(job: AndroidJob): string {
  return JSON.stringify({ employeeId: job.employeeId, objective: job.objective, requiredPermissions: [...job.requiredPermissions].sort(), payload: job.payload, expectedEvidence: [...job.expectedEvidence].sort(), maxAttempts: job.maxAttempts });
}
function stableResultSignature(result: AndroidJobResult): string {
  return JSON.stringify({ jobId: result.jobId, employeeId: result.employeeId, deviceId: result.deviceId, bindingId: result.bindingId, status: result.status, output: result.output, evidence: result.evidence, failure: result.failure });
}
function sha256(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex'); }
function safeHashEqual(leftHex: string, rightHex: string): boolean {
  const left = Buffer.from(leftHex, 'hex'); const right = Buffer.from(rightHex, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}
function assertId(value: string, name: string): void { if (!ID_PATTERN.test(value)) throw new Error(`${name} must match ${ID_PATTERN}`); }
