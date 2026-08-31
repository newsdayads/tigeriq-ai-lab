export type EmployeeState = 'active' | 'suspended' | 'revoked';
export type DeviceState = 'pending' | 'active' | 'lost' | 'revoked' | 'replaced';
export type EnrollmentState = 'pending' | 'active' | 'revoked' | 'replaced';
export type AndroidPermission = 'job:pull' | 'job:submit' | 'evidence:write' | 'memory:read' | 'memory:write';
export type JobStage = 'queued' | 'leased' | 'completed' | 'failed';

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

export interface EmployeeNamespaces {
  employee: string;
  queue: string;
  memory: string;
  evidence: string;
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
  status: 'completed' | 'failed';
  output?: Record<string, unknown>;
  evidence: AndroidEvidence[];
  completedAt: string;
  failure?: { code: string; message: string; retriable: boolean };
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

export interface StoredAndroidJobLease extends Omit<AndroidJobLease, 'leaseToken'> {
  leaseTokenHash: string;
}

export interface AndroidJobSnapshot {
  job: AndroidJob;
  stage: JobStage;
  attempts: number;
  lease?: StoredAndroidJobLease;
  result?: AndroidJobResult;
  lastFailure?: AndroidJobResult['failure'];
}

export interface PullJobRequest { employeeId: string; deviceId: string; }
export type PullJobResponse = { kind: 'job'; lease: AndroidJobLease } | { kind: 'empty' };

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
