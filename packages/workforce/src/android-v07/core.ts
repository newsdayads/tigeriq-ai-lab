import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { FileJournal } from '../../../event-store/src/index.js';

export type EmployeeState = 'active' | 'suspended' | 'revoked';
export type DeviceState = 'pending' | 'active' | 'lost' | 'revoked' | 'replaced';
export type EnrollmentState = 'pending' | 'active' | 'revoked' | 'replaced';
export type AndroidPermission = 'job:pull' | 'job:submit' | 'evidence:write' | 'memory:read' | 'memory:write';
export type JobStage = 'queued' | 'leased' | 'completed' | 'failed';
export type AndroidJobResultStatus = 'completed' | 'failed';

export interface EmployeeIdentity {
  employeeId: string;
  displayName: string;
  roles: string[];
  permissions: AndroidPermission[];
  state: EmployeeState;
  createdAt: string;
}

export interface DeviceIdentity {
  deviceId: string;
  platform: 'android';
  publicKeyFingerprint: string;
  state: DeviceState;
  createdAt: string;
  lostAt?: string;
  revokedAt?: string;
  replacedByDeviceId?: string;
}

export interface EmployeeDeviceBinding {
  bindingId: string;
  employeeId: string;
  deviceId: string;
  enrollmentId: string;
  state: EnrollmentState;
  enrolledAt: string;
  activatedAt?: string;
  revokedAt?: string;
  replacedByBindingId?: string;
}

export interface EnrollmentGrant {
  enrollmentId: string;
  employeeId: string;
  deviceId: string;
  bindingId: string;
  activationToken: string;
  expiresAt: string;
}

export interface AndroidEvidence {
  kind: 'text' | 'json' | 'screenshot' | 'log' | 'commit' | 'url';
  ref: string;
  summary?: string;
  sha256?: string;
}

export interface AndroidJob {
  jobId: string;
  idempotencyKey: string;
  employeeId: string;
  objective: string;
  requiredPermissions: AndroidPermission[];
  payload: Record<string, unknown>;
  expectedEvidence: string[];
  maxAttempts: number;
  createdAt: string;
}

export interface AndroidJobResult {
  jobId: string;
  employeeId: string;
  deviceId: string;
  bindingId: string;
  status: AndroidJobResultStatus;
  output?: Record<string, unknown>;
  evidence: AndroidEvidence[];
  completedAt: string;
  failure?: {
    code: string;
    message: string;
    retriable: boolean;
  };
}

export interface AndroidJobLease {
  jobId: string;
  employeeId: string;
  deviceId: string;
  bindingId: string;
  leaseId: string;
  leaseToken: string;
  attempt: number;
  leasedAt: string;
  expiresAt: string;
  job: AndroidJob;
}

export interface AndroidJobSnapshot {
  job: AndroidJob;
  stage: JobStage;
  attempts: number;
  lease?: Omit<AndroidJobLease, 'leaseToken'> & { leaseTokenHash: string };
  result?: AndroidJobResult;
  lastFailure?: AndroidJobResult['failure'];
}

export interface EmployeeNamespaces {
  employee: string;
  queue: string;
  memory: string;
  evidence: string;
}

type IdentityEvent =
  | { action: 'employee-created'; employee: EmployeeIdentity }
  | { action: 'employee-state'; employeeId: string; state: EmployeeState; at: string }
  | { action: 'device-created'; device: DeviceIdentity }
  | { action: 'enrollment-requested'; binding: EmployeeDeviceBinding; tokenHash: string; expiresAt: string }
  | { action: 'enrollment-activated'; bindingId: string; activatedAt: string }
  | { action: 'device-lost'; deviceId: string; at: string }
  | { action: 'binding-revoked'; bindingId: string; at: string }
  | { action: 'device-revoked'; deviceId: string; at: string }
  | { action: 'binding-replaced'; bindingId: string; replacementBindingId: string; at: string }
  | { action: 'device-replaced'; deviceId: string; replacementDeviceId: string; at: string };

