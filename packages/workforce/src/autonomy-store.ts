import { FileJournal } from '../../event-store/src/index.js';
import type { BlockedWorkPlan, BlockerKind } from './autonomy.js';

export interface BlockedWorkRecord {
  workId: string;
  nodeId: string;
  employeeId: string;
  blocker: BlockerKind;
  dependencyKey?: string;
  resourceScope: string;
  state: BlockedWorkPlan['state'];
  dependencyWatch: boolean;
  ownerActionRequired: boolean;
  nextWorkId?: string;
  retry: BlockedWorkPlan['retry'];
  blockedAt: string;
}

type AutonomyEvent =
  | { action: 'blocked'; record: BlockedWorkRecord }
  | { action: 'plan-updated'; nextWorkId?: string; updatedAt: string }
  | { action: 'cleared'; reason: string; clearedAt: string };

const STREAM_PREFIX = 'workforce:autonomy:';

function clone(record: BlockedWorkRecord): BlockedWorkRecord {
  return { ...record, retry: { maxAttempts: record.retry.maxAttempts, backoffSeconds: [...record.retry.backoffSeconds] } };
}

export class DurableAutonomyStore {
  constructor(
    private readonly journal: FileJournal,
    private readonly now: () => Date = () => new Date(),
    private readonly actor = 'workforce-autonomy',
  ) {}

  async record(input: Omit<BlockedWorkRecord, 'blockedAt'> & { blockedAt?: string }): Promise<BlockedWorkRecord> {
    const record: BlockedWorkRecord = { ...input, blockedAt: input.blockedAt ?? this.now().toISOString() };
    const streamId = this.stream(record.workId);
    const events = await this.journal.readStream<AutonomyEvent>(streamId);
    await this.journal.append(streamId, events.length, {
      type: 'workforce.autonomy.blocked',
      actor: this.actor,
      payload: { action: 'blocked', record: clone(record) } satisfies AutonomyEvent,
      timestamp: record.blockedAt,
    });
    return clone(record);
  }

  async updateNext(workId: string, nextWorkId?: string): Promise<BlockedWorkRecord | undefined> {
    const current = await this.get(workId);
    if (!current || current.nextWorkId === nextWorkId) return current;
    const streamId = this.stream(workId);
    const events = await this.journal.readStream<AutonomyEvent>(streamId);
    const updatedAt = this.now().toISOString();
    await this.journal.append(streamId, events.length, {
      type: 'workforce.autonomy.plan-updated',
      actor: this.actor,
      payload: { action: 'plan-updated', nextWorkId, updatedAt } satisfies AutonomyEvent,
      timestamp: updatedAt,
    });
    return this.get(workId);
  }

  async clear(workId: string, reason: string): Promise<boolean> {
    const current = await this.get(workId);
    if (!current) return false;
    const streamId = this.stream(workId);
    const events = await this.journal.readStream<AutonomyEvent>(streamId);
    const clearedAt = this.now().toISOString();
    await this.journal.append(streamId, events.length, {
      type: 'workforce.autonomy.cleared',
      actor: this.actor,
      payload: { action: 'cleared', reason, clearedAt } satisfies AutonomyEvent,
      timestamp: clearedAt,
    });
    return true;
  }

  async get(workId: string): Promise<BlockedWorkRecord | undefined> {
    const events = await this.journal.readStream<AutonomyEvent>(this.stream(workId));
    return this.replay(events.map((entry) => entry.payload));
  }

  async listActive(): Promise<BlockedWorkRecord[]> {
    const all = await this.journal.readAll();
    const workIds = [...new Set(all
      .map((entry) => entry.streamId)
      .filter((streamId) => streamId.startsWith(STREAM_PREFIX))
      .map((streamId) => streamId.slice(STREAM_PREFIX.length)))];
    const rows: BlockedWorkRecord[] = [];
    for (const workId of workIds) {
      const record = await this.get(workId);
      if (record) rows.push(record);
    }
    return rows.sort((a, b) => a.blockedAt.localeCompare(b.blockedAt) || a.workId.localeCompare(b.workId));
  }

  async listForNode(nodeId: string): Promise<BlockedWorkRecord[]> {
    return (await this.listActive()).filter((record) => record.nodeId === nodeId);
  }

  private replay(events: AutonomyEvent[]): BlockedWorkRecord | undefined {
    let current: BlockedWorkRecord | undefined;
    for (const event of events) {
      if (event.action === 'blocked') current = clone(event.record);
      else if (event.action === 'plan-updated' && current) current.nextWorkId = event.nextWorkId;
      else if (event.action === 'cleared') current = undefined;
    }
    return current ? clone(current) : undefined;
  }

  private stream(workId: string): string {
    if (!workId.trim()) throw new Error('workId is required');
    return `${STREAM_PREFIX}${workId}`;
  }
}
