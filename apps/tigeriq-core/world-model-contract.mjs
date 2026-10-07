import { createHash } from 'node:crypto';

export const WORLD_MODEL_KINDS = Object.freeze(['OBJECTIVE', 'TASK', 'RESOURCE', 'EVENT']);
export const PRIORITIES = Object.freeze(['P0', 'P1', 'P2', 'P3', 'P4', 'P5']);

function fail(code) {
  const error = new TypeError(code);
  error.code = code;
  throw error;
}

function object(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  return value;
}

function text(value, code, { nullable = false } = {}) {
  if ((value === null || value === undefined) && nullable) return null;
  const out = String(value ?? '').trim();
  if (!out) fail(code);
  return out;
}

function token(value, code, options = {}) {
  const out = text(value, code, options);
  if (out === null) return null;
  if (!/^[A-Za-z0-9._:/-]{1,180}$/.test(out)) fail(code);
  return out;
}

function priority(value) {
  const out = String(value ?? '').trim().toUpperCase();
  if (!PRIORITIES.includes(out)) fail('WORLD_MODEL_PRIORITY_INVALID');
  return out;
}

function stringList(value, code) {
  if (!Array.isArray(value)) fail(code);
  const out = value.map(item => text(item, code));
  if (new Set(out).size !== out.length) fail(code);
  return out;
}

function iso(value, code, { nullable = false } = {}) {
  if ((value === null || value === undefined || value === '') && nullable) return null;
  const out = text(value, code);
  if (!Number.isFinite(Date.parse(out))) fail(code);
  return new Date(out).toISOString();
}

function number(value, code, { min = -Infinity, max = Infinity, nullable = false } = {}) {
  if ((value === null || value === undefined) && nullable) return null;
  const out = Number(value);
  if (!Number.isFinite(out) || out < min || out > max) fail(code);
  return out;
}

function integer(value, code, { min = -Infinity, max = Infinity } = {}) {
  const out = number(value, code, { min, max });
  if (!Number.isInteger(out)) fail(code);
  return out;
}

function stableHash(parts) {
  return createHash('sha256')
    .update(parts.map(part => String(part ?? '').trim()).join('\u001f'))
    .digest('hex');
}

export function normalizeObjective(input = {}) {
  const row = object(input, 'WORLD_MODEL_OBJECTIVE_INVALID');
  return Object.freeze({
    id: token(row.id, 'WORLD_MODEL_OBJECTIVE_ID_INVALID'),
    priority: priority(row.priority),
    goal: text(row.goal, 'WORLD_MODEL_OBJECTIVE_GOAL_INVALID'),
    state: token(row.state, 'WORLD_MODEL_OBJECTIVE_STATE_INVALID'),
    owner_gate: token(row.owner_gate, 'WORLD_MODEL_OBJECTIVE_OWNER_GATE_INVALID', { nullable: true }),
    source_revision: token(row.source_revision, 'WORLD_MODEL_OBJECTIVE_SOURCE_REVISION_INVALID'),
  });
}

export function normalizeRetryPolicy(input = {}) {
  const row = object(input, 'WORLD_MODEL_RETRY_POLICY_INVALID');
  const maxAttempts = integer(row.max_attempts, 'WORLD_MODEL_RETRY_MAX_ATTEMPTS_INVALID', { min: 1, max: 20 });
  const sameSignatureLimit = integer(
    row.same_signature_limit ?? 1,
    'WORLD_MODEL_RETRY_SAME_SIGNATURE_LIMIT_INVALID',
    { min: 0, max: maxAttempts },
  );
  return Object.freeze({
    max_attempts: maxAttempts,
    same_signature_limit: sameSignatureLimit,
    backoff_ms: integer(row.backoff_ms ?? 0, 'WORLD_MODEL_RETRY_BACKOFF_INVALID', { min: 0, max: 86_400_000 }),
  });
}

