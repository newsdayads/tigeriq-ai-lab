import type { ExecutionResult, GoalPlan, GoalRequest, GoalStatus, ManagedGoalRecord, ManagedWorkRecord, ManagedWorker, PlannedWorkItem, ReviewResult, WorkHistoryEvent, WorkManagementSnapshot, WorkRole, WorkStage } from './types.js';
import { assertIso, cloneExecution, cloneGoal, cloneGoalRecord, cloneReview, cloneWorkDefinition, cloneWorkRecord, isoNow, normalizeExecutionResult, normalizeReviewResult, scopeKeysConflict, validatePlan } from './helpers.js';

export class WorkManagementStore {
  readonly #goals = new Map<string, ManagedGoalRecord>();
  readonly #goalIdempotency = new Map<string, string>();
  readonly #workToGoal = new Map<string, string>();
  #history: WorkHistoryEvent[] = [];
  #sequence = 0;

  constructor(snapshot?: WorkManagementSnapshot) {
    if (!snapshot) return;
    if (snapshot.version !== 1) throw new Error(`unsupported snapshot version ${String(snapshot.version)}`);
    this.#sequence = snapshot.sequence;
    this.#history = snapshot.history.map((event) => ({ ...event }));
    for (const raw of snapshot.goals) {
      const record = cloneGoalRecord(raw);
      validatePlan({ goal: record.goal, items: record.work.map((item) => item.work) });
      for (const item of record.work) {
        if (!Number.isInteger(item.attempts) || item.attempts < 0 || item.attempts > item.work.maxAttempts) {
          throw new Error(`invalid attempts for work ${item.work.workId} in snapshot`);
        }
        if (item.lease) {
          assertIso(item.lease.acquiredAt, 'lease acquiredAt');
          assertIso(item.lease.expiresAt, 'lease expiresAt');
        }
      }
      if (this.#goals.has(record.goal.goalId)) throw new Error(`duplicate goal ${record.goal.goalId} in snapshot`);
      const existingGoalId = this.#goalIdempotency.get(record.goal.idempotencyKey);
      if (existingGoalId && existingGoalId !== record.goal.goalId) {
        throw new Error(`duplicate idempotency key ${record.goal.idempotencyKey} in snapshot`);
      }
      this.#goals.set(record.goal.goalId, record);
      this.#goalIdempotency.set(record.goal.idempotencyKey, record.goal.goalId);
      for (const work of record.work) {
        if (this.#workToGoal.has(work.work.workId)) throw new Error(`duplicate work ${work.work.workId} in snapshot`);
        this.#workToGoal.set(work.work.workId, record.goal.goalId);
      }
    }
  }

  submit(plan: GoalPlan, at = isoNow()): ManagedGoalRecord {
    validatePlan(plan);
    const canonicalGoalId = this.#goalIdempotency.get(plan.goal.idempotencyKey);
    if (canonicalGoalId) {
      const canonical = this.#mustGetGoal(canonicalGoalId);
      if (!sameGoalRequest(canonical.goal, plan.goal) || !sameWorkPlan(canonical.work.map((item) => item.work), plan.items)) {
        throw new Error(`idempotency conflict for goal key ${plan.goal.idempotencyKey}`);
      }
      return cloneGoalRecord(canonical);
    }
    if (this.#goals.has(plan.goal.goalId)) throw new Error(`goal ${plan.goal.goalId} already exists`);
    for (const item of plan.items) {
      if (this.#workToGoal.has(item.workId)) throw new Error(`work ${item.workId} already exists in another goal`);
    }
    const record: ManagedGoalRecord = {
      goal: cloneGoal(plan.goal),
      status: 'planned',
      work: plan.items.map((item) => ({
        work: cloneWorkDefinition(item),
        stage: item.dependencies.length === 0 ? 'ready' : 'waiting_dependency',
        attempts: 0,
        executorIds: [],
        reviewerIds: [],
        judgeIds: [],
      })),
    };
    this.#goals.set(record.goal.goalId, record);
    this.#goalIdempotency.set(record.goal.idempotencyKey, record.goal.goalId);
    for (const item of record.work) this.#workToGoal.set(item.work.workId, record.goal.goalId);
    this.#event({ at, goalId: record.goal.goalId, type: 'goal_submitted', detail: `${record.work.length} work items` });
    for (const item of record.work.filter((item) => item.stage === 'ready')) {
      this.#event({ at, goalId: record.goal.goalId, workId: item.work.workId, type: 'work_ready', to: 'ready' });
    }
    this.#refreshGoalStatus(record, at);
    return cloneGoalRecord(record);
  }

  getGoal(goalId: string): ManagedGoalRecord {
    const record = this.#goals.get(goalId);
    if (!record) throw new Error(`goal ${goalId} not found`);
    return cloneGoalRecord(record);
  }

  listGoals(): ManagedGoalRecord[] {
    return [...this.#goals.values()].map(cloneGoalRecord);
  }

  getWork(workId: string): ManagedWorkRecord {
    return cloneWorkRecord(this.#mustGetWork(workId).work);
  }

  history(goalId?: string): WorkHistoryEvent[] {
    return this.#history.filter((event) => !goalId || event.goalId === goalId).map((event) => ({ ...event }));
  }

  readyWork(goalId: string, at = isoNow()): ManagedWorkRecord[] {
    this.refresh(goalId, at);
    return this.#mustGetGoal(goalId).work.filter((item) => item.stage === 'ready').map(cloneWorkRecord);
  }

  refresh(goalId: string, at = isoNow()): ManagedGoalRecord {
    const goal = this.#mustGetGoal(goalId);
    for (const record of goal.work) {
      if (record.stage !== 'waiting_dependency') continue;
      const deps = record.work.dependencies.map((id) => this.#mustGetWork(id).work);
      if (deps.some((dep) => ['failed', 'blocked', 'cancelled'].includes(dep.stage))) {
        this.#transition(goal, record, 'blocked', at, 'dependency_blocked');
      } else if (deps.every((dep) => dep.stage === 'completed')) {
        this.#transition(goal, record, 'ready', at, 'dependencies_satisfied');
      }
    }
    this.#refreshGoalStatus(goal, at);
    return cloneGoalRecord(goal);
  }

  claim(workId: string, worker: ManagedWorker, role: WorkRole, leaseMs: number, at = isoNow()): ManagedWorkRecord {
    if (!worker.online) throw new Error(`worker ${worker.workerId} is offline`);
    if (!worker.roles.includes(role)) throw new Error(`worker ${worker.workerId} cannot act as ${role}`);
    if (!Number.isFinite(leaseMs) || leaseMs < 1_000) throw new Error('leaseMs must be >= 1000');
    const { goal, work } = this.#mustGetWork(workId);
    if (!this.#workerEligible(worker, work, role)) throw new Error(`worker ${worker.workerId} is not eligible for ${workId} as ${role}`);
    if (this.#activeLeaseCount(worker.workerId, at) >= worker.concurrencyLimit) {
      throw new Error(`worker ${worker.workerId} is at concurrency limit`);
    }
    if (role === 'executor') {
      if (work.stage !== 'ready') throw new Error(`work ${workId} cannot be claimed for execution from ${work.stage}`);
      if (work.attempts >= work.work.maxAttempts) throw new Error(`work ${workId} exhausted maxAttempts`);
      if (!this.canLockScopes(workId, work.work.scopeKeys, at)) throw new Error(`scope lock conflict for work ${workId}`);
      work.attempts += 1;
      if (!work.executorIds.includes(worker.workerId)) work.executorIds.push(worker.workerId);
      this.#transition(goal, work, 'leased', at, 'executor_claimed', worker.workerId, work.attempts);
    } else if (role === 'reviewer') {
      if (work.stage !== 'reviewing') throw new Error(`work ${workId} cannot be claimed for review from ${work.stage}`);
      if (!work.reviewerIds.includes(worker.workerId)) work.reviewerIds.push(worker.workerId);
      this.#event({ at, goalId: goal.goal.goalId, workId, type: 'reviewer_claimed', actorId: worker.workerId, attempt: work.attempts });
    } else {
      if (work.stage !== 'judging') throw new Error(`work ${workId} cannot be claimed for judgment from ${work.stage}`);
      if (!work.judgeIds.includes(worker.workerId)) work.judgeIds.push(worker.workerId);
      this.#event({ at, goalId: goal.goal.goalId, workId, type: 'judge_claimed', actorId: worker.workerId, attempt: work.attempts });
    }
    work.lease = {
      role,
      workerId: worker.workerId,
      acquiredAt: at,
      expiresAt: new Date(Date.parse(at) + leaseMs).toISOString(),
    };
    this.#refreshGoalStatus(goal, at);
    return cloneWorkRecord(work);
  }

  startExecution(workId: string, workerId: string, at = isoNow()): ManagedWorkRecord {
    const { goal, work } = this.#mustGetWork(workId);
    this.#assertLease(work, workerId, 'executor', at);
    if (work.stage !== 'leased') throw new Error(`work ${workId} cannot start from ${work.stage}`);
    this.#transition(goal, work, 'running', at, 'execution_started', workerId, work.attempts);
    return cloneWorkRecord(work);
  }

  finishExecution(workId: string, workerId: string, result: ExecutionResult, at = isoNow()): ManagedWorkRecord {
    const { goal, work } = this.#mustGetWork(workId);
    this.#assertLease(work, workerId, 'executor', at);
    if (work.stage !== 'running') throw new Error(`work ${workId} cannot finish from ${work.stage}`);
    const normalized = normalizeExecutionResult(result);
    work.execution = cloneExecution(normalized);
    work.lastFailureCode = normalized.failureCode;
    work.lease = undefined;
    if (normalized.status === 'completed') {
      if (work.work.independentReview) this.#transition(goal, work, 'reviewing', at, 'execution_completed_review_required', workerId, work.attempts);
      else this.#transition(goal, work, 'completed', at, 'execution_completed', workerId, work.attempts);
    } else if ((normalized.retriable ?? false) && work.attempts < work.work.maxAttempts) {
      this.#transition(goal, work, 'ready', at, 'execution_failed_retry', workerId, work.attempts);
    } else {
      this.#transition(goal, work, 'failed', at, normalized.failureCode ?? 'execution_failed', workerId, work.attempts);
    }
    this.refresh(goal.goal.goalId, at);
    return cloneWorkRecord(work);
  }

  finishReview(workId: string, workerId: string, result: ReviewResult, at = isoNow()): ManagedWorkRecord {
    const { goal, work } = this.#mustGetWork(workId);
    this.#assertLease(work, workerId, 'reviewer', at);
    if (work.stage !== 'reviewing') throw new Error(`work ${workId} cannot finish review from ${work.stage}`);
    const normalized = normalizeReviewResult(result, 'review');
    work.review = cloneReview(normalized);
    work.lease = undefined;
    if (normalized.verdict === 'pass') {
      if (work.work.judgeRequired) this.#transition(goal, work, 'judging', at, 'review_passed_judge_required', workerId, work.attempts);
      else this.#transition(goal, work, 'completed', at, 'review_passed', workerId, work.attempts);
    } else if ((normalized.retriable ?? true) && work.attempts < work.work.maxAttempts) {
      this.#transition(goal, work, 'ready', at, `review_${normalized.verdict}_retry`, workerId, work.attempts);
    } else {
      this.#transition(goal, work, 'failed', at, `review_${normalized.verdict}`, workerId, work.attempts);
    }
    this.refresh(goal.goal.goalId, at);
    return cloneWorkRecord(work);
  }

  finishJudgment(workId: string, workerId: string, result: ReviewResult, at = isoNow()): ManagedWorkRecord {
    const { goal, work } = this.#mustGetWork(workId);
    this.#assertLease(work, workerId, 'judge', at);
    if (work.stage !== 'judging') throw new Error(`work ${workId} cannot finish judgment from ${work.stage}`);
    const normalized = normalizeReviewResult(result, 'judge');
    work.judgment = cloneReview(normalized);
    work.lease = undefined;
    if (normalized.verdict === 'pass') {
      this.#transition(goal, work, 'completed', at, 'judge_passed', workerId, work.attempts);
    } else if ((normalized.retriable ?? true) && work.attempts < work.work.maxAttempts) {
      this.#transition(goal, work, 'ready', at, `judge_${normalized.verdict}_retry`, workerId, work.attempts);
    } else {
      this.#transition(goal, work, 'failed', at, `judge_${normalized.verdict}`, workerId, work.attempts);
    }
    this.refresh(goal.goal.goalId, at);
    return cloneWorkRecord(work);
  }

  recover(at = isoNow()): ManagedGoalRecord[] {
    const now = Date.parse(at);
    for (const goal of this.#goals.values()) {
      for (const work of goal.work) {
        if (!work.lease || Date.parse(work.lease.expiresAt) > now) continue;
        const expiredRole = work.lease.role;
        const actorId = work.lease.workerId;
        work.lease = undefined;
        if (expiredRole === 'executor' && ['leased', 'running'].includes(work.stage)) {
          if (work.attempts < work.work.maxAttempts) this.#transition(goal, work, 'ready', at, 'execution_lease_expired_retry', actorId, work.attempts);
          else this.#transition(goal, work, 'failed', at, 'execution_lease_expired_exhausted', actorId, work.attempts);
        } else if (expiredRole === 'reviewer' && work.stage === 'reviewing') {
          this.#event({ at, goalId: goal.goal.goalId, workId: work.work.workId, type: 'review_lease_expired', actorId });
        } else if (expiredRole === 'judge' && work.stage === 'judging') {
          this.#event({ at, goalId: goal.goal.goalId, workId: work.work.workId, type: 'judge_lease_expired', actorId });
        }
      }
      this.refresh(goal.goal.goalId, at);
    }
    return this.listGoals();
  }

  canLockScopes(workId: string, scopeKeys: string[], at = isoNow()): boolean {
    if (scopeKeys.length === 0) return true;
    const now = Date.parse(at);
    for (const goal of this.#goals.values()) {
      for (const other of goal.work) {
        if (other.work.workId === workId || !other.lease || other.lease.role !== 'executor') continue;
        if (Date.parse(other.lease.expiresAt) <= now) continue;
        if (scopeKeys.some((left) => other.work.scopeKeys.some((right) => scopeKeysConflict(left, right)))) return false;
      }
    }
    return true;
  }

  exportSnapshot(): WorkManagementSnapshot {
    return {
      version: 1,
      sequence: this.#sequence,
      goals: this.listGoals(),
      history: this.history(),
    };
  }

  #workerEligible(worker: ManagedWorker, record: ManagedWorkRecord, role: WorkRole): boolean {
    if (!worker.roles.includes(role)) return false;
    if (record.work.allowedWorkerKinds?.length && !record.work.allowedWorkerKinds.includes(worker.kind)) return false;
    if (!record.work.requiredCapabilities.every((capability) => worker.capabilities.includes(capability))) return false;
    if (role === 'executor' && worker.allowedScopes !== undefined && record.work.scopeKeys.length) {
      if (!record.work.scopeKeys.every((scope) => worker.allowedScopes!.some((allowed) => scopeWithinAllowed(allowed, scope)))) return false;
    }
    if (role === 'executor' && (record.reviewerIds.includes(worker.workerId) || record.judgeIds.includes(worker.workerId))) return false;
    if (role === 'reviewer' && (record.executorIds.includes(worker.workerId) || record.judgeIds.includes(worker.workerId))) return false;
    if (role === 'judge' && (record.executorIds.includes(worker.workerId) || record.reviewerIds.includes(worker.workerId))) return false;
    return true;
  }

  workerEligible(worker: ManagedWorker, workId: string, role: WorkRole): boolean {
    return this.#workerEligible(worker, this.#mustGetWork(workId).work, role);
  }

  activeLeaseCount(workerId: string, at = isoNow()): number {
    return this.#activeLeaseCount(workerId, at);
  }

  #activeLeaseCount(workerId: string, at: string): number {
    const now = Date.parse(at);
    let count = 0;
    for (const goal of this.#goals.values()) {
      for (const work of goal.work) {
        if (work.lease?.workerId === workerId && Date.parse(work.lease.expiresAt) > now) count += 1;
      }
    }
    return count;
  }

  #assertLease(work: ManagedWorkRecord, workerId: string, role: WorkRole, at: string): void {
    if (!work.lease || work.lease.workerId !== workerId || work.lease.role !== role) {
      throw new Error(`work ${work.work.workId} has no ${role} lease for ${workerId}`);
    }
    if (Date.parse(work.lease.expiresAt) <= Date.parse(at)) throw new Error(`work ${work.work.workId} ${role} lease expired`);
  }

  #mustGetGoal(goalId: string): ManagedGoalRecord {
    const goal = this.#goals.get(goalId);
    if (!goal) throw new Error(`goal ${goalId} not found`);
    return goal;
  }

  #mustGetWork(workId: string): { goal: ManagedGoalRecord; work: ManagedWorkRecord } {
    const goalId = this.#workToGoal.get(workId);
    if (!goalId) throw new Error(`work ${workId} not found`);
    const goal = this.#mustGetGoal(goalId);
    const work = goal.work.find((item) => item.work.workId === workId);
    if (!work) throw new Error(`work ${workId} not found`);
    return { goal, work };
  }

  #transition(
    goal: ManagedGoalRecord,
    work: ManagedWorkRecord,
    to: WorkStage,
    at: string,
    detail: string,
    actorId?: string,
    attempt?: number,
  ): void {
    const from = work.stage;
    work.stage = to;
    this.#event({ at, goalId: goal.goal.goalId, workId: work.work.workId, type: 'work_stage', from, to, actorId, attempt, detail });
    this.#refreshGoalStatus(goal, at);
  }

  #refreshGoalStatus(goal: ManagedGoalRecord, at: string): void {
    const old = goal.status;
    const stages = goal.work.map((item) => item.stage);
    let next: GoalStatus;
    if (stages.every((stage) => stage === 'completed')) next = 'completed';
    else if (stages.some((stage) => stage === 'failed')) next = 'failed';
    else if (stages.some((stage) => stage === 'blocked')) next = 'blocked';
    else if (stages.every((stage) => ['waiting_dependency', 'ready'].includes(stage))) next = 'planned';
    else next = 'running';
    goal.status = next;
    if (old !== next) this.#event({ at, goalId: goal.goal.goalId, type: 'goal_status', from: old, to: next });
  }

  #event(input: Omit<WorkHistoryEvent, 'sequence'>): void {
    this.#sequence += 1;
    this.#history.push({ sequence: this.#sequence, ...input });
  }
}

