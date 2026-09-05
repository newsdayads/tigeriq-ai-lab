import type { TaskPacket, TaskRuntimeRecord, WorkerResult } from './index.js';
import type { DurableWorkforceRuntime } from './runtime.js';
import { DurableTaskMailbox, type TaskLease } from './task-mailbox.js';
import {
  parseAutonomyPolicy,
  planBlockedWork,
  planNearEmptyAudit,
  safeCandidateFromTask,
  type BlockedWorkPlan,
  type BlockerKind,
  type SelfAuditFinding,
} from './autonomy.js';
import { DurableAutonomyStore, type BlockedWorkRecord } from './autonomy-store.js';

export interface RemoteTaskLease extends TaskLease {
  employeeId: string;
}

export interface BlockedResultContext {
  blocker: Exclude<BlockerKind, 'unknown'>;
  dependencyKey?: string;
  mutationInFlight: boolean;
}

export interface AcceptedBlockedResult {
  result: WorkerResult;
  plan: BlockedWorkPlan;
}

export interface NearEmptyAuditProposal {
  finding: SelfAuditFinding;
  task: TaskPacket;
}

export interface NearEmptyAuditContext {
  nodeId: string;
  eligibleWorkCount: number;
  primaryWaiting: boolean;
}

export interface NearEmptyAuditProvider {
  inspect(context: NearEmptyAuditContext): Promise<NearEmptyAuditProposal[]>;
}

const PRIORITY_ORDER = { P0: 0, P1: 1, P2: 2, P3: 3 } as const;

/** Bridges the canonical Workforce queue/scheduler to durable pull-based remote worker leases. */
export class RemoteTaskBroker {
  constructor(
    private readonly runtime: DurableWorkforceRuntime,
    private readonly mailbox: DurableTaskMailbox,
    private readonly now: () => Date = () => new Date(),
    private readonly autonomy?: DurableAutonomyStore,
    private readonly nearEmptyAudit?: NearEmptyAuditProvider,
  ) {}

  async enqueue(task: TaskPacket): Promise<TaskRuntimeRecord> {
    const record = this.runtime.queue.enqueue(task);
    await this.runtime.checkpoint();
    return record;
  }

  async poll(nodeId: string): Promise<RemoteTaskLease | undefined> {
    if (!nodeId.trim()) throw new Error('nodeId is required');
    await this.#recoverExpiredForNode(nodeId);
    await this.#refreshContinuations(nodeId);
    const created = await this.runNearEmptyAudit(nodeId);
    if (created.length) await this.#refreshContinuations(nodeId);

    const waits = this.autonomy ? await this.autonomy.listForNode(nodeId) : [];
    const preferredNext = new Set(waits.map((row) => row.nextWorkId).filter((value): value is string => Boolean(value)));

    let candidates = this.runtime.queue.list()
      .filter((record) => record.stage === 'queued');

    // Once a worker has declared blocked work, fail closed to the exact next-safe-work plan.
    // No tagged safe candidate means no autonomous lease, rather than falling through to arbitrary work.
    if (waits.length > 0) candidates = candidates.filter((record) => preferredNext.has(record.task.taskId));

    candidates.sort((a, b) => {
      const preferred = Number(preferredNext.has(b.task.taskId)) - Number(preferredNext.has(a.task.taskId));
      if (preferred !== 0) return preferred;
      const priority = PRIORITY_ORDER[a.task.priority] - PRIORITY_ORDER[b.task.priority];
      if (priority !== 0) return priority;
      return Date.parse(a.task.deadline) - Date.parse(b.task.deadline) || a.task.taskId.localeCompare(b.task.taskId);
    });

    for (const record of candidates) {
      const employee = this.runtime.scheduler.select(record.task);
      if (!employee || employee.nodeId !== nodeId) continue;

      this.runtime.queue.assign(record.task.taskId, employee.employeeId);
      this.runtime.registry.acquire(employee.employeeId, record.task.taskId);
      this.runtime.queue.start(record.task.taskId);
      await this.runtime.checkpoint();

      try {
        const assigned = this.runtime.queue.get(record.task.taskId);
        const lease = await this.mailbox.lease(record.task, nodeId, assigned.attempts);
        return { ...lease, employeeId: employee.employeeId };
      } catch (error) {
        const failure = brokerFailure(record.task.taskId, employee.employeeId, error, 'LEASE_CREATE_FAILED', this.now());
        this.runtime.queue.fail(record.task.taskId, failure);
        this.runtime.registry.release(employee.employeeId, record.task.taskId, false);
        if (this.runtime.queue.get(record.task.taskId).attempts < record.task.maxAttempts) {
          this.runtime.queue.requeue(record.task.taskId);
        }
        await this.runtime.checkpoint();
        throw error;
      }
    }
    return undefined;
  }

