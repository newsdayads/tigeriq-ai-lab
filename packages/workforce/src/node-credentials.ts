import { createHash, timingSafeEqual } from 'node:crypto';
import { FileJournal } from '../../event-store/src/index.js';
import type { NodeScope, PairedNodeCredential } from './pairing.js';
export type { NodeScope } from './pairing.js';

export interface NodeCredentialRecord {
  credentialId: string;
  nodeId: string;
  tokenHash: string;
  publicKeyFingerprint: string;
  scopes: NodeScope[];
  createdAt: string;
  revokedAt?: string;
}

type CredentialEvent =
  | { action: 'issued'; record: NodeCredentialRecord }
  | { action: 'revoked'; revokedAt: string };

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function safeHexEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export class DurableNodeCredentialStore {
  constructor(
    private readonly journal: FileJournal,
    private readonly actor = 'workforce-pairing',
    private readonly now: () => Date = () => new Date(),
  ) {}

  async issue(credential: PairedNodeCredential, publicKeyDerBase64: string): Promise<NodeCredentialRecord> {
    if (!credential.credentialId.trim() || !credential.nodeId.trim() || !credential.token.trim()) {
      throw new Error('invalid node credential');
    }
    const streamId = this.#streamId(credential.credentialId);
    const existing = await this.journal.readStream<CredentialEvent>(streamId);
    if (existing.length) throw new Error('credential already exists');
    const record: NodeCredentialRecord = {
      credentialId: credential.credentialId,
      nodeId: credential.nodeId,
      tokenHash: sha256(credential.token),
      publicKeyFingerprint: sha256(Buffer.from(publicKeyDerBase64, 'base64')),
      scopes: [...credential.scopes],
      createdAt: credential.createdAt,
    };
    await this.journal.append(streamId, 0, {
      type: 'workforce.node-credential.issued',
      actor: this.actor,
      payload: { action: 'issued', record } satisfies CredentialEvent,
      timestamp: credential.createdAt,
    });
    return cloneSafe(record);
  }

  async authenticate(credentialId: string, token: string, requiredScope: NodeScope): Promise<NodeCredentialRecord | undefined> {
    if (!credentialId.trim() || !token) return undefined;
    const record = await this.get(credentialId);
    if (!record || record.revokedAt || !record.scopes.includes(requiredScope)) return undefined;
    if (!safeHexEqual(record.tokenHash, sha256(token))) return undefined;
    return cloneSafe(record);
  }

  async revoke(credentialId: string): Promise<boolean> {
    const streamId = this.#streamId(credentialId);
    const events = await this.journal.readStream<CredentialEvent>(streamId);
    if (!events.length) return false;
    const current = reduce(events.map((entry) => entry.payload));
    if (!current || current.revokedAt) return Boolean(current);
    const revokedAt = this.now().toISOString();
    await this.journal.append(streamId, events.length, {
      type: 'workforce.node-credential.revoked',
      actor: this.actor,
      payload: { action: 'revoked', revokedAt } satisfies CredentialEvent,
      timestamp: revokedAt,
    });
    return true;
  }

  async get(credentialId: string): Promise<NodeCredentialRecord | undefined> {
    if (!credentialId.trim()) return undefined;
    const events = await this.journal.readStream<CredentialEvent>(this.#streamId(credentialId));
    const record = reduce(events.map((entry) => entry.payload));
    return record ? cloneSafe(record) : undefined;
  }

  #streamId(credentialId: string): string {
    return `workforce:credential:${credentialId}`;
  }
}

function reduce(events: CredentialEvent[]): NodeCredentialRecord | undefined {
  let record: NodeCredentialRecord | undefined;
  for (const event of events) {
    if (event.action === 'issued') record = { ...event.record, scopes: [...event.record.scopes] };
    if (event.action === 'revoked' && record) record.revokedAt = event.revokedAt;
  }
  return record;
}

function cloneSafe(record: NodeCredentialRecord): NodeCredentialRecord {
  return { ...record, scopes: [...record.scopes] };
}
