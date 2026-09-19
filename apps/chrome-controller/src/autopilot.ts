import type { WorkerId } from './model.js';
import type { DispatchLease } from './dispatch-lease.js';

export const AUTO_CONTINUE = 'AUTO_CONTINUE' as const;
export const TERMINAL_JOB_STATUSES = new Set(['DONE', 'FAILED', 'BLOCKED', 'CANCELLED']);
export const EXECUTABLE_JOB_STATUSES = new Set(['QUEUED', 'READY']);
export const ALLOWED_EVIDENCE_SOURCES = new Set(['GITHUB', 'CORE']);
export const DEFAULT_SNAPSHOT_MAX_AGE_MS = 5 * 60_000;
export type AutoContinueDispatchFailureClass = 'SAFE_RETRY' | 'UNCERTAIN';
export function classifyAutoContinueDispatchFailure(error:unknown,dispatchSubmitted:boolean):AutoContinueDispatchFailureClass {
  if(dispatchSubmitted)return 'UNCERTAIN';
  const message=String(error);
  return [
    'COMMAND_TIMEOUT_NOT_DELIVERED',
    'COMPOSER_NOT_FOUND',
    'SEND_BUTTON_NOT_FOUND',
    'UI_JOB_ACTIVE:',
    'UI_JOB_DUPLICATE_ACTIVE:',
  ].some((marker)=>message.includes(marker))?'SAFE_RETRY':'UNCERTAIN';
}
export function canResetOrphanUnpersistedDispatch(
  uncertainJobId:string|undefined,
  ledgerRecordPresent:boolean,
  lease:DispatchLease|undefined,
  nowMs:number,
):boolean {
  if(!uncertainJobId||ledgerRecordPresent||!lease||lease.jobId!==uncertainJobId||lease.state!=='DISPATCHING')return false;
  const expiry=Date.parse(lease.expiresAt);
  return Number.isFinite(expiry)&&expiry<=nowMs;
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
  retryAt?: string;
  updatedAt: string;
}
export type AutopilotDecision =
  | { kind: 'IDLE'; reason: string }
  | { kind: 'BUSY'; reason: string }
  | { kind: 'WAIT_EVIDENCE'; reason: string }
  | { kind: 'STOP'; reason: string }
  | { kind: 'DUPLICATE_NOOP'; reason: string; jobId: string }
  | { kind: 'DISPATCH'; trigger: typeof AUTO_CONTINUE; jobId: string; text: string; issueRef?: string; evidenceRef?: string; evidenceRevision?: string };

function parsed(value:string|undefined):number|undefined {
  if(!value)return;
  const ms=Date.parse(value);return Number.isFinite(ms)?ms:undefined;
}

export function canonicalGithubIssueRef(jobId:string):string|undefined {
  const match=String(jobId||'').trim().match(/^GH-(\d+)$/);
  if(!match)return;
  return `https://github.com/newsdayads/tigeriq-ai-lab/issues/${match[1]}`;
}

