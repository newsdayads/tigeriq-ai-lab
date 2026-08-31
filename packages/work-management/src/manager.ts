import type { ExecutionResult, GoalDecomposer, GoalRequest, ManagedGoalRecord, ManagedWorkRecord, ManagedWorker, ReviewResult, RunSummary, WorkDriver, WorkRole } from './types.js';
import type { WorkManagementStateStore } from './journal-store.js';
import { assertNonEmpty, cloneGoal, isoNow } from './helpers.js';
import { WorkManagementStore } from './store.js';

export class AutonomousWorkManager {
  readonly #workers = new Map<string, { worker: ManagedWorker; driver: WorkDriver }>();
  #checkpointChain: Promise<void> = Promise.resolve();

  constructor(
    readonly store: WorkManagementStore,
    private readonly leaseMs = 5 * 60_000,
    private readonly stateStore?: WorkManagementStateStore,
  ) {}

  registerWorker(worker: ManagedWorker, driver: WorkDriver): void {
    assertNonEmpty(worker.workerId, 'workerId');
    if (!Number.isInteger(worker.concurrencyLimit) || worker.concurrencyLimit < 1) throw new Error('worker concurrencyLimit must be >= 1');
    this.#workers.set(worker.workerId, {
      worker: {
        ...worker,
        roles: [...worker.roles],
        capabilities: [...worker.capabilities],
        allowedScopes: worker.allowedScopes ? [...worker.allowedScopes] : undefined,
      },
      driver,
    });
  }

  setWorkerOnline(workerId: string, online: boolean): void {
    const entry = this.#workers.get(workerId);
    if (!entry) throw new Error(`worker ${workerId} not registered`);
    entry.worker.online = online;
  }

  async submitGoal(goal: GoalRequest, decomposer: GoalDecomposer, at = isoNow()): Promise<ManagedGoalRecord> {
    const items = await decomposer.decompose(cloneGoal(goal));
    const record = this.store.submit({ goal, items }, at);
    await this.#checkpoint(at);
    return record;
  }

  async runUntilQuiescent(goalId: string, options: { maxCycles?: number; now?: () => string } = {}): Promise<RunSummary> {
    const maxCycles = options.maxCycles ?? 100;
    const now = options.now ?? isoNow;
    let cycles = 0;
    let lastProgress = false;

    while (cycles < maxCycles) {
      cycles += 1;
      const at = now();
      this.store.recover(at);
      this.store.refresh(goalId, at);
      await this.#checkpoint(at);
      const goal = this.store.getGoal(goalId);
      if (['completed', 'failed', 'blocked', 'cancelled'].includes(goal.status)) {
        return { goal, cycles, reason: 'terminal' };
      }

      let progressed = false;
      progressed = (await this.#runExecutions(goalId, now)) || progressed;
      progressed = (await this.#runReviews(goalId, now)) || progressed;
      progressed = (await this.#runJudgments(goalId, now)) || progressed;
      const refreshAt = now();
      this.store.refresh(goalId, refreshAt);
      await this.#checkpoint(refreshAt);
      const current = this.store.getGoal(goalId);
      if (['completed', 'failed', 'blocked', 'cancelled'].includes(current.status)) {
        return { goal: current, cycles, reason: 'terminal' };
      }
      lastProgress = progressed;
      if (!progressed) {
        const eligibilityAt = now();
        const waitingWorker = current.work.some((work) =>
          ['ready', 'reviewing', 'judging'].includes(work.stage) && !this.#hasEligibleWorker(work, work.stage === 'ready' ? 'executor' : work.stage === 'reviewing' ? 'reviewer' : 'judge', eligibilityAt),
        );
        return {
          goal: current,
          cycles,
          reason: waitingWorker ? 'waiting_worker' : 'waiting_dependency',
        };
      }
    }
    return { goal: this.store.getGoal(goalId), cycles, reason: lastProgress ? 'max_cycles' : 'waiting_dependency' };
  }

  async #runExecutions(goalId: string, now: () => string): Promise<boolean> {
    const goal = this.store.getGoal(goalId);
    const at = now();
    const alreadyActive = goal.work.filter((work) => ['leased', 'running'].includes(work.stage)).length;
    let capacity = Math.max(0, goal.goal.maxParallelism - alreadyActive);
    if (capacity === 0) return false;
    const jobs: Array<Promise<void>> = [];
    for (const work of this.store.readyWork(goalId, at)) {
      if (capacity <= 0) break;
      const selected = this.#selectWorker(work, 'executor', at);
      if (!selected) continue;
      let claimed: ManagedWorkRecord;
      try {
        const claimAt = now();
        claimed = this.store.claim(work.work.workId, selected.worker, 'executor', this.leaseMs, claimAt);
        this.store.startExecution(work.work.workId, selected.worker.workerId, claimAt);
        await this.#checkpoint(claimAt);
      } catch {
        continue;
      }
      capacity -= 1;
      jobs.push((async () => {
        const driver = selected.driver.execute;
        if (!driver) throw new Error(`worker ${selected.worker.workerId} has no execute driver`);
        let result: ExecutionResult;
        try {
          result = await driver({ goal: goal.goal, work: claimed.work, worker: selected.worker, attempt: claimed.attempts });
        } catch {
          result = {
            status: 'failed',
            conclusion: 'Execution driver threw before returning a structured result.',
            evidence: [],
            failureCode: 'WORK_DRIVER_ERROR',
            retriable: true,
          };
        }
        const finishedAt = now();
        this.store.recover(finishedAt);
        const current = this.store.getWork(work.work.workId);
        if (current.stage === 'running' && current.lease?.role === 'executor' && current.lease.workerId === selected.worker.workerId) {
          this.store.finishExecution(work.work.workId, selected.worker.workerId, result, finishedAt);
        }
        await this.#checkpoint(finishedAt);
      })());
    }
    if (!jobs.length) return false;
    await Promise.all(jobs);
    return true;
  }

  async #runReviews(goalId: string, now: () => string): Promise<boolean> {
    const goal = this.store.getGoal(goalId);
    const at = now();
    const jobs: Array<Promise<void>> = [];
    for (const work of goal.work.filter((item) => item.stage === 'reviewing')) {
      const selected = this.#selectWorker(work, 'reviewer', at);
      if (!selected || !work.execution) continue;
      try {
        const claimAt = now();
        this.store.claim(work.work.workId, selected.worker, 'reviewer', this.leaseMs, claimAt);
        await this.#checkpoint(claimAt);
      } catch {
        continue;
      }
      jobs.push((async () => {
        const driver = selected.driver.review;
        if (!driver) throw new Error(`worker ${selected.worker.workerId} has no review driver`);
        let result: ReviewResult;
        try {
          result = await driver({ goal: goal.goal, work: work.work, worker: selected.worker, attempt: work.attempts, execution: work.execution! });
        } catch {
          result = { verdict: 'needs-work', conclusion: 'Review driver failed.', evidence: [], retriable: true };
        }
        const finishedAt = now();
        this.store.recover(finishedAt);
        const current = this.store.getWork(work.work.workId);
        if (current.stage === 'reviewing' && current.lease?.role === 'reviewer' && current.lease.workerId === selected.worker.workerId) {
          this.store.finishReview(work.work.workId, selected.worker.workerId, result, finishedAt);
        }
        await this.#checkpoint(finishedAt);
      })());
    }
    if (!jobs.length) return false;
    await Promise.all(jobs);
    return true;
  }

  async #runJudgments(goalId: string, now: () => string): Promise<boolean> {
    const goal = this.store.getGoal(goalId);
    const at = now();
    const jobs: Array<Promise<void>> = [];
    for (const work of goal.work.filter((item) => item.stage === 'judging')) {
      const selected = this.#selectWorker(work, 'judge', at);
      if (!selected || !work.execution || !work.review) continue;
      try {
        const claimAt = now();
        this.store.claim(work.work.workId, selected.worker, 'judge', this.leaseMs, claimAt);
        await this.#checkpoint(claimAt);
      } catch {
        continue;
      }
      jobs.push((async () => {
        const driver = selected.driver.judge;
        if (!driver) throw new Error(`worker ${selected.worker.workerId} has no judge driver`);
        let result: ReviewResult;
        try {
          result = await driver({
            goal: goal.goal,
            work: work.work,
            worker: selected.worker,
            attempt: work.attempts,
            execution: work.execution!,
            review: work.review!,
          });
        } catch {
          result = { verdict: 'needs-work', conclusion: 'Judge driver failed.', evidence: [], retriable: true };
        }
        const finishedAt = now();
        this.store.recover(finishedAt);
        const current = this.store.getWork(work.work.workId);
        if (current.stage === 'judging' && current.lease?.role === 'judge' && current.lease.workerId === selected.worker.workerId) {
          this.store.finishJudgment(work.work.workId, selected.worker.workerId, result, finishedAt);
        }
        await this.#checkpoint(finishedAt);
      })());
    }
    if (!jobs.length) return false;
    await Promise.all(jobs);
    return true;
  }

  #hasEligibleWorker(work: ManagedWorkRecord, role: WorkRole, at: string): boolean {
    return Boolean(this.#selectWorker(work, role, at));
  }

  #selectWorker(work: ManagedWorkRecord, role: WorkRole, at: string): { worker: ManagedWorker; driver: WorkDriver } | undefined {
    const candidates = [...this.#workers.values()]
      .filter(({ worker }) => worker.online)
      .filter(({ worker }) => this.store.workerEligible(worker, work.work.workId, role))
      .filter(({ worker }) => this.store.activeLeaseCount(worker.workerId, at) < worker.concurrencyLimit)
      .filter(({ driver }) => role === 'executor' ? Boolean(driver.execute) : role === 'reviewer' ? Boolean(driver.review) : Boolean(driver.judge))
      .sort((a, b) => {
        if (role === 'executor') {
          const aUsed = work.executorIds.includes(a.worker.workerId) ? 1 : 0;
          const bUsed = work.executorIds.includes(b.worker.workerId) ? 1 : 0;
          if (aUsed !== bUsed) return aUsed - bUsed;
        }
        const load = this.store.activeLeaseCount(a.worker.workerId, at) - this.store.activeLeaseCount(b.worker.workerId, at);
        return load || a.worker.workerId.localeCompare(b.worker.workerId);
      });
    return candidates[0];
  }

  async #checkpoint(at: string): Promise<void> {
    if (!this.stateStore) return;
    const snapshot = this.store.exportSnapshot();
    this.#checkpointChain = this.#checkpointChain.then(() => this.stateStore!.save(snapshot, at));
    await this.#checkpointChain;
  }
}
