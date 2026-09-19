import type { WorkerId } from './model.js';

export const AUTO_CONTINUE = 'AUTO_CONTINUE' as const;
export const TERMINAL_JOB_STATUSES = new Set(['DONE', 'FAILED', 'BLOCKED', 'CANCELLED']);
export const EXECUTABLE_JOB_STATUSES = new Set(['QUEUED', 'READY']);
export const ALLOWED_EVIDENCE_SOURCES = new Set(['GITHUB', 'CORE']);
export const DEFAULT_SNAPSHOT_MAX_AGE_MS = 5 * 60_000;

export const KNOWN_NONDELIVERY_MARKERS = [
  'SEND_BUTTON_NOT_FOUND',
  'COMPOSER_NOT_FOUND',
] as const;

export function shouldReleaseDispatchLease(error: unknown): boolean {
  const msg = String(error);
  return KNOWN_NONDELIVERY_MARKERS.some((m) => msg.includes(m));
}

export type AutoContinueDispatchFailureClass = 'SAFE_RETRY' | 'UNCERTAIN';

export function classifyAutoContinueDispatchFailure(error: unknown, dispatchSubmitted: boolean): AutoContinueDispatchFailureClass {
  if (dispatchSubmitted) return 'UNCERTAIN';
  const message = String(error);
  return [
    'COMMAND_TIMEOUT_NOT_DELIVERED',
    'COMPOSER_NOT_FOUND',
    'SEND_BUTTON_NOT_FOUND',
    'UI_JOB_ACTIVE:',
    'UI_JOB_DUPLICATE_ACTIVE:',
  ].some((marker) => message.includes(marker)) ? 'SAFE_RETRY' : 'UNCERTAIN';
}

const MAX_FUTURE_SKEW_MS = 60_000;
const DISALLOWED_RISK_FLAGS = new Set([
  'PAID','CREDENTIAL_CHANGE','DESTRUCTIVE','PRODUCTION_RELEASE','IRREVERSIBLE','SECURITY_BOUNDARY',
  'AUTH_REQUIRED','REAUTH','CAPTCHA','RATE_LIMIT','RATE_LIMIT_429','HTTP_429','SECURITY_WARNING','SUSPICIOUS_ACTIVITY',
]);

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
}