export function normalizeTask(input = {}) {
  const row = object(input, 'WORLD_MODEL_TASK_INVALID');
  const id = token(row.id, 'WORLD_MODEL_TASK_ID_INVALID');
  const dependencies = stringList(row.dependencies ?? [], 'WORLD_MODEL_TASK_DEPENDENCIES_INVALID')
    .map(value => token(value, 'WORLD_MODEL_TASK_DEPENDENCIES_INVALID'));
  if (dependencies.includes(id)) fail('WORLD_MODEL_TASK_SELF_DEPENDENCY');
  return Object.freeze({
    id,
    objective_id: token(row.objective_id, 'WORLD_MODEL_TASK_OBJECTIVE_ID_INVALID'),
    title: text(row.title, 'WORLD_MODEL_TASK_TITLE_INVALID'),
    state: token(row.state, 'WORLD_MODEL_TASK_STATE_INVALID'),
    priority: priority(row.priority),
    dependencies: Object.freeze(dependencies),
    capability: token(row.capability, 'WORLD_MODEL_TASK_CAPABILITY_INVALID'),
    skills: Object.freeze(stringList(row.skills ?? [], 'WORLD_MODEL_TASK_SKILLS_INVALID')),
    resource_scope: token(row.resource_scope, 'WORLD_MODEL_TASK_RESOURCE_SCOPE_INVALID'),
    acceptance: Object.freeze(stringList(row.acceptance ?? [], 'WORLD_MODEL_TASK_ACCEPTANCE_INVALID')),
    evidence_required: Object.freeze(stringList(row.evidence_required ?? [], 'WORLD_MODEL_TASK_EVIDENCE_INVALID')),
    blocked_reason: text(row.blocked_reason, 'WORLD_MODEL_TASK_BLOCKED_REASON_INVALID', { nullable: true }),
    retry_policy: normalizeRetryPolicy(row.retry_policy),
    estimated_effort_class: token(row.estimated_effort_class, 'WORLD_MODEL_TASK_EFFORT_INVALID'),
    concurrency_group: token(row.concurrency_group, 'WORLD_MODEL_TASK_CONCURRENCY_GROUP_INVALID', { nullable: true }),
    assigned_resource: token(row.assigned_resource, 'WORLD_MODEL_TASK_ASSIGNED_RESOURCE_INVALID', { nullable: true }),
    checkpoint_id: token(row.checkpoint_id, 'WORLD_MODEL_TASK_CHECKPOINT_ID_INVALID', { nullable: true }),
    last_progress_at: iso(row.last_progress_at, 'WORLD_MODEL_TASK_LAST_PROGRESS_INVALID', { nullable: true }),
  });
}

export function normalizeResource(input = {}) {
  const row = object(input, 'WORLD_MODEL_RESOURCE_INVALID');
  const capability = Array.isArray(row.capability)
    ? Object.freeze(stringList(row.capability, 'WORLD_MODEL_RESOURCE_CAPABILITY_INVALID'))
    : Object.freeze([token(row.capability, 'WORLD_MODEL_RESOURCE_CAPABILITY_INVALID')]);
  const currentLease = row.current_lease == null ? null : object(row.current_lease, 'WORLD_MODEL_RESOURCE_LEASE_INVALID');
  return Object.freeze({
    id: token(row.id, 'WORLD_MODEL_RESOURCE_ID_INVALID'),
    health: token(row.health, 'WORLD_MODEL_RESOURCE_HEALTH_INVALID'),
    capability,
    skills: Object.freeze(stringList(row.skills ?? [], 'WORLD_MODEL_RESOURCE_SKILLS_INVALID')),
    quota: number(row.quota, 'WORLD_MODEL_RESOURCE_QUOTA_INVALID', { min: 0, nullable: true }),
    latency_ms: number(row.latency_ms, 'WORLD_MODEL_RESOURCE_LATENCY_INVALID', { min: 0, nullable: true }),
    success_rate: number(row.success_rate, 'WORLD_MODEL_RESOURCE_SUCCESS_RATE_INVALID', { min: 0, max: 1, nullable: true }),
    current_lease: currentLease === null ? null : Object.freeze({
      lease_id: token(currentLease.lease_id, 'WORLD_MODEL_RESOURCE_LEASE_ID_INVALID'),
      resource_scope: token(currentLease.resource_scope, 'WORLD_MODEL_RESOURCE_LEASE_SCOPE_INVALID'),
      expires_at: iso(currentLease.expires_at, 'WORLD_MODEL_RESOURCE_LEASE_EXPIRES_INVALID'),
    }),
    current_work: token(row.current_work, 'WORLD_MODEL_RESOURCE_CURRENT_WORK_INVALID', { nullable: true }),
  });
}

