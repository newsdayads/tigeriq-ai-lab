import type { EvidenceArtifact, TaskPacket, TaskPriority, Verdict, WorkerResult } from '../../../packages/workforce/src/index.js';
import { validateTaskPacket } from '../../../packages/workforce/src/index.js';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_object');
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number): string {
  return typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : '';
}
function strings(value: unknown, maxItems = 32): string[] {
  if (!Array.isArray(value) || value.length > maxItems) throw new Error('invalid_string_list');
  const out = value.map((item) => text(item, 256));
  if (out.some((item) => !item)) throw new Error('invalid_string_list');
  return out;
}
function iso(value: unknown): string {
  const out = text(value, 64);
  if (!out || !Number.isFinite(Date.parse(out))) throw new Error('invalid_date');
  return out;
}

export function parseTaskPacket(value: unknown): TaskPacket {
  const data = record(value);
  const priority = text(data.priority, 2) as TaskPriority;
  if (!['P0', 'P1', 'P2', 'P3'].includes(priority)) throw new Error('invalid_priority');
  if (!Array.isArray(data.inputs) || data.inputs.length > 32) throw new Error('invalid_inputs');
  const inputs = data.inputs.map((item) => {
    const input = record(item);
    const name = text(input.name, 128);
    if (!name) throw new Error('invalid_input');
    return { name, value: input.value };
  });
  const policy = record(data.reviewPolicy);
  if (typeof policy.independentReview !== 'boolean' || typeof policy.judgeRequired !== 'boolean' || typeof policy.preferProviderDiversity !== 'boolean') {
    throw new Error('invalid_review_policy');
  }
  const task: TaskPacket = {
    taskId: text(data.taskId, 128),
    idempotencyKey: text(data.idempotencyKey, 256),
    objective: text(data.objective, 4000),
    department: text(data.department, 128) || undefined,
    team: text(data.team, 128) || undefined,
    priority,
    requiredCapabilities: strings(data.requiredCapabilities),
    constraints: strings(data.constraints),
    inputs,
    expectedArtifacts: strings(data.expectedArtifacts),
    deadline: iso(data.deadline),
    maxAttempts: typeof data.maxAttempts === 'number' && Number.isInteger(data.maxAttempts) ? data.maxAttempts : 0,
    reviewPolicy: {
      independentReview: policy.independentReview,
      judgeRequired: policy.judgeRequired,
      preferProviderDiversity: policy.preferProviderDiversity,
    },
  };
  validateTaskPacket(task);
  return task;
}

export function parseWorkerResult(value: unknown): WorkerResult {
  const data = record(value);
  const status = text(data.status, 16);
  if (status !== 'completed' && status !== 'failed') throw new Error('invalid_result_status');
  const confidence = typeof data.confidence === 'number' && Number.isFinite(data.confidence) ? data.confidence : -1;
  if (confidence < 0 || confidence > 1) throw new Error('invalid_confidence');
  const verdictText = text(data.verdict, 16);
  if (verdictText && !['pass', 'fail', 'needs-work'].includes(verdictText)) throw new Error('invalid_verdict');
  if (!Array.isArray(data.artifacts) || data.artifacts.length > 32) throw new Error('invalid_artifacts');
  const artifacts: EvidenceArtifact[] = data.artifacts.map((item) => {
    const artifact = record(item);
    const kind = text(artifact.kind, 16) as EvidenceArtifact['kind'];
    if (!['text', 'json', 'screenshot', 'log', 'commit', 'url'].includes(kind)) throw new Error('invalid_artifact_kind');
    const ref = text(artifact.ref, 2048);
    if (!ref) throw new Error('invalid_artifact_ref');
    return {
      kind,
      ref,
      summary: text(artifact.summary, 1000) || undefined,
      sha256: text(artifact.sha256, 128) || undefined,
    };
  });
  let failure: WorkerResult['failure'];
  if (data.failure !== undefined && data.failure !== null) {
    const raw = record(data.failure);
    const code = text(raw.code, 128);
    const message = text(raw.message, 2000);
    if (!code || !message || typeof raw.retriable !== 'boolean') throw new Error('invalid_failure');
    failure = { code, message, retriable: raw.retriable };
  }
  if (status === 'failed' && !failure) throw new Error('failed_result_requires_failure');
  return {
    taskId: text(data.taskId, 128),
    employeeId: text(data.employeeId, 128),
    status,
    conclusion: text(data.conclusion, 4000),
    confidence,
    verdict: verdictText ? verdictText as Verdict : undefined,
    artifacts,
    risks: strings(data.risks),
    completedAt: iso(data.completedAt),
    failure,
  };
}
