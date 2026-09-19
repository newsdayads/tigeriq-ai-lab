import type { WorkerId } from './model.js';

export const AUTO_CONTINUE = 'AUTO_CONTINUE' as const;
export const TERMINAL_JOB_STATUSES = new Set(['DONE', 'FAILED', 'BLOCKED', 'CANCELLED']);
export const EXECUTABLE_JOB_STATUSES = new Set(['QUEUED', 'READY']);
export const ALLOWED_EVIDENCE_SOURCES = new Set(['GITHUB', 'CORE']);
export const DEFAULT_SNAPSHOT_MAX_AGE_MS = 5 * 60_000;
export const DISALLOWED_RISK_FLAGS = new Set([
  'PAID','CREDENTIAL_CHANGE','DESTRUCTIVE','PRODUCTION_RELEASE','IRREVERSIBLE','SECURITY_BOUNDARY',
  'AUTH_REQUIRED','REAUTH','CAPTCHA','RATE_LIMIT','RATE_LIMIT_429','HTTP_429','SECURITY_WARNING','SUSPICIOUS_ACTIVITY',
]);

export type AutoContinueDispatchFailureClass = 'SAFE_RETRY' | 'UNCERTAIN';

export function classifyAutoContinueDispatchFailure(error: unknown, dispatchSubmitted: boolean): AutoContinueDispatchFailureClass {
  if (dispatchSubmitted) return 'UNCERTAIN';
  const message = String(error);
  const isNonDelivered = [
    'COMMAND_TIMEOUT_NOT_DELIVERED',
    'COMPOSER_NOT_FOUND',
    'SEND_BUTTON_NOT_FOUND',
    'UI_JOB_ACTIVE:',
    'UI_JOB_DUPLICATE_ACTIVE:',
  ].some((marker) => message.includes(marker));
  return isNonDelivered ? 'SAFE_RETRY' : 'UNCERTAIN';
}

const MAX_FUTURE_SKEW_MS = 60_000;

export type EvidenceSource = 'GITHUB' | 'CORE';
export type AutopilotPhase = 'IDLE' | 'BUSY' | 'WAIT_EVIDENCE' | 'STOPPED' | 'RECOVERING';
export type JobPriority = 'P0' | 'P1' | 'P2';
export type JobStatus = 'QUEUED' | 'READY' | 'RUNNING' | 'DONE' | 'FAILED' | 'BLOCKED' | 'CANCELLED';

export interface ExternalEvidence {
  source: EvidenceSource;
  ref: string;
  verifiedAt?: string;
  jobId?: string;
  completionRevision?: string;
  completedAt?: string;
}

export interface ExternalJob {
  jobId: string;
  workerId: WorkerId;
  status: JobStatus;
  executable: boolean;
  priority: JobPriority;
  prompt?: string;
  evidence?: ExternalEvidence[];
  riskFlags?: string[];
  completionRevision?: string;
  completedAt?: string;
}

export interface ExternalAutopilotSnapshot {
  source: EvidenceSource;
  observedAt: string;
  revision?: string;
  previousJob?: ExternalJob;
  nextJob?: ExternalJob;
  requiredWorkers?: WorkerId[];
}

export interface DurableAutopilotState {
  phase: AutopilotPhase;
  lastDispatchedJobId?: string;
  lastDispatchedAt?: string;
  lastCompletedJobId?: string;
  lastEvidenceRef?: string;
  lastCompletedEvidenceRevision?: string;
  lastTrigger?: typeof AUTO_CONTINUE;
  pendingJobId?: string;
  pendingReservedAt?: string;
  uncertainJobId?: string;
  dispatchFailureClass?: AutoContinueDispatchFailureClass;
  retryAt?: number;
  updatedAt: string;
}

