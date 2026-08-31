import { FileJournal } from '../../event-store/src/index.js';
import type { WorkManagementSnapshot } from './types.js';

export interface WorkManagementStateStore {
  load(): Promise<WorkManagementSnapshot | undefined>;
  save(snapshot: WorkManagementSnapshot, savedAt?: string): Promise<void>;
}

export interface FileJournalWorkManagementStoreOptions {
  streamId?: string;
  actor?: string;
}

/** Durable, zero-cost checkpoint storage for the work-management engine.
 * The journal is append-only, hash chained, file locked, and restart-safe.
 * It belongs on PC01/Farm Controller storage, never Vercel ephemeral storage.
 */
export class FileJournalWorkManagementStateStore implements WorkManagementStateStore {
  readonly #journal: FileJournal;
  readonly #streamId: string;
  readonly #actor: string;

  constructor(journal: FileJournal, options: FileJournalWorkManagementStoreOptions = {}) {
    this.#journal = journal;
    this.#streamId = options.streamId?.trim() || 'work-management:state';
    this.#actor = options.actor?.trim() || 'work-management-controller';
  }

  async load(): Promise<WorkManagementSnapshot | undefined> {
    const entries = await this.#journal.readStream<WorkManagementSnapshot>(this.#streamId);
    const latest = entries.at(-1);
    if (!latest) return undefined;
    validateSnapshot(latest.payload);
    return structuredClone(latest.payload);
  }

  async save(snapshot: WorkManagementSnapshot, savedAt = new Date().toISOString()): Promise<void> {
    validateSnapshot(snapshot);
    if (!Number.isFinite(Date.parse(savedAt))) throw new Error('savedAt must be an ISO date');
    const entries = await this.#journal.readStream<WorkManagementSnapshot>(this.#streamId);
    await this.#journal.append(this.#streamId, entries.length, {
      type: 'work-management.snapshot.saved',
      actor: this.#actor,
      payload: structuredClone(snapshot),
      timestamp: savedAt,
    });
  }
}

function validateSnapshot(snapshot: WorkManagementSnapshot): void {
  if (!snapshot || snapshot.version !== 1) throw new Error('invalid work-management snapshot version');
  if (!Number.isInteger(snapshot.sequence) || snapshot.sequence < 0) throw new Error('invalid work-management sequence');
  if (!Array.isArray(snapshot.goals) || !Array.isArray(snapshot.history)) throw new Error('invalid work-management collections');
}
