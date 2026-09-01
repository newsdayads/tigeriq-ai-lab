import type { EvidenceRef, ExecutionResult, GoalPlan, GoalRequest, ManagedGoalRecord, ManagedWorkRecord, PlannedWorkItem, ReviewResult } from './types.js';

export function assertNonEmpty(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

export function isoNow(): string {
  return new Date().toISOString();
}

export function assertIso(value: string, name: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${name} must be an ISO date`);
}

export function cloneEvidence(value: EvidenceRef[]): EvidenceRef[] {
  return value.map((item) => ({ ...item }));
}

export function validateEvidence(value: EvidenceRef[]): void {
  for (const item of value) {
    assertNonEmpty(item.ref, 'evidence ref');
    if (item.sha256 && !/^[a-f0-9]{64}$/i.test(item.sha256)) throw new Error('evidence sha256 must be 64 hex characters');
  }
}

export function normalizeExecutionResult(result: ExecutionResult): ExecutionResult {
  try {
    assertNonEmpty(result.conclusion, 'execution conclusion');
    validateEvidence(result.evidence);
  } catch (error) {
    return {
      status: 'failed',
      conclusion: `Execution returned an invalid structured result: ${error instanceof Error ? error.message : String(error)}`,
      evidence: [],
      failureCode: 'INVALID_RESULT',
      retriable: true,
    };
  }
  if (result.status === 'completed' && result.evidence.length === 0) {
    return {
      status: 'failed',
      conclusion: 'Execution returned no verifiable evidence.',
      evidence: [],
      failureCode: 'EVIDENCE_MISSING',
      retriable: true,
    };
  }
  return { ...result, evidence: cloneEvidence(result.evidence) };
}

export function normalizeReviewResult(result: ReviewResult, role: 'review' | 'judge'): ReviewResult {
  try {
    assertNonEmpty(result.conclusion, `${role} conclusion`);
    validateEvidence(result.evidence);
  } catch (error) {
    return {
      verdict: 'needs-work',
      conclusion: `${role} returned an invalid structured result: ${error instanceof Error ? error.message : String(error)}`,
      evidence: [],
      retriable: true,
    };
  }
  if (result.verdict === 'pass' && result.evidence.length === 0) {
    return {
      verdict: 'needs-work',
      conclusion: `${role} returned PASS without verifiable evidence.`,
      evidence: [],
      retriable: true,
    };
  }
  return { ...result, evidence: cloneEvidence(result.evidence) };
}

export function cloneExecution(value: ExecutionResult | undefined): ExecutionResult | undefined {
  return value ? { ...value, evidence: cloneEvidence(value.evidence) } : undefined;
}

export function cloneReview(value: ReviewResult | undefined): ReviewResult | undefined {
  return value ? { ...value, evidence: cloneEvidence(value.evidence) } : undefined;
}

export function cloneWorkDefinition(work: PlannedWorkItem): PlannedWorkItem {
  return {
    ...work,
    dependencies: [...work.dependencies],
    scopeKeys: [...work.scopeKeys],
    requiredCapabilities: [...work.requiredCapabilities],
    allowedWorkerKinds: work.allowedWorkerKinds ? [...work.allowedWorkerKinds] : undefined,
    expectedEvidence: [...work.expectedEvidence],
  };
}

export function cloneWorkRecord(record: ManagedWorkRecord): ManagedWorkRecord {
  return {
    ...record,
    work: cloneWorkDefinition(record.work),
    executorIds: [...record.executorIds],
    reviewerIds: [...record.reviewerIds],
    judgeIds: [...record.judgeIds],
    lease: record.lease ? { ...record.lease } : undefined,
    execution: cloneExecution(record.execution),
    review: cloneReview(record.review),
    judgment: cloneReview(record.judgment),
  };
}

export function cloneGoal(goal: GoalRequest): GoalRequest {
  return { ...goal, constraints: [...goal.constraints] };
}

export function cloneGoalRecord(record: ManagedGoalRecord): ManagedGoalRecord {
  return { goal: cloneGoal(record.goal), status: record.status, work: record.work.map(cloneWorkRecord) };
}

export function normalizeScope(scope: string): string {
  const normalized = scope.trim().replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
  if (!normalized || normalized.startsWith('/') || /^[a-z]:\//.test(normalized)) return '';
  const segments = normalized.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return '';
  return segments.join('/');
}

export function scopeKeysConflict(left: string, right: string): boolean {
  const a = normalizeScope(left);
  const b = normalizeScope(right);
  // Invalid scopes fail closed: they must never be treated as safely parallel.
  if (!a || !b) return true;
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

export function validateGoal(goal: GoalRequest): void {
  assertNonEmpty(goal.goalId, 'goalId');
  assertNonEmpty(goal.idempotencyKey, 'idempotencyKey');
  assertNonEmpty(goal.objective, 'objective');
  assertIso(goal.createdAt, 'createdAt');
  if (!Number.isInteger(goal.maxParallelism) || goal.maxParallelism < 1 || goal.maxParallelism > 100) {
    throw new Error('maxParallelism must be between 1 and 100');
  }
}

export function validateWorkItem(work: PlannedWorkItem): void {
  assertNonEmpty(work.workId, 'workId');
  assertNonEmpty(work.title, 'title');
  assertNonEmpty(work.objective, 'objective');
  for (const scope of work.scopeKeys) {
    if (!normalizeScope(scope)) throw new Error(`work ${work.workId} has invalid scopeKey ${scope}`);
  }
  if (!Number.isInteger(work.maxAttempts) || work.maxAttempts < 1 || work.maxAttempts > 10) {
    throw new Error(`work ${work.workId} maxAttempts must be between 1 and 10`);
  }
  if (work.expectedEvidence.length === 0) throw new Error(`work ${work.workId} expectedEvidence is required`);
  if (work.judgeRequired && !work.independentReview) {
    throw new Error(`work ${work.workId} cannot require judge without independent review`);
  }
}

export function validatePlan(plan: GoalPlan): void {
  validateGoal(plan.goal);
  if (plan.items.length === 0) throw new Error('goal plan requires at least one work item');
  const ids = new Set<string>();
  for (const work of plan.items) {
    validateWorkItem(work);
    if (ids.has(work.workId)) throw new Error(`duplicate workId ${work.workId}`);
    ids.add(work.workId);
  }
  for (const work of plan.items) {
    for (const dep of work.dependencies) {
      if (!ids.has(dep)) throw new Error(`work ${work.workId} dependency ${dep} not found`);
      if (dep === work.workId) throw new Error(`work ${work.workId} cannot depend on itself`);
    }
  }
  const byId = new Map(plan.items.map((item) => [item.workId, item]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (workId: string): void => {
    if (visited.has(workId)) return;
    if (visiting.has(workId)) throw new Error(`dependency cycle detected at ${workId}`);
    visiting.add(workId);
    for (const dep of byId.get(workId)?.dependencies ?? []) visit(dep);
    visiting.delete(workId);
    visited.add(workId);
  };
  for (const work of plan.items) visit(work.workId);
}
