import { FileJournal } from '../../event-store/src/index.js';

export interface IdempotencyResponse {
  fingerprint: string;
  status: number;
  body: unknown;
}

export interface IdempotencyStore {
  get(actorId: string, key: string): Promise<IdempotencyResponse | undefined>;
  put(actorId: string, key: string, value: IdempotencyResponse): Promise<void>;
}

export class MemoryIdempotencyStore implements IdempotencyStore {
  readonly #values = new Map<string, IdempotencyResponse>();
  async get(actorId: string, key: string) { return structuredClone(this.#values.get(`${actorId}:${key}`)); }
  async put(actorId: string, key: string, value: IdempotencyResponse) {
    const identity = `${actorId}:${key}`;
    if (this.#values.has(identity)) throw new Error('idempotency record already exists');
    this.#values.set(identity, structuredClone(value));
  }
}

export class JournalIdempotencyStore implements IdempotencyStore {
  readonly #journal: FileJournal;
  constructor(path: string) { this.#journal = new FileJournal(path); }

  async get(actorId: string, key: string): Promise<IdempotencyResponse | undefined> {
    const entries = await this.#journal.readStream<IdempotencyResponse>(stream(actorId, key));
    return entries.at(-1)?.payload;
  }

  async put(actorId: string, key: string, value: IdempotencyResponse): Promise<void> {
    await this.#journal.append(stream(actorId, key), 0, {
      type: 'idempotency.response-recorded', actor: actorId, payload: structuredClone(value),
    });
  }
}

function stream(actorId: string, key: string): string {
  return `idempotency:${actorId}:${key}`;
}
