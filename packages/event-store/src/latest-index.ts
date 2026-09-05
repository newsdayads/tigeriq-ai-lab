import type { JournalEntry } from './index.js';

/**
 * Read-side index candidate for #463.
 * It performs one authoritative load/verification through the supplied loader,
 * then serves latest/version queries without replaying the full journal.
 * Writers must call record() after a successful canonical append. If an
 * out-of-process writer may have changed the journal, invalidate() is required.
 */
export class JournalLatestIndex {
  readonly #loadAll: () => Promise<JournalEntry[]>;
  readonly #latest = new Map<string, JournalEntry>();
  readonly #versions = new Map<string, number>();
  #loaded = false;
  #loadPromise?: Promise<void>;

  constructor(loadAll: () => Promise<JournalEntry[]>) {
    this.#loadAll = loadAll;
  }

  async latest<T = unknown>(streamId: string): Promise<JournalEntry<T> | undefined> {
    await this.#ensureLoaded();
    const entry = this.#latest.get(streamId);
    return entry ? structuredClone(entry) as JournalEntry<T> : undefined;
  }

  async version(streamId: string): Promise<number> {
    await this.#ensureLoaded();
    return this.#versions.get(streamId) ?? 0;
  }

  async warm(): Promise<void> {
    await this.#ensureLoaded();
  }

  record(entry: JournalEntry): void {
    if (!this.#loaded) throw new Error('JOURNAL_INDEX_NOT_WARM');
    const expected = (this.#versions.get(entry.streamId) ?? 0) + 1;
    const prior = this.#latest.get(entry.streamId);
    if (prior && entry.sequence <= prior.sequence) throw new Error('JOURNAL_INDEX_STALE_RECORD');
    this.#versions.set(entry.streamId, expected);
    this.#latest.set(entry.streamId, structuredClone(entry));
  }

  invalidate(): void {
    this.#loaded = false;
    this.#loadPromise = undefined;
    this.#latest.clear();
    this.#versions.clear();
  }

  async #ensureLoaded(): Promise<void> {
    if (this.#loaded) return;
    if (this.#loadPromise) return this.#loadPromise;
    this.#loadPromise = (async () => {
      const entries = await this.#loadAll();
      this.#latest.clear();
      this.#versions.clear();
      for (const entry of entries) {
        this.#latest.set(entry.streamId, structuredClone(entry));
        this.#versions.set(entry.streamId, (this.#versions.get(entry.streamId) ?? 0) + 1);
      }
      this.#loaded = true;
    })().finally(() => { this.#loadPromise = undefined; });
    await this.#loadPromise;
  }
}