type JobEvent =
  | { action: 'queued'; job: AndroidJob }
  | { action: 'leased'; lease: Omit<AndroidJobLease, 'leaseToken'> & { leaseTokenHash: string } }
  | { action: 'lease-expired'; leaseId: string; at: string }
  | { action: 'result'; leaseId: string; result: AndroidJobResult; acceptedAt: string }
  | { action: 'retry-queued'; at: string; failure: NonNullable<AndroidJobResult['failure']> }
  | { action: 'terminal-failed'; at: string; failure: NonNullable<AndroidJobResult['failure']> };

interface IdentityProjection {
  employees: Map<string, EmployeeIdentity>;
  devices: Map<string, DeviceIdentity>;
  bindings: Map<string, EmployeeDeviceBinding>;
  enrollmentSecrets: Map<string, { tokenHash: string; expiresAt: string }>;
}

const IDENTITY_STREAM = 'workforce:v07:identity';
const ID_PATTERN = /^[A-Z0-9][A-Z0-9._:-]{2,63}$/;

export class AndroidV07Registry {
  constructor(
    private readonly journal: FileJournal,
    private readonly now: () => Date = () => new Date(),
    private readonly enrollmentTtlMs = 10 * 60_000,
    private readonly actor = 'workforce-android-v07',
  ) {
    if (enrollmentTtlMs < 30_000 || enrollmentTtlMs > 60 * 60_000) {
      throw new Error('enrollment TTL must be between 30 seconds and 60 minutes');
    }
  }

  static namespaces(employeeId: string): EmployeeNamespaces {
    assertId(employeeId, 'employeeId');
    const employee = `workforce:v07:employee:${employeeId}`;
    return {
      employee,
      queue: `${employee}:queue`,
      memory: `${employee}:memory`,
      evidence: `${employee}:evidence`,
    };
  }

  async createEmployee(input: Omit<EmployeeIdentity, 'state' | 'createdAt'> & Partial<Pick<EmployeeIdentity, 'state' | 'createdAt'>>): Promise<EmployeeIdentity> {
    assertId(input.employeeId, 'employeeId');
    if (!input.displayName.trim()) throw new Error('displayName is required');
    if (input.roles.length === 0) throw new Error('at least one role is required');
    if (input.permissions.length === 0) throw new Error('at least one permission is required');
    const projection = await this.#projection();
    if (projection.employees.has(input.employeeId)) throw new Error(`employee ${input.employeeId} already exists`);
    const employee: EmployeeIdentity = {
      employeeId: input.employeeId,
      displayName: input.displayName,
      roles: unique(input.roles),
      permissions: unique(input.permissions),
      state: input.state ?? 'active',
      createdAt: input.createdAt ?? this.now().toISOString(),
    };
    await this.#append({ action: 'employee-created', employee });
    return structuredClone(employee);
  }

  async setEmployeeState(employeeId: string, state: EmployeeState): Promise<EmployeeIdentity> {
    const projection = await this.#projection();
    const employee = projection.employees.get(employeeId);
    if (!employee) throw new Error(`employee ${employeeId} not found`);
    await this.#append({ action: 'employee-state', employeeId, state, at: this.now().toISOString() });
    return { ...employee, roles: [...employee.roles], permissions: [...employee.permissions], state };
  }

  async requestEnrollment(input: { employeeId: string; deviceId: string; publicKeyFingerprint: string }): Promise<EnrollmentGrant> {
    assertId(input.employeeId, 'employeeId');
    assertId(input.deviceId, 'deviceId');
    if (!/^[a-f0-9]{64}$/i.test(input.publicKeyFingerprint)) throw new Error('publicKeyFingerprint must be SHA-256 hex');
    const projection = await this.#projection();
    const employee = projection.employees.get(input.employeeId);
    if (!employee || employee.state !== 'active') throw new Error('employee is not active');
    const existingDevice = projection.devices.get(input.deviceId);
    if (existingDevice && existingDevice.state !== 'pending') throw new Error(`device ${input.deviceId} already exists`);
    for (const binding of projection.bindings.values()) {
      if (binding.employeeId === input.employeeId && binding.state === 'active') throw new Error('employee already has an active device binding');
    }
    const enrollmentId = `ENR-${randomUUID()}`.toUpperCase();
    const bindingId = `BND-${randomUUID()}`.toUpperCase();
    const activationToken = randomToken();
    const createdAt = this.now().toISOString();
    const expiresAt = new Date(this.now().getTime() + this.enrollmentTtlMs).toISOString();
    const device: DeviceIdentity = {
      deviceId: input.deviceId,
      platform: 'android',
      publicKeyFingerprint: input.publicKeyFingerprint.toLowerCase(),
      state: 'pending',
      createdAt,
    };
    const binding: EmployeeDeviceBinding = {
      bindingId,
      employeeId: input.employeeId,
      deviceId: input.deviceId,
      enrollmentId,
      state: 'pending',
      enrolledAt: createdAt,
    };
    if (!existingDevice) await this.#append({ action: 'device-created', device });
    await this.#append({ action: 'enrollment-requested', binding, tokenHash: sha256(activationToken), expiresAt });
    return { enrollmentId, employeeId: input.employeeId, deviceId: input.deviceId, bindingId, activationToken, expiresAt };
  }