  async runNearEmptyAudit(nodeId: string): Promise<string[]> {
    if (!nodeId.trim()) throw new Error('nodeId is required');
    if (!this.nearEmptyAudit) return [];

    const records = this.runtime.queue.list();
    const mutationInFlight = records.some((record) => {
      if (record.stage !== 'running' || !record.assignedEmployeeId) return false;
      return this.runtime.registry.getEmployee(record.assignedEmployeeId)?.nodeId === nodeId;
    });
    if (mutationInFlight) return [];

    const waiting = this.autonomy ? await this.autonomy.listForNode(nodeId) : [];
    const eligible = records.filter((record) => {
      if (record.stage !== 'queued') return false;
      return this.runtime.scheduler.select(record.task)?.nodeId === nodeId;
    });
    const primaryWaiting = waiting.length > 0;
    if (eligible.length > 1 && !primaryWaiting) return [];

    const proposals = await this.nearEmptyAudit.inspect({
      nodeId,
      eligibleWorkCount: eligible.length,
      primaryWaiting,
    });
    const existing = this.runtime.queue.list();
    const safeProposals = proposals.filter((proposal) => this.#validNearEmptyProposal(nodeId, proposal));
    const plan = planNearEmptyAudit({
      eligibleWorkCount: eligible.length,
      primaryWaiting,
      mutationInFlight: false,
      findings: safeProposals.map((proposal) => ({
        ...proposal.finding,
        duplicateExisting: proposal.finding.duplicateExisting || existing.some((record) =>
          record.task.taskId === proposal.task.taskId || record.task.idempotencyKey === proposal.task.idempotencyKey),
      })),
    });
    if (!plan.triggered || plan.selected.length === 0) return [];

    const selectedIds = new Set(plan.selected.map((finding) => finding.workId));
    const created: string[] = [];
    for (const proposal of safeProposals) {
      if (!selectedIds.has(proposal.finding.workId)) continue;
      const before = this.runtime.queue.list().some((record) =>
        record.task.taskId === proposal.task.taskId || record.task.idempotencyKey === proposal.task.idempotencyKey);
      if (before) continue;
      this.runtime.queue.enqueue(proposal.task);
      created.push(proposal.task.taskId);
    }
    if (created.length) await this.runtime.checkpoint();
    return created;
  }

  async acceptResult(
    nodeId: string,
    taskId: string,
    leaseId: string,
    leaseToken: string,
    result: WorkerResult,
  ): Promise<WorkerResult> {
    const record = this.runtime.queue.get(taskId);
    if (!record.assignedEmployeeId) throw new Error('task has no assigned employee');
    const employee = this.runtime.registry.getEmployee(record.assignedEmployeeId);
    if (!employee || employee.nodeId !== nodeId) throw new Error('task is assigned to another node');
    if (result.employeeId !== employee.employeeId) throw new Error('result employee mismatch');

    const accepted = await this.mailbox.acceptResult(taskId, nodeId, leaseId, leaseToken, result);
    if (record.stage === 'completed') return accepted;
    if (record.stage !== 'running') throw new Error('task is not running');

    if (accepted.status === 'completed') {
      this.runtime.queue.complete(taskId, accepted);
      this.runtime.registry.release(employee.employeeId, taskId, true);
    } else {
      this.runtime.queue.fail(taskId, accepted);
      this.runtime.registry.release(employee.employeeId, taskId, false);
      const latest = this.runtime.queue.get(taskId);
      if (accepted.failure?.retriable && latest.attempts < latest.task.maxAttempts) this.runtime.queue.requeue(taskId);
    }
    await this.runtime.checkpoint();
    await this.#refreshContinuations(nodeId);
    return accepted;
  }

  async acceptBlockedResult(
    nodeId: string,
    taskId: string,
    leaseId: string,
    leaseToken: string,
    result: WorkerResult,
    context: BlockedResultContext,
  ): Promise<AcceptedBlockedResult> {
    if (!this.autonomy) throw new Error('autonomy store is not configured');
    if (context.mutationInFlight) throw new Error('blocked result cannot release an in-flight mutation');
    if (result.status !== 'failed') throw new Error('blocked result must have failed status');

    const record = this.runtime.queue.get(taskId);
    if (!record.assignedEmployeeId) throw new Error('task has no assigned employee');
    const employee = this.runtime.registry.getEmployee(record.assignedEmployeeId);
    if (!employee || employee.nodeId !== nodeId) throw new Error('task is assigned to another node');
    if (result.employeeId !== employee.employeeId) throw new Error('result employee mismatch');

    const policy = parseAutonomyPolicy(record.task.constraints);
    if (!policy) throw new Error('blocked task is missing autonomy metadata');

    const accepted = await this.mailbox.acceptResult(taskId, nodeId, leaseId, leaseToken, result);
    const existingWait = await this.autonomy.get(taskId);
    if (record.stage === 'failed' && existingWait) return { result: accepted, plan: planFromRecord(existingWait) };
    if (record.stage !== 'running') throw new Error('task is not running');

    const plan = planBlockedWork({
      workId: taskId,
      blocker: context.blocker,
      dependencyKey: context.dependencyKey,
      mutationInFlight: false,
      currentResourceScope: policy.resourceScope,
      candidates: this.#safeCandidates(),
    });
    if (!plan.releaseLease) throw new Error('blocked work plan refused lease release');

    this.runtime.queue.fail(taskId, accepted);
    // Existing registry accounting only exposes success/failure release. Keep current semantics here;
    // the blocked-state journal is authoritative for routing and prevents a false DONE claim.
    this.runtime.registry.release(employee.employeeId, taskId, false);
    await this.autonomy.record({
      workId: taskId,
      nodeId,
      employeeId: employee.employeeId,
      blocker: context.blocker,
      dependencyKey: context.dependencyKey,
      resourceScope: policy.resourceScope,
      state: plan.state,
      dependencyWatch: plan.dependencyWatch,
      ownerActionRequired: plan.ownerActionRequired,
      nextWorkId: plan.nextWorkId,
      retry: plan.retry,
    });
    await this.runtime.checkpoint();
    return { result: accepted, plan };
  }

  async resumeDependency(dependencyKey: string): Promise<string[]> {
    if (!this.autonomy) throw new Error('autonomy store is not configured');
    if (!dependencyKey.trim()) throw new Error('dependencyKey is required');
    const resumed: string[] = [];
    const affectedNodes = new Set<string>();
    for (const waiting of await this.autonomy.listActive()) {
      if (waiting.state !== 'waiting_condition' || waiting.dependencyKey !== dependencyKey) continue;
      const record = this.runtime.queue.get(waiting.workId);
      if (record.stage !== 'failed' || record.attempts >= record.task.maxAttempts) continue;
      this.runtime.queue.requeue(waiting.workId);
      await this.autonomy.clear(waiting.workId, `dependency-ready:${dependencyKey}`);
      resumed.push(waiting.workId);
      affectedNodes.add(waiting.nodeId);
    }
    if (resumed.length) await this.runtime.checkpoint();
    for (const nodeId of affectedNodes) await this.#refreshContinuations(nodeId);
    return resumed.sort();
  }

  async waiting(nodeId?: string): Promise<BlockedWorkRecord[]> {
    if (!this.autonomy) return [];
    return nodeId ? this.autonomy.listForNode(nodeId) : this.autonomy.listActive();
  }

  #safeCandidates() {
    return this.runtime.queue.list()
      .filter((record) => record.stage === 'queued')
      .map((record) => safeCandidateFromTask(record.task))
      .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate));
  }

  #validNearEmptyProposal(nodeId: string, proposal: NearEmptyAuditProposal): boolean {
    const { finding, task } = proposal;
    if (finding.workId !== task.taskId || finding.objective.trim() !== task.objective.trim()) return false;
    const policy = parseAutonomyPolicy(task.constraints);
    if (!policy || policy.level !== 'A' || finding.level !== 'A') return false;
    if (policy.resourceScope !== finding.resourceScope) return false;
    return this.runtime.scheduler.select(task)?.nodeId === nodeId;
  }

  async #refreshContinuations(nodeId: string): Promise<void> {
    if (!this.autonomy) return;
    const candidates = this.#safeCandidates();
    for (const waiting of await this.autonomy.listForNode(nodeId)) {
      const plan = planBlockedWork({
        workId: waiting.workId,
        blocker: waiting.blocker,
        dependencyKey: waiting.dependencyKey,
        mutationInFlight: false,
        currentResourceScope: waiting.resourceScope,
        candidates,
      });
      await this.autonomy.updateNext(waiting.workId, plan.nextWorkId);
    }
  }

  async #recoverExpiredForNode(nodeId: string): Promise<void> {
    for (const record of this.runtime.queue.list()) {
      if (record.stage !== 'running' || !record.assignedEmployeeId) continue;
      const employee = this.runtime.registry.getEmployee(record.assignedEmployeeId);
      if (!employee || employee.nodeId !== nodeId) continue;
      const current = await this.mailbox.current(record.task.taskId);
      if (!current || current.acceptedResult || Date.parse(current.expiresAt) >= this.now().getTime()) continue;
      await this.mailbox.expire(record.task.taskId);
      const failure = brokerFailure(record.task.taskId, employee.employeeId, new Error('remote task lease expired'), 'LEASE_EXPIRED', this.now());
      this.runtime.queue.fail(record.task.taskId, failure);
      this.runtime.registry.release(employee.employeeId, record.task.taskId, false);
      const latest = this.runtime.queue.get(record.task.taskId);
      if (latest.attempts < latest.task.maxAttempts) this.runtime.queue.requeue(record.task.taskId);
      await this.runtime.checkpoint();
    }
  }
}

function planFromRecord(record: BlockedWorkRecord): BlockedWorkPlan {
  return {
    workId: record.workId,
    state: record.state,
    releaseLease: true,
    dependencyWatch: record.dependencyWatch,
    ownerActionRequired: record.ownerActionRequired,
    nextWorkId: record.nextWorkId,
    retry: { maxAttempts: record.retry.maxAttempts, backoffSeconds: [...record.retry.backoffSeconds] },
  };
}

function brokerFailure(taskId: string, employeeId: string, error: unknown, code: string, now: Date): WorkerResult {
  return {
    taskId,
    employeeId,
    status: 'failed',
    conclusion: 'Remote worker lease did not complete successfully.',
    confidence: 0,
    artifacts: [],
    risks: ['remote-worker-lease'],
    completedAt: now.toISOString(),
    failure: {
      code,
      message: error instanceof Error ? error.message : String(error),
      retriable: true,
    },
  };
}
