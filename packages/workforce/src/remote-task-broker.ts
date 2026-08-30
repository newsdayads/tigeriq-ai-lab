import type { TaskPacket, TaskRuntimeRecord, WorkerResult } from './index.js';
import type { DurableWorkforceRuntime } from './runtime.js';
import { DurableTaskMailbox, type TaskLease } from './task-mailbox.js';

export interface RemoteTaskLease extends TaskLease {
  employeeId: string;
}

const PRIORITY_ORDER = { P0: 0, P1: 1, P2: 2, P3: 3 } as const;

/** Bridges the canonical Workforce queue/scheduler to durable pull-based remote worker leases. */
export class RemoteTaskBroker {
  constructor(
    private readonly runtime: DurableWorkforceRuntime,
    private readonly mailbox: DurableTaskMailbox,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async enqueue(task: TaskPacket): Promise<TaskRuntimeRecord> {
    const record = this.runtime.queue.enqueue(task);
    await this.runtime.checkpoint();
    return record;
  }

  async poll(nodeId: string): Promise<RemoteTaskLease | undefined> {
    if (!nodeId.trim()) throw new Error('nodeId is required');
    await this.#recoverExpiredForNode(nodeId);

    const candidates = this.runtime.queue.list()
      .filter((record) => record.stage === 'queued')
      .sort((a, b) => {
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
    return accepted;
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