export function normalizeEvent(input = {}) {
  const row = object(input, 'WORLD_MODEL_EVENT_INVALID');
  return Object.freeze({
    id: token(row.id, 'WORLD_MODEL_EVENT_ID_INVALID'),
    objective_id: token(row.objective_id, 'WORLD_MODEL_EVENT_OBJECTIVE_ID_INVALID'),
    task_id: token(row.task_id, 'WORLD_MODEL_EVENT_TASK_ID_INVALID', { nullable: true }),
    from_state: token(row.from_state, 'WORLD_MODEL_EVENT_FROM_STATE_INVALID', { nullable: true }),
    to_state: token(row.to_state, 'WORLD_MODEL_EVENT_TO_STATE_INVALID'),
    evidence: Object.freeze(stringList(row.evidence ?? [], 'WORLD_MODEL_EVENT_EVIDENCE_INVALID')),
    source: token(row.source, 'WORLD_MODEL_EVENT_SOURCE_INVALID'),
    occurred_at: iso(row.occurred_at, 'WORLD_MODEL_EVENT_OCCURRED_AT_INVALID'),
  });
}

export function normalizeWorldModelRecord(kind, input) {
  const normalizedKind = String(kind ?? '').trim().toUpperCase();
  if (normalizedKind === 'OBJECTIVE') return normalizeObjective(input);
  if (normalizedKind === 'TASK') return normalizeTask(input);
  if (normalizedKind === 'RESOURCE') return normalizeResource(input);
  if (normalizedKind === 'EVENT') return normalizeEvent(input);
  fail('WORLD_MODEL_KIND_INVALID');
}

export function stableObjectiveThreadId(objectiveId) {
  return `tiq-objective-${stableHash(['thread-v1', token(objectiveId, 'WORLD_MODEL_OBJECTIVE_ID_INVALID')]).slice(0, 24)}`;
}

export function stableRunId({ objective_id, source_revision, plan_revision = '0' } = {}) {
  return `tiq-run-${stableHash([
    'run-v1',
    token(objective_id, 'WORLD_MODEL_OBJECTIVE_ID_INVALID'),
    token(source_revision, 'WORLD_MODEL_OBJECTIVE_SOURCE_REVISION_INVALID'),
    token(plan_revision, 'WORLD_MODEL_PLAN_REVISION_INVALID'),
  ]).slice(0, 24)}`;
}

export function buildCheckpointMetadata({
  objective_id,
  run_id,
  checkpoint_id,
  sequence,
  source_revision,
  created_at,
} = {}) {
  return Object.freeze({
    objective_id: token(objective_id, 'WORLD_MODEL_CHECKPOINT_OBJECTIVE_ID_INVALID'),
    run_id: token(run_id, 'WORLD_MODEL_CHECKPOINT_RUN_ID_INVALID'),
    checkpoint_id: token(checkpoint_id, 'WORLD_MODEL_CHECKPOINT_ID_INVALID'),
    sequence: integer(sequence, 'WORLD_MODEL_CHECKPOINT_SEQUENCE_INVALID', { min: 0 }),
    source_revision: token(source_revision, 'WORLD_MODEL_CHECKPOINT_SOURCE_REVISION_INVALID'),
    created_at: iso(created_at, 'WORLD_MODEL_CHECKPOINT_CREATED_AT_INVALID'),
  });
}

export function sideEffectIdempotencyKey({
  objective_id,
  task_id,
  effect,
  source_revision,
} = {}) {
  return `tiq-idem-v1-${stableHash([
    token(objective_id, 'WORLD_MODEL_OBJECTIVE_ID_INVALID'),
    token(task_id, 'WORLD_MODEL_TASK_ID_INVALID'),
    token(effect, 'WORLD_MODEL_EFFECT_INVALID'),
    token(source_revision, 'WORLD_MODEL_OBJECTIVE_SOURCE_REVISION_INVALID'),
  ])}`;
}