  async activateEnrollment(enrollmentId: string, activationToken: string): Promise<EmployeeDeviceBinding> {
    const projection = await this.#projection();
    const binding = [...projection.bindings.values()].find((item) => item.enrollmentId === enrollmentId);
    if (!binding || binding.state !== 'pending') throw new Error('enrollment is not pending');
    const secret = projection.enrollmentSecrets.get(enrollmentId);
    if (!secret) throw new Error('enrollment secret not found');
    if (this.now().getTime() > Date.parse(secret.expiresAt)) throw new Error('enrollment expired');
    if (!safeHashEqual(secret.tokenHash, sha256(activationToken))) throw new Error('invalid enrollment token');
    const employee = projection.employees.get(binding.employeeId);
    const device = projection.devices.get(binding.deviceId);
    if (!employee || employee.state !== 'active' || !device || device.state !== 'pending') throw new Error('enrollment subject is not active');
    const activatedAt = this.now().toISOString();
    await this.#append({ action: 'enrollment-activated', bindingId: binding.bindingId, activatedAt });
    return { ...binding, state: 'active', activatedAt };
  }

  async markDeviceLost(deviceId: string): Promise<void> {
    const projection = await this.#projection();
    const device = projection.devices.get(deviceId);
    if (!device) throw new Error(`device ${deviceId} not found`);
    if (device.state === 'revoked' || device.state === 'replaced') return;
    const at = this.now().toISOString();
    await this.#append({ action: 'device-lost', deviceId, at });
    for (const binding of projection.bindings.values()) {
      if (binding.deviceId === deviceId && binding.state === 'active') {
        await this.#append({ action: 'binding-revoked', bindingId: binding.bindingId, at });
      }
    }
  }

  async revokeDevice(deviceId: string): Promise<void> {
    const projection = await this.#projection();
    const device = projection.devices.get(deviceId);
    if (!device) throw new Error(`device ${deviceId} not found`);
    const at = this.now().toISOString();
    if (device.state !== 'revoked') await this.#append({ action: 'device-revoked', deviceId, at });
    for (const binding of projection.bindings.values()) {
      if (binding.deviceId === deviceId && (binding.state === 'active' || binding.state === 'pending')) {
        await this.#append({ action: 'binding-revoked', bindingId: binding.bindingId, at });
      }
    }
  }

  async replaceDevice(input: { employeeId: string; oldDeviceId: string; newDeviceId: string; publicKeyFingerprint: string }): Promise<EnrollmentGrant> {
    const projection = await this.#projection();
    const oldBinding = [...projection.bindings.values()].find((binding) => binding.employeeId === input.employeeId && binding.deviceId === input.oldDeviceId && (binding.state === 'active' || binding.state === 'revoked'));
    if (!oldBinding) throw new Error('old employee-device binding not found');
    if (input.oldDeviceId === input.newDeviceId) throw new Error('replacement must use a new deviceId');
    if (projection.devices.has(input.newDeviceId)) throw new Error('replacement deviceId already exists');
    if (oldBinding.state === 'active') await this.revokeDevice(input.oldDeviceId);
    const grant = await this.requestEnrollment({ employeeId: input.employeeId, deviceId: input.newDeviceId, publicKeyFingerprint: input.publicKeyFingerprint });
    const at = this.now().toISOString();
    await this.#append({ action: 'binding-replaced', bindingId: oldBinding.bindingId, replacementBindingId: grant.bindingId, at });
    await this.#append({ action: 'device-replaced', deviceId: input.oldDeviceId, replacementDeviceId: input.newDeviceId, at });
    return grant;
  }

