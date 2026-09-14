import type { WorkerId } from './model.js';

export const AUTO_CONTINUE = 'AUTO_CONTINUE' as const;
export const TERMINAL_JOB_STATUSES = new Set(['DONE', 'FAILED', 'BLOCKED', 'CANCELLED']);
export const EXECUTABLE_JOB_STATUSES = new Set(['QUEUED', 'READY']);
export const ALLOWED_EVIDENCE_SOURCES = new Set(['GITHUB', 'CORE']);
const DISALLOWED_RISK_FLAGS = new Set(['PAID', 'CREDENTIAL_CHANGE', 'DESTRUCTIVE', 'PRODUCTION_RELEASE', 'IRREVERSIBLE', 'SECURITY_BOUNDARY']);

export type EvidenceSource = 'GITHUB' | 'CORE';
export type AutopilotPhase = 'IDLE' | 'BUSY' | 'WAIT_EVIDENCE' | 'STOPPED' | 'RECOVERING';
export type JobPriority = 'P0' | 'P1' | 'P2';
export type JobStatus = 'QUEUED' | 'READY' | 'RUNNING' | 'DONE' | 'FAILED' | 'BLOCKED' | 'CANCELLED';

export interface ExternalEvidence {
  source: EvidenceSource;
  ref: string;
  verifiedAt?: string;
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
  lastCompletedJobId?: string;
  lastEvidenceRef?: string;
  lastTrigger?: typeof AUTO_CONTINUE;
  updatedAt: string;
}

export type AutopilotDecision =
  | { kind: 'IDLE'; reason: string }
  | { kind: 'BUSY'; reason: string }
  | { kind: 'WAIT_EVIDENCE'; reason: string }
  | { kind: 'STOP'; reason: string }
  | { kind: 'DUPLICATE_NOOP'; reason: string; jobId: string }
  | { kind: 'DISPATCH'; trigger: typeof AUTO_CONTINUE; jobId: string; text: string; evidenceRef?: string };

function validEvidence(job: ExternalJob | undefined): ExternalEvidence[] {
  if (!job?.evidence?.length) return [];
  return job.evidence.filter((item) => ALLOWED_EVIDENCE_SOURCES.has(item.source) && Boolean(item.ref?.trim()));
}

export function validateExternalSnapshot(raw: unknown): ExternalAutopilotSnapshot {
  if (!raw || typeof raw !== 'object') throw new Error('AUTOPILOT_SNAPSHOT_INVALID_OBJECT');
  const snapshot = raw as ExternalAutopilotSnapshot;
  if (!ALLOWED_EVIDENCE_SOURCES.has(snapshot.source)) throw new Error('AUTOPILOT_SNAPSHOT_SOURCE_MUST_BE_GITHUB_OR_CORE');
  if (!snapshot.observedAt || !Number.isFinite(Date.parse(snapshot.observedAt))) throw new Error('AUTOPILOT_SNAPSHOT_INVALID_OBSERVED_AT');
  const checkJob = (job: ExternalJob | undefined, label: string) => {
    if (!job) return;
    if (!job.jobId?.trim()) throw new Error(`AUTOPILOT_${label}_JOB_ID_REQUIRED`);
    if (!['NV03', 'NV04', 'NV05'].includes(job.workerId)) throw new Error(`AUTOPILOT_${label}_WORKER_INVALID`);
    if (!['P0', 'P1', 'P2'].includes(job.priority)) throw new Error(`AUTOPILOT_${label}_PRIORITY_INVALID`);
    if (!['QUEUED', 'READY', 'RUNNING', 'DONE', 'FAILED', 'BLOCKED', 'CANCELLED'].includes(job.status)) throw new Error(`AUTOPILOT_${label}_STATUS_INVALID`);
    if (typeof job.executable !== 'boolean') throw new Error(`AUTOPILOT_${label}_EXECUTABLE_MUST_BE_BOOLEAN`);
  };
  checkJob(snapshot.previousJob, 'PREVIOUS');
  checkJob(snapshot.nextJob, 'NEXT');
  if (snapshot.requiredWorkers && snapshot.requiredWorkers.some((id) => !['NV03', 'NV04', 'NV05'].includes(id))) throw new Error('AUTOPILOT_REQUIRED_WORKER_INVALID');
  return snapshot;
}

export function decideAutoContinue(snapshot: ExternalAutopilotSnapshot, state: DurableAutopilotState): AutopilotDecision {
  validateExternalSnapshot(snapshot);
  const previous = snapshot.previousJob;
  const next = snapshot.nextJob;

  if (previous && !TERMINAL_JOB_STATUSES.has(previous.status)) return { kind: 'BUSY', reason: `PREVIOUS_JOB_${previous.status}` };

  let completionEvidence: ExternalEvidence | undefined;
  if (previous) {
    const evidence = validEvidence(previous);
    if (!evidence.length) return { kind: 'WAIT_EVIDENCE', reason: 'PREVIOUS_TERMINAL_WITHOUT_EXTERNAL_EVIDENCE' };
    completionEvidence = evidence[0];
  }

  if (!next) return { kind: 'IDLE', reason: 'NO_EXECUTABLE_JOB' };
  if (next.workerId !== 'NV05') return { kind: 'IDLE', reason: 'NEXT_JOB_NOT_NV05' };
  if (!next.executable) return { kind: 'IDLE', reason: 'NEXT_JOB_NOT_EXECUTABLE' };
  if (!['P0', 'P1'].includes(next.priority)) return { kind: 'IDLE', reason: 'NEXT_JOB_PRIORITY_NOT_ALLOWED' };
  if (!EXECUTABLE_JOB_STATUSES.has(next.status)) return { kind: 'BUSY', reason: `NEXT_JOB_${next.status}` };
  const flags = (next.riskFlags ?? []).map((flag) => String(flag).trim().toUpperCase());
  const blockedFlag = flags.find((flag) => DISALLOWED_RISK_FLAGS.has(flag));
  if (blockedFlag) return { kind: 'STOP', reason: `RISK_FLAG_${blockedFlag}` };
  if (!next.prompt?.trim()) return { kind: 'STOP', reason: 'NEXT_JOB_PROMPT_REQUIRED' };
  if (state.lastDispatchedJobId === next.jobId) return { kind: 'DUPLICATE_NOOP', reason: 'JOB_ALREADY_DISPATCHED', jobId: next.jobId };

  return {
    kind: 'DISPATCH',
    trigger: AUTO_CONTINUE,
    jobId: next.jobId,
    text: next.prompt.trim(),
    evidenceRef: completionEvidence?.ref,
  };
}

export function freshAutopilotState(now = new Date()): DurableAutopilotState {
  return { phase: 'IDLE', updatedAt: now.toISOString() };
}