function normalizePathScope(value: string): string {
  return value.trim().replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
}

function scopeWithinAllowed(allowed: string, requested: string): boolean {
  const root = normalizePathScope(allowed);
  const target = normalizePathScope(requested);
  if (!root || !target) return false;
  return target === root || target.startsWith(`${root}/`);
}

function sorted(values: string[]): string[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function sameGoalRequest(left: GoalRequest, right: GoalRequest): boolean {
  return JSON.stringify({
    objective: left.objective,
    priority: left.priority,
    constraints: sorted(left.constraints),
    maxParallelism: left.maxParallelism,
  }) === JSON.stringify({
    objective: right.objective,
    priority: right.priority,
    constraints: sorted(right.constraints),
    maxParallelism: right.maxParallelism,
  });
}

function workSignature(work: PlannedWorkItem): string {
  return JSON.stringify({
    workId: work.workId,
    title: work.title,
    objective: work.objective,
    dependencies: sorted(work.dependencies),
    scopeKeys: sorted(work.scopeKeys.map(normalizePathScope)),
    requiredCapabilities: sorted(work.requiredCapabilities),
    allowedWorkerKinds: work.allowedWorkerKinds ? sorted(work.allowedWorkerKinds) : undefined,
    expectedEvidence: sorted(work.expectedEvidence),
    maxAttempts: work.maxAttempts,
    independentReview: work.independentReview,
    judgeRequired: work.judgeRequired,
  });
}

function sameWorkPlan(left: PlannedWorkItem[], right: PlannedWorkItem[]): boolean {
  if (left.length !== right.length) return false;
  const a = left.map(workSignature).sort();
  const b = right.map(workSignature).sort();
  return a.every((value, index) => value === b[index]);
}