  async employee(employeeId: string): Promise<EmployeeIdentity | undefined> {
    const employee = (await this.#projection()).employees.get(employeeId);
    return employee ? structuredClone(employee) : undefined;
  }

  async device(deviceId: string): Promise<DeviceIdentity | undefined> {
    const device = (await this.#projection()).devices.get(deviceId);
    return device ? structuredClone(device) : undefined;
  }

  async binding(employeeId: string, deviceId: string): Promise<EmployeeDeviceBinding | undefined> {
    const projection = await this.#projection();
    const binding = [...projection.bindings.values()].find((item) => item.employeeId === employeeId && item.deviceId === deviceId && item.state === 'active');
    return binding ? structuredClone(binding) : undefined;
  }

  async authorize(employeeId: string, deviceId: string, permission: AndroidPermission): Promise<EmployeeDeviceBinding> {
    const projection = await this.#projection();
    const employee = projection.employees.get(employeeId);
    const device = projection.devices.get(deviceId);
    const binding = [...projection.bindings.values()].find((item) => item.employeeId === employeeId && item.deviceId === deviceId && item.state === 'active');
    if (!employee || employee.state !== 'active') throw new Error('employee is not active');
    if (!device || device.state !== 'active') throw new Error('device is not active');
    if (!binding) throw new Error('active employee-device binding not found');
    if (!employee.permissions.includes(permission)) throw new Error(`employee lacks permission ${permission}`);
    return structuredClone(binding);
  }

  async #append(event: IdentityEvent): Promise<void> {
    const events = await this.journal.readStream<IdentityEvent>(IDENTITY_STREAM);
    await this.journal.append(IDENTITY_STREAM, events.length, {
      type: `workforce.v07.${event.action}`,
      actor: this.actor,
      payload: event,
      timestamp: this.now().toISOString(),
    });
  }

  async #projection(): Promise<IdentityProjection> {
    const events = await this.journal.readStream<IdentityEvent>(IDENTITY_STREAM);
    const projection: IdentityProjection = {
      employees: new Map(),
      devices: new Map(),
      bindings: new Map(),
      enrollmentSecrets: new Map(),
    };
    for (const entry of events) {
      const event = entry.payload;
      switch (event.action) {
        case 'employee-created':
          projection.employees.set(event.employee.employeeId, structuredClone(event.employee));
          break;
        case 'employee-state': {
          const employee = projection.employees.get(event.employeeId);
          if (employee) employee.state = event.state;
          break;
        }
        case 'device-created':
          projection.devices.set(event.device.deviceId, structuredClone(event.device));
          break;
        case 'enrollment-requested':
          projection.bindings.set(event.binding.bindingId, structuredClone(event.binding));
          projection.enrollmentSecrets.set(event.binding.enrollmentId, { tokenHash: event.tokenHash, expiresAt: event.expiresAt });
          break;
        case 'enrollment-activated': {
          const binding = projection.bindings.get(event.bindingId);
          if (binding) {
            binding.state = 'active';
            binding.activatedAt = event.activatedAt;
            const device = projection.devices.get(binding.deviceId);
            if (device) device.state = 'active';
          }
          break;
        }
        case 'device-lost': {
          const device = projection.devices.get(event.deviceId);
          if (device) {
            device.state = 'lost';
            device.lostAt = event.at;
          }
          break;
        }
        case 'binding-revoked': {
          const binding = projection.bindings.get(event.bindingId);
          if (binding) {
            binding.state = 'revoked';
            binding.revokedAt = event.at;
          }
          break;
        }
        case 'device-revoked': {
          const device = projection.devices.get(event.deviceId);
          if (device) {
            device.state = 'revoked';
            device.revokedAt = event.at;
          }
          break;
        }
        case 'binding-replaced': {
          const binding = projection.bindings.get(event.bindingId);
          if (binding) {
            binding.state = 'replaced';
            binding.replacedByBindingId = event.replacementBindingId;
          }
          break;
        }
        case 'device-replaced': {
          const device = projection.devices.get(event.deviceId);
          if (device) {
            device.state = 'replaced';
            device.replacedByDeviceId = event.replacementDeviceId;
          }
          break;
        }
      }
    }
    return projection;
  }
}

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
      type: 'workforce.v07.job.queued', actor: this.actor, payload: { action: 'queued', job: structuredClone(job) } satisfies JobEvent, timestamp: job.createdAt,
    });
    return this.get(job.employeeId, job.jobId);
  }

  async pull(employeeId: string, deviceId: string): Promise<AndroidJobLease | undefined> {
    const binding = await this.registry.authorize(employeeId, deviceId, 'job:pull');
    await this.recoverExpired(employeeId);
    const jobs = await this.list(employeeId);
    const candidate = jobs
      .filter((item) => item.stage === 'queued' && item.attempts < item.job.maxAttempts)
      .sort((a, b) => Date.parse(a.job.createdAt) - Date.parse(b.job.createdAt) || a.job.jobId.localeCompare(b.job.jobId))[0];
    if (!candidate) return undefined;
    for (const permission of candidate.job.requiredPermissions) await this.registry.authorize(employeeId, deviceId, permission);
    const leaseToken = randomToken();
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
    const storedLease = { ...lease, leaseTokenHash: sha256(leaseToken) };
    delete (storedLease as Partial<AndroidJobLease>).leaseToken;
    await this.#append(employeeId, candidate.job.jobId, {
      action: 'leased',
      lease: storedLease as Omit<AndroidJobLease, 'leaseToken'> & { leaseTokenHash: string },
    });
    return structuredClone(lease);
  }

  async submit(employeeId: string, deviceId: string, leaseId: string, leaseToken: string, result: AndroidJobResult): Promise<AndroidJobResult> {
    const binding = await this.registry.authorize(employeeId, deviceId, 'job:submit');
    if (result.employeeId !== employeeId || result.deviceId !== deviceId || result.bindingId !== binding.bindingId) throw new Error('result identity mismatch');
    const snapshot = await this.get(employeeId, result.jobId);
    if (snapshot.result) {
      if (stableResultSignature(snapshot.result) !== stableResultSignature(result)) throw new Error('duplicate result conflict');
      return structuredClone(snapshot.result);
    }
    const lease = snapshot.lease;
    if (!lease || snapshot.stage !== 'leased' || lease.leaseId !== leaseId) throw new Error('stale job lease');
    if (lease.deviceId !== deviceId || lease.bindingId !== binding.bindingId) throw new Error('lease is bound to another device');
    if (!safeHashEqual(lease.leaseTokenHash, sha256(leaseToken))) throw new Error('invalid job lease token');
    if (this.now().getTime() > Date.parse(lease.expiresAt)) throw new Error('job lease expired');
    if (result.status === 'completed') {
      if (result.evidence.length === 0) throw new Error('completed result requires evidence');
      for (const expected of snapshot.job.expectedEvidence) {
        if (!result.evidence.some((artifact) => artifact.kind === expected || artifact.ref.includes(expected))) {
          throw new Error(`missing expected evidence ${expected}`);
        }
      }
    }
    const acceptedAt = this.now().toISOString();
    await this.#append(employeeId, result.jobId, { action: 'result', leaseId, result: structuredClone(result), acceptedAt });
    if (result.status === 'failed' && result.failure?.retriable) {
      const latest = await this.get(employeeId, result.jobId);
      if (latest.attempts < latest.job.maxAttempts) {
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

export interface PullJobRequest { employeeId: string; deviceId: string; }
export interface PullJobResponse { kind: 'job'; lease: AndroidJobLease } | { kind: 'empty' };

export interface SubmitJobResultRequest {
  employeeId: string;
  deviceId: string;
  leaseId: string;
  leaseToken: string;
  result: AndroidJobResult;
}

export interface SubmitJobResultResponse {
  accepted: true;
  result: AndroidJobResult;
  evidenceNamespace: string;
}

export class AndroidThinWorkerApi {
  constructor(private readonly queue: DurableAndroidJobQueue) {}

  async pull(request: PullJobRequest): Promise<PullJobResponse> {
    const lease = await this.queue.pull(request.employeeId, request.deviceId);
    return lease ? { kind: 'job', lease } : { kind: 'empty' };
  }

  async submit(request: SubmitJobResultRequest): Promise<SubmitJobResultResponse> {
    const result = await this.queue.submit(request.employeeId, request.deviceId, request.leaseId, request.leaseToken, request.result);
    return {
      accepted: true,
      result,
      evidenceNamespace: `${AndroidV07Registry.namespaces(request.employeeId).evidence}:job:${result.jobId}`,
    };
  }
}

export class MockAndroidThinWorker {
  constructor(
    readonly employeeId: string,
    readonly deviceId: string,
    private readonly api: AndroidThinWorkerApi,
  ) {}

  async runOnce(execute: (job: AndroidJob) => Promise<Omit<AndroidJobResult, 'jobId' | 'employeeId' | 'deviceId' | 'bindingId' | 'completedAt'>>): Promise<AndroidJobResult | undefined> {
    const pulled = await this.api.pull({ employeeId: this.employeeId, deviceId: this.deviceId });
    if (pulled.kind === 'empty') return undefined;
    const lease = pulled.lease;
    const partial = await execute(lease.job);
    const result: AndroidJobResult = {
      ...partial,
      jobId: lease.jobId,
      employeeId: this.employeeId,
      deviceId: this.deviceId,
      bindingId: lease.bindingId,
      completedAt: new Date().toISOString(),
    };
    return (await this.api.submit({
      employeeId: this.employeeId,
      deviceId: this.deviceId,
      leaseId: lease.leaseId,
      leaseToken: lease.leaseToken,
      result,
    })).result;
  }
}

function validateJob(job: AndroidJob): void {
  assertId(job.jobId, 'jobId');
  assertId(job.employeeId, 'employeeId');
  if (!job.idempotencyKey.trim()) throw new Error('idempotencyKey is required');
  if (!job.objective.trim()) throw new Error('objective is required');
  if (job.requiredPermissions.length === 0 || !job.requiredPermissions.includes('job:pull') || !job.requiredPermissions.includes('job:submit')) {
    throw new Error('job must require job:pull and job:submit permissions');
  }
  if (!Number.isInteger(job.maxAttempts) || job.maxAttempts < 1 || job.maxAttempts > 10) throw new Error('maxAttempts must be between 1 and 10');
  if (!Number.isFinite(Date.parse(job.createdAt))) throw new Error('createdAt must be ISO date');
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
    } else if (event.action === 'lease-expired') {
      if (snapshot.lease?.leaseId === event.leaseId) snapshot.stage = 'failed';
    } else if (event.action === 'result') {
      if (snapshot.lease?.leaseId === event.leaseId) {
        snapshot.result = structuredClone(event.result);
        snapshot.lastFailure = event.result.failure ? { ...event.result.failure } : undefined;
        snapshot.stage = event.result.status === 'completed' ? 'completed' : 'failed';
      }
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

function jobStream(employeeId: string, jobId: string): string {
  return `${AndroidV07Registry.namespaces(employeeId).queue}:job:${jobId}`;
}

function stableJobSignature(job: AndroidJob): string {
  return JSON.stringify({
    employeeId: job.employeeId,
    objective: job.objective,
    requiredPermissions: [...job.requiredPermissions].sort(),
    payload: job.payload,
    expectedEvidence: [...job.expectedEvidence].sort(),
    maxAttempts: job.maxAttempts,
  });
}

function stableResultSignature(result: AndroidJobResult): string {
  return JSON.stringify({
    jobId: result.jobId,
    employeeId: result.employeeId,
    deviceId: result.deviceId,
    bindingId: result.bindingId,
    status: result.status,
    output: result.output,
    evidence: result.evidence,
    failure: result.failure,
  });
}

function unique<T extends string>(values: T[]): T[] { return [...new Set(values)]; }
function randomToken(bytes = 32): string { return randomBytes(bytes).toString('base64url'); }
function sha256(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex'); }
function safeHashEqual(leftHex: string, rightHex: string): boolean {
  const left = Buffer.from(leftHex, 'hex');
  const right = Buffer.from(rightHex, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}
function assertId(value: string, name: string): void {
  if (!ID_PATTERN.test(value)) throw new Error(`${name} must match ${ID_PATTERN}`);
}
