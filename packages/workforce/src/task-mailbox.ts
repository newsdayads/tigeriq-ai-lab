import { randomBytes } from 'node:crypto';
import { FileJournal } from '../../event-store/src/index.js';
import type { TaskPacket, WorkerResult } from './index.js';

export interface TaskLease {
  taskId: string;
  nodeId: string;
  leaseId: string;
  leaseToken: string;
  leasedAt: string;
  expiresAt: string;
  attempt: number;
  task: TaskPacket;
}

interface StoredLease extends Omit<TaskLease, 'leaseToken'> {
  leaseTokenHash: string;
  acceptedResult?: WorkerResult;
}

type MailboxEvent =
  | { action: 'leased'; lease: StoredLease }
  | { action: 'result'; leaseId: string; result: WorkerResult; acceptedAt: string }
  | { action: 'expired'; leaseId: string; expiredAt: string };

function token(bytes = 32): string { return randomBytes(bytes).toString('base64url'); }
async function sha256(value: string): Promise<string> {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
function cloneTask(task: TaskPacket): TaskPacket { return structuredClone(task); }
function cloneResult(result: WorkerResult): WorkerResult { return structuredClone(result); }

/** Durable, append-only lease authority for remote workers. Raw lease tokens are never journaled. */
export class DurableTaskMailbox {
  constructor(
    private readonly journal: FileJournal,
    private readonly now: () => Date = () => new Date(),
    private readonly leaseTtlMs = 2 * 60_000,
    private readonly actor = 'workforce-mailbox',
  ) {
    if (leaseTtlMs < 15_000 || leaseTtlMs > 15 * 60_000) throw new Error('lease TTL must be between 15 seconds and 15 minutes');
  }

  async lease(task: TaskPacket, nodeId: string, attempt: number): Promise<TaskLease> {
    if (!task.taskId.trim() || !nodeId.trim() || !Number.isInteger(attempt) || attempt < 1 || attempt > task.maxAttempts) {
      throw new Error('invalid task lease');
    }
    const current = await this.current(task.taskId);
    if (current && !current.acceptedResult && Date.parse(current.expiresAt) > this.now().getTime()) {
      throw new Error('task already leased');
    }
    const leaseId = token(18);
    const leaseToken = token();
    const leasedAt = this.now().toISOString();
    const expiresAt = new Date(this.now().getTime() + this.leaseTtlMs).toISOString();
    const stored: StoredLease = {
      taskId: task.taskId, nodeId, leaseId, leaseTokenHash: await sha256(leaseToken), leasedAt, expiresAt, attempt, task: cloneTask(task),
    };
    const streamId = this.stream(task.taskId);
    const events = await this.journal.readStream<MailboxEvent>(streamId);
    await this.journal.append(streamId, events.length, {
      type: 'workforce.task.leased', actor: this.actor, payload: { action: 'leased', lease: stored } satisfies MailboxEvent, timestamp: leasedAt,
    });
    return { taskId: task.taskId, nodeId, leaseId, leaseToken, leasedAt, expiresAt, attempt, task: cloneTask(task) };
  }

  async acceptResult(taskId: string, nodeId: string, leaseId: string, leaseToken: string, result: WorkerResult): Promise<WorkerResult> {
    const current = await this.current(taskId);
    if (!current || current.leaseId !== leaseId || current.nodeId !== nodeId) throw new Error('stale task lease');
    if (current.acceptedResult) return cloneResult(current.acceptedResult);
    if (this.now().getTime() > Date.parse(current.expiresAt)) throw new Error('task lease expired');
    if ((await sha256(leaseToken)) !== current.leaseTokenHash) throw new Error('invalid task lease token');
    if (result.taskId !== taskId) throw new Error('result task mismatch');
    const acceptedAt = this.now().toISOString();
    const streamId = this.stream(taskId);
    const events = await this.journal.readStream<MailboxEvent>(streamId);
    await this.journal.append(streamId, events.length, {
      type: 'workforce.task.result-accepted', actor: this.actor,
      payload: { action: 'result', leaseId, result: cloneResult(result), acceptedAt } satisfies MailboxEvent, timestamp: acceptedAt,
    });
    return cloneResult(result);
  }

  async expire(taskId: string): Promise<boolean> {
    const current = await this.current(taskId);
    if (!current || current.acceptedResult || this.now().getTime() <= Date.parse(current.expiresAt)) return false;
    const streamId = this.stream(taskId);
    const events = await this.journal.readStream<MailboxEvent>(streamId);
    await this.journal.append(streamId, events.length, {
      type: 'workforce.task.lease-expired', actor: this.actor,
      payload: { action: 'expired', leaseId: current.leaseId, expiredAt: this.now().toISOString() } satisfies MailboxEvent,
      timestamp: this.now().toISOString(),
    });
    return true;
  }

  async current(taskId: string): Promise<StoredLease | undefined> {
    const events = await this.journal.readStream<MailboxEvent>(this.stream(taskId));
    let current: StoredLease | undefined;
    for (const entry of events) {
      const event = entry.payload;
      if (event.action === 'leased') current = structuredClone(event.lease);
      else if (event.action === 'result' && current?.leaseId === event.leaseId) current.acceptedResult = cloneResult(event.result);
      else if (event.action === 'expired' && current?.leaseId === event.leaseId) current.expiresAt = event.expiredAt;
    }
    return current ? structuredClone(current) : undefined;
  }

  private stream(taskId: string): string { return `workforce:task-mailbox:${taskId}`; }
}
