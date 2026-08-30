import { FileJournal } from '../../event-store/src/index.js';
import type { WorkforceSnapshot, WorkforceStateStore } from './runtime.js';

export interface FileJournalWorkforceStoreOptions {
  streamId?: string;
  actor?: string;
}

/**
 * Zero-cost durable Workforce state store for the PC01/Farm Controller.
 *
 * The underlying FileJournal provides append-only JSONL storage, a global
 * SHA-256 hash chain, file-locking and per-stream optimistic concurrency.
 * Vercel must not use this store because its filesystem is not durable.
 */
export class FileJournalWorkforceStateStore implements WorkforceStateStore {
  readonly #journal: FileJournal;
  readonly #streamId: string;
  readonly #actor: string;

  constructor(journal: FileJournal, options: FileJournalWorkforceStoreOptions = {}) {
    this.#journal = journal;
    this.#streamId = options.streamId?.trim() || 'workforce:state';
    this.#actor = options.actor?.trim() || 'workforce-controller';
  }

  async load(): Promise<WorkforceSnapshot | undefined> {
    const entries = await this.#journal.readStream<WorkforceSnapshot>(this.#streamId);
    const latest = entries.at(-1);
    if (!latest) return undefined;
    validateSnapshot(latest.payload);
    return structuredClone(latest.payload);
  }

  async save(snapshot: WorkforceSnapshot): Promise<void> {
    validateSnapshot(snapshot);
    const entries = await this.#journal.readStream<WorkforceSnapshot>(this.#streamId);
    await this.#journal.append(this.#streamId, entries.length, {
      type: 'workforce.snapshot.saved',
      actor: this.#actor,
      payload: structuredClone(snapshot),
      timestamp: snapshot.savedAt,
    });
  }
}

function validateSnapshot(snapshot: WorkforceSnapshot): void {
  if (!snapshot || snapshot.version !== 1) throw new Error('invalid workforce snapshot version');
  if (!Number.isFinite(Date.parse(snapshot.savedAt))) throw new Error('invalid workforce snapshot savedAt');
  if (!Array.isArray(snapshot.nodes) || !Array.isArray(snapshot.employees) || !Array.isArray(snapshot.tasks)) {
    throw new Error('invalid workforce snapshot collections');
  }
}