export type AutopilotDecision =
  | { kind: 'IDLE'; reason: string }
  | { kind: 'BUSY'; reason: string }
  | { kind: 'WAIT_EVIDENCE'; reason: string }
  | { kind: 'STOP'; reason: string }
  | { kind: 'DUPLICATE_NOOP'; reason: string; jobId: string }
  | { kind: 'DISPATCH'; trigger: typeof AUTO_CONTINUE; jobId: string; text: string; issueRef?: string; evidenceRef?: string; evidenceRevision?: string; dispatchFailureClass?: AutoContinueDispatchFailureClass; retryAt?: number };

function parsed(value: string | undefined): number | undefined {
  if (!value) return;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

export function canonicalGithubIssueRef(jobId: string): string | undefined {
  const match = String(jobId || '').trim().match(/^GH-(\d+)$/);
  if (!match) return;
  return `https://github.com/newsdayads/tigeriq-ai-lab/issues/${match[1]}`;
}

export function selectFreshCompletionEvidence(job: ExternalJob | undefined, state: DurableAutopilotState, observedAtMs: number): ExternalEvidence | undefined {
  if (!job?.evidence?.length) return;
  if (state.lastDispatchedJobId !== job.jobId) return;
  const dispatchedAt = parsed(state.lastDispatchedAt);
  if (dispatchedAt === undefined) return;
  return job.evidence.find((item) => {
    if (!ALLOWED_EVIDENCE_SOURCES.has(item.source) || !item.ref?.trim() || !item.verifiedAt || !item.completedAt || !item.jobId || !item.completionRevision?.trim()) return false;
    if (item.jobId !== job.jobId) return false;
    if (job.completionRevision && item.completionRevision !== job.completionRevision) return false;
    if (job.completedAt && item.completedAt !== job.completedAt) return false;
    const completedAt = parsed(item.completedAt), verifiedAt = parsed(item.verifiedAt);
    if (completedAt === undefined || verifiedAt === undefined) return false;
    if (verifiedAt < completedAt || verifiedAt > observedAtMs + MAX_FUTURE_SKEW_MS) return false;
    if (dispatchedAt !== undefined && completedAt < dispatchedAt) return false;
    if (state.lastCompletedEvidenceRevision === item.completionRevision && state.lastCompletedJobId !== job.jobId) return false;
    return true;
  });
}

export function freshAutopilotState(): DurableAutopilotState {
  return {
    phase: 'IDLE',
    lastDispatchedJobId: undefined,
    lastDispatchedAt: undefined,
    lastCompletedJobId: undefined,
    lastEvidenceRef: undefined,
    lastCompletedEvidenceRevision: undefined,
    lastTrigger: undefined,
    pendingJobId: undefined,
    pendingReservedAt: undefined,
    uncertainJobId: undefined,
    dispatchFailureClass: undefined,
    retryAt: undefined,
    updatedAt: new Date().toISOString(),
  };
}

export function validateExternalSnapshot(raw: unknown): ExternalAutopilotSnapshot {
  if (!raw || typeof raw !== 'object') throw new Error('AUTOPILOT_SNAPSHOT_INVALID_OBJECT');
  const snapshot = raw as ExternalAutopilotSnapshot;
  if (!ALLOWED_EVIDENCE_SOURCES.has(snapshot.source)) throw new Error('AUTOPILOT_SNAPSHOT_SOURCE_MUST_BE_GITHUB_OR_CORE');
  if (!snapshot.observedAt || !Number.isFinite(Date.parse(snapshot.observedAt))) throw new Error('AUTOPILOT_SNAPSHOT_INVALID_OBSERVED_AT');
  if (!snapshot.revision?.trim()) throw new Error('AUTOPILOT_SNAPSHOT_REVISION_REQUIRED');
  const checkJob = (job: ExternalJob | undefined, label: string) => {
    if (!job) return;
    if (!job.jobId?.trim()) throw new Error(`AUTOPILOT_${label}_JOB_ID_REQUIRED`);
    if (!['NV02', 'NV03', 'NV04'].includes(job.workerId)) throw new Error(`AUTOPILOT_${label}_WORKER_INVALID`);
    if (!['P0', 'P1', 'P2'].includes(job.priority)) throw new Error(`AUTOPILOT_${label}_PRIORITY_INVALID`);
    if (!['QUEUED', 'READY', 'RUNNING', 'DONE', 'FAILED', 'BLOCKED', 'CANCELLED'].includes(job.status)) throw new Error(`AUTOPILOT_${label}_STATUS_INVALID`);
    if (typeof job.executable !== 'boolean') throw new Error(`AUTOPILOT_${label}_EXECUTABLE_MUST_BE_BOOLEAN`);
    if (job.completedAt && !Number.isFinite(Date.parse(job.completedAt))) throw new Error(`AUTOPILOT_${label}_COMPLETED_AT_INVALID`);
  };
  checkJob(snapshot.previousJob, 'PREVIOUS');
  checkJob(snapshot.nextJob, 'NEXT');
  if (snapshot.requiredWorkers && snapshot.requiredWorkers.some((id) => !['NV02', 'NV03', 'NV04'].includes(id))) throw new Error('AUTOPILOT_REQUIRED_WORKER_INVALID');
  return snapshot;
}

export function decideAutoContinue(
  snapshot: ExternalAutopilotSnapshot,
  state: DurableAutopilotState,
  nowMs = Date.now(),
  maxSnapshotAgeMs = DEFAULT_SNAPSHOT_MAX_AGE_MS,
): AutopilotDecision {
  validateExternalSnapshot(snapshot);
  const observedAtMs = Date.parse(snapshot.observedAt);
  const age = nowMs - observedAtMs;
  if (age > maxSnapshotAgeMs) return { kind: 'STOP', reason: 'SNAPSHOT_STALE' };
  if (age < -MAX_FUTURE_SKEW_MS) return { kind: 'STOP', reason: 'SNAPSHOT_FROM_FUTURE' };
  if (state.uncertainJobId && state.dispatchFailureClass === 'UNCERTAIN') return { kind: 'STOP', reason: `DISPATCH_UNCERTAIN_${state.uncertainJobId}` };
  if (state.pendingJobId) return { kind: 'BUSY', reason: `DISPATCH_PENDING_${state.pendingJobId}` };
  const previous = snapshot.previousJob;
  const next = snapshot.nextJob;
  if (state.lastDispatchedJobId) {
    if (!previous) return { kind: 'WAIT_EVIDENCE', reason: 'PREVIOUS_JOB_MISSING_FOR_LAST_DISPATCH' };
    if (previous.jobId !== state.lastDispatchedJobId) return { kind: 'STOP', reason: 'PREVIOUS_JOB_CORRELATION_MISMATCH' };
  }
  if (!next || !next.jobId?.trim()) return { kind: 'STOP', reason: 'NEXT_JOB_MISSING' };
  if (!next.executable) return { kind: 'STOP', reason: 'NEXT_JOB_NOT_EXECUTABLE' };
  if (next.status !== 'READY' && next.status !== 'QUEUED') return { kind: 'STOP', reason: `NEXT_JOB_STATUS_${next.status}` };
  if (next.riskFlags?.some((r) => DISALLOWED_RISK_FLAGS.has(r))) return { kind: 'STOP', reason: 'JOB_HAS_DISALLOWED_RISK_FLAGS' };
  if (state.lastDispatchedJobId === next.jobId) return { kind: 'STOP', reason: 'NEXT_JOB_ALREADY_DISPATCHED' };

  const dispatchFailureClass = classifyAutoContinueDispatchFailure(next.prompt || '', false);
  const retryAt = dispatchFailureClass === 'UNCERTAIN' ? nowMs + 5 * 60_000 : nowMs;

  return {
    kind: 'DISPATCH',
    trigger: AUTO_CONTINUE,
    jobId: next.jobId,
    text: next.prompt || '',
    issueRef: canonicalGithubIssueRef(next.jobId),
    evidenceRef: next.evidence?.[0]?.ref,
    evidenceRevision: next.completionRevision,
    dispatchFailureClass,
    retryAt,
  };
}