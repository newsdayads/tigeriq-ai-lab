import { createHash, randomUUID } from 'node:crypto';
import { appendFile, mkdir, open, readFile, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface JournalEntry<T = unknown> {
  sequence: number;
  streamId: string;
  eventId: string;
  type: string;
  actor: string;
  timestamp: string;
  payload: T;
  previousHash: string | null;
  hash: string;
}

export interface AppendEvent<T> {
  type: string;
  actor: string;
  payload: T;
  timestamp?: string;
}

export class ConcurrencyError extends Error {}
export class IntegrityError extends Error {}

/** Durable JSONL journal with per-stream optimistic concurrency and a SHA-256 chain. */
export class FileJournal {
  readonly #path: string;
  readonly #lockPath: string;

  constructor(path: string) {
    this.#path = path;
    this.#lockPath = `${path}.lock`;
  }

  async append<T>(streamId: string, expectedVersion: number, event: AppendEvent<T>): Promise<JournalEntry<T>> {
    if (!streamId.trim() || !event.type.trim() || !event.actor.trim()) throw new Error('stream, type, and actor are required');
    await mkdir(dirname(this.#path), { recursive: true });
    const lock = await this.#acquireLock();
    try {
      const all = await this.readAll();
      const stream = all.filter((entry) => entry.streamId === streamId);
      if (stream.length !== expectedVersion) {
        throw new ConcurrencyError(`expected version ${expectedVersion}, actual ${stream.length}`);
      }
      const previousHash = all.at(-1)?.hash ?? null;
      const material = {
        sequence: all.length + 1,
        streamId,
        eventId: randomUUID(),
        type: event.type,
        actor: event.actor,
        timestamp: event.timestamp ?? new Date().toISOString(),
        payload: event.payload,
        previousHash,
      };
      const entry: JournalEntry<T> = { ...material, hash: hash(material) };
      await appendFile(this.#path, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', flush: true });
      return structuredClone(entry);
    } finally {
      await lock.close();
      await rm(this.#lockPath, { force: true });
    }
  }

  async readStream<T = unknown>(streamId: string): Promise<JournalEntry<T>[]> {
    return (await this.readAll()).filter((entry) => entry.streamId === streamId) as JournalEntry<T>[];
  }

  async readAll(): Promise<JournalEntry[]> {
    let content: string;
    try {
      content = await readFile(this.#path, 'utf8');
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
    const entries = content.split('\n').filter(Boolean).map((line, index) => {
      try {
        return JSON.parse(line) as JournalEntry;
      } catch {
        throw new IntegrityError(`invalid JSON at journal line ${index + 1}`);
      }
    });
    this.#verify(entries);
    return structuredClone(entries);
  }

  async #acquireLock() {
    try {
      return await open(this.#lockPath, 'wx');
    } catch (error) {
      if (isAlreadyExists(error)) throw new ConcurrencyError('journal is locked by another writer');
      throw error;
    }
  }

  #verify(entries: JournalEntry[]): void {
    let previousHash: string | null = null;
    entries.forEach((entry, index) => {
      if (entry.sequence !== index + 1) throw new IntegrityError(`invalid sequence at journal line ${index + 1}`);
      if (entry.previousHash !== previousHash) throw new IntegrityError(`broken hash chain at journal line ${index + 1}`);
      const { hash: recordedHash, ...material } = entry;
      if (hash(material) !== recordedHash) throw new IntegrityError(`content hash mismatch at journal line ${index + 1}`);
      previousHash = recordedHash;
    });
  }
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}