export function selectFreshCompletionEvidence(job:ExternalJob|undefined,state:DurableAutopilotState,observedAtMs:number):ExternalEvidence|undefined {
  if(!job?.evidence?.length)return;
  if(state.lastDispatchedJobId!==job.jobId)return;
  const dispatchedAt=parsed(state.lastDispatchedAt);
  if(dispatchedAt===undefined)return;
  return job.evidence.find((item)=>{
    if(!ALLOWED_EVIDENCE_SOURCES.has(item.source)||!item.ref?.trim()||!item.verifiedAt||!item.completedAt||!item.jobId||!item.completionRevision?.trim())return false;
    if(item.jobId!==job.jobId)return false;
    if(job.completionRevision&&item.completionRevision!==job.completionRevision)return false;
    if(job.completedAt&&item.completedAt!==job.completedAt)return false;
    const completedAt=parsed(item.completedAt),verifiedAt=parsed(item.verifiedAt);
    if(completedAt===undefined||verifiedAt===undefined)return false;
    if(verifiedAt<completedAt||verifiedAt>observedAtMs+MAX_FUTURE_SKEW_MS)return false;
    if(dispatchedAt!==undefined&&completedAt<dispatchedAt)return false;
    if(state.lastCompletedEvidenceRevision===item.completionRevision&&state.lastCompletedJobId!==job.jobId)return false;
    return true;
  });
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
    if(job.completedAt&&!Number.isFinite(Date.parse(job.completedAt)))throw new Error(`AUTOPILOT_${label}_COMPLETED_AT_INVALID`);
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
  gpt56SolHighVerified = true,
): AutopilotDecision {
  if (!gpt56SolHighVerified) return { kind: 'STOP', reason: 'GPT_5_6_SOL_HIGH_PROFILE_UNVERIFIED' };
  validateExternalSnapshot(snapshot);
  const observedAtMs = Date.parse(snapshot.observedAt);
  const age = nowMs - observedAtMs;
  if (age > maxSnapshotAgeMs) return { kind: 'STOP', reason: 'SNAPSHOT_STALE' };
  if (age < -MAX_FUTURE_SKEW_MS) return { kind: 'STOP', reason: 'SNAPSHOT_FROM_FUTURE' };
  if (state.uncertainJobId) return { kind: 'STOP', reason: `DISPATCH_UNCERTAIN_${state.uncertainJobId}` };
  if (state.pendingJobId) return { kind: 'BUSY', reason: `DISPATCH_PENDING_${state.pendingJobId}` };
  const previous = snapshot.previousJob;
  const next = snapshot.nextJob;
  if (state.lastDispatchedJobId) {
    if (!previous) return { kind: 'WAIT_EVIDENCE', reason: 'PREVIOUS_JOB_MISSING_FOR_LAST_DISPATCH' };
    if (previous.jobId !== state.lastDispatchedJobId) return { kind: 'STOP', reason: 'PREVIOUS_JOB_CORRELATION_MISMATCH' };
  }
  if (previous && !TERMINAL_JOB_STATUSES.has(previous.status)) return { kind: 'BUSY', reason: `PREVIOUS_JOB_${previous.status}` };
  if (previous && ['FAILED', 'BLOCKED', 'CANCELLED'].includes(previous.status)) return { kind: 'STOP', reason: `PREVIOUS_JOB_${previous.status}` };

  let completionEvidence: ExternalEvidence | undefined;
  if (previous) {
    completionEvidence = selectFreshCompletionEvidence(previous,state,observedAtMs);
    if (!completionEvidence) return { kind: 'WAIT_EVIDENCE', reason: 'PREVIOUS_DONE_WITHOUT_FRESH_JOB_CORRELATED_EVIDENCE' };
  }

  if (!next) return { kind: 'IDLE', reason: 'NO_EXECUTABLE_JOB' };
  if (previous?.jobId === next.jobId) return { kind: 'STOP', reason: 'NEXT_JOB_EQUALS_PREVIOUS_JOB' };
  if (next.workerId !== 'NV02') return { kind: 'IDLE', reason: 'NEXT_JOB_NOT_NV02' };
  if (!next.executable) return { kind: 'IDLE', reason: 'NEXT_JOB_NOT_EXECUTABLE' };
  if (!['P0', 'P1'].includes(next.priority)) return { kind: 'IDLE', reason: 'NEXT_JOB_PRIORITY_NOT_ALLOWED' };
  if (!EXECUTABLE_JOB_STATUSES.has(next.status)) return { kind: 'BUSY', reason: `NEXT_JOB_${next.status}` };
  const flags = (next.riskFlags ?? []).map((flag) => String(flag).trim().toUpperCase());
  const blockedFlag = flags.find((flag) => DISALLOWED_RISK_FLAGS.has(flag));
  if (blockedFlag) return { kind: 'STOP', reason: `RISK_FLAG_${blockedFlag}` };
  if (!next.prompt?.trim()) return { kind: 'STOP', reason: 'NEXT_JOB_PROMPT_REQUIRED' };
  if (state.lastDispatchedJobId === next.jobId) return { kind: 'DUPLICATE_NOOP', reason: 'JOB_ALREADY_DISPATCHED', jobId: next.jobId };

  const currentIssueRef=snapshot.source==='GITHUB'?canonicalGithubIssueRef(next.jobId):undefined;
  return {
    kind:'DISPATCH',
    trigger:AUTO_CONTINUE,
    jobId:next.jobId,
    text:next.prompt.trim(),
    ...(currentIssueRef?{issueRef:currentIssueRef}:{}),
    evidenceRef:completionEvidence?.ref,
    evidenceRevision:completionEvidence?.completionRevision,
  };
}

export function freshAutopilotState(now = new Date()): DurableAutopilotState {
  return { phase: 'IDLE', updatedAt: now.toISOString() };
}
