import { createHash } from 'node:crypto';
import { FileJournal, type JournalEntry } from '../../event-store/src/index.js';
import type { DurableWorkforceRuntime } from './runtime.js';

export type AuthorityAction = 'queue.claim' | 'queue.release' | 'lease.transfer' | 'state.write';

export interface AuthorityContext {
  actorId: string;
  workOrderId: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  environment: 'off-main' | 'main' | 'production';
  idempotencyKey: string;
}

export interface ActiveAuthorityLease {
  leaseId: string;
  ownerId: 'NV01' | 'NV02';
  resource: string;
  claimedAt: string;
}

export interface AuthorityState {
  lease?: ActiveAuthorityLease;
  checkpoint?: string;
  evidenceHashes: string[];
}

interface StoredOperation {
  action: AuthorityAction;
  fingerprint: string;
  result: AuthorityState;
}

const MAX_CHECKPOINT = 1_024;
const OWNER_IDS = new Set(['NV01', 'NV02']);

/**
 * The only mutation bridge available to Vy for P0 work in an OFF-MAIN
 * environment. It deliberately exposes no generic command/file/write API:
 * every accepted mutation is appended to the existing hash-chained journal
 * and checkpoints the existing durable Workforce runtime.
 */
export class VyAuthorityBridge {
  constructor(
    private readonly runtime: DurableWorkforceRuntime,
    private readonly journal: FileJournal,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async claim(context: AuthorityContext, ownerId: 'NV01' | 'NV02', resource: string): Promise<AuthorityState> {
    this.#authorize(context, 'queue.claim');
    this.#nonEmpty(ownerId, 'ownerId');
    this.#nonEmpty(resource, 'resource');
    const fingerprint = this.#fingerprint(context, { ownerId, resource });
    const replay = await this.#replay(context, 'queue.claim', fingerprint);
    if (replay) return replay;
    const current = await this.read(context);
    if (current.lease) throw new Error('active authority lease already exists');
    return this.#append(context, 'queue.claim', fingerprint, {
      ...current,
      lease: { leaseId: cryptoId(context, ownerId, resource, this.now()), ownerId, resource, claimedAt: this.now().toISOString() },
    });
  }

  async release(context: AuthorityContext, ownerId: 'NV01' | 'NV02', leaseId: string): Promise<AuthorityState> {
    this.#authorize(context, 'queue.release');
    const fingerprint = this.#fingerprint(context, { ownerId, leaseId });
    const replay = await this.#replay(context, 'queue.release', fingerprint);
    if (replay) return replay;
    const current = await this.read(context);
    this.#assertCurrentLease(current, ownerId, leaseId);
    return this.#append(context, 'queue.release', fingerprint, { ...current, lease: undefined });
  }

  async transfer(context: AuthorityContext, fromOwnerId: 'NV01' | 'NV02', toOwnerId: 'NV01' | 'NV02', leaseId: string): Promise<AuthorityState> {
    this.#authorize(context, 'lease.transfer');
    if (fromOwnerId === toOwnerId) throw new Error('transfer requires a different owner');
    const fingerprint = this.#fingerprint(context, { fromOwnerId, toOwnerId, leaseId });
    const replay = await this.#replay(context, 'lease.transfer', fingerprint);
    if (replay) return replay;
    const current = await this.read(context);
    this.#assertCurrentLease(current, fromOwnerId, leaseId);
    return this.#append(context, 'lease.transfer', fingerprint, {
      ...current,
      lease: {
        leaseId: cryptoId(context, toOwnerId, current.lease.resource, this.now()),
        ownerId: toOwnerId,
        resource: current.lease.resource,
        claimedAt: this.now().toISOString(),
      },
    });
  }

  async writeState(context: AuthorityContext, ownerId: 'NV01' | 'NV02', leaseId: string, checkpoint: string, evidenceHashes: string[]): Promise<AuthorityState> {
    this.#authorize(context, 'state.write');
    this.#nonEmpty(checkpoint, 'checkpoint');
    if (checkpoint.length > MAX_CHECKPOINT) throw new Error('checkpoint exceeds maximum length');
    if (!Array.isArray(evidenceHashes) || evidenceHashes.length === 0 || evidenceHashes.length > 10 || evidenceHashes.some((hash) => !/^[a-f0-9]{64}$/.test(hash))) {
      throw new Error('state.write requires one to ten SHA-256 evidence hashes');
    }
    const normalizedEvidence = [...new Set(evidenceHashes)].sort();
    const fingerprint = this.#fingerprint(context, { ownerId, leaseId, checkpoint, evidenceHashes: normalizedEvidence });
    const replay = await this.#replay(context, 'state.write', fingerprint);
    if (replay) return replay;
    const current = await this.read(context);
    this.#assertCurrentLease(current, ownerId, leaseId);
    return this.#append(context, 'state.write', fingerprint, { ...current, checkpoint, evidenceHashes: normalizedEvidence });
  }

  async read(context: Pick<AuthorityContext, 'workOrderId'>): Promise<AuthorityState> {
    const events = await this.journal.readStream<StoredOperation>(this.#stream(context.workOrderId));
    const last = events.at(-1);
    return last ? structuredClone(last.payload.result) : { evidenceHashes: [] };
  }

  async #append(context: AuthorityContext, action: AuthorityAction, fingerprint: string, result: AuthorityState): Promise<AuthorityState> {
    const streamId = this.#stream(context.workOrderId);
    const events = await this.journal.readStream<StoredOperation>(streamId);
    const stored: StoredOperation = { action, fingerprint, result: structuredClone(result) };
    await this.journal.append(streamId, events.length, {
      type: `authority.${action}`,
      actor: context.actorId,
      payload: stored,
      timestamp: this.now().toISOString(),
    });
    await this.runtime.checkpoint();
    return structuredClone(result);
  }

  async #replay(context: AuthorityContext, action: AuthorityAction, fingerprint: string): Promise<AuthorityState | undefined> {
    const events = await this.journal.readStream<StoredOperation>(this.#stream(context.workOrderId));
    const match = events.find((entry) => entry.payload.action === action && entry.payload.fingerprint === fingerprint);
    if (match) return structuredClone(match.payload.result);
    const sameKey = events.find((entry) => entry.payload.fingerprint.startsWith(`${context.idempotencyKey}:`));
    if (sameKey) throw new Error('idempotency key reused with different request');
    return undefined;
  }

  #authorize(context: AuthorityContext, _action: AuthorityAction): void {
    if (context.actorId !== 'Vy') throw new Error('unauthorized actor');
    if (context.priority !== 'P0' || context.environment !== 'off-main') throw new Error('unauthorized scope');
    if (!/^WO-[A-Za-z0-9._-]{1,96}$/.test(context.workOrderId)) throw new Error('invalid work order id');
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(context.idempotencyKey)) throw new Error('invalid idempotency key');
  }

  #assertCurrentLease(state: AuthorityState, ownerId: string, leaseId: string): asserts state is AuthorityState & { lease: ActiveAuthorityLease } {
    if (!OWNER_IDS.has(ownerId) || !state.lease || state.lease.ownerId !== ownerId || state.lease.leaseId !== leaseId) {
      throw new Error('stale or unauthorized authority lease');
    }
  }

  #nonEmpty(value: string, name: string): void {
    if (!value.trim()) throw new Error(`${name} is required`);
  }

  #fingerprint(context: AuthorityContext, payload: unknown): string {
    return `${context.idempotencyKey}:${digest(payload)}`;
  }

  #stream(workOrderId: string): string { return `workforce:authority:${workOrderId}`; }
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function cryptoId(context: AuthorityContext, ownerId: string, resource: string, now: Date): string {
  return digest(`${context.idempotencyKey}:${ownerId}:${resource}:${now.toISOString()}`).slice(0, 32);
}
