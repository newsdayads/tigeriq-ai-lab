import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export type NodeScope = 'register' | 'heartbeat' | 'task:read' | 'task:result';

export interface PairingChallenge {
  challengeId: string;
  challenge: string;
  expiresAt: string;
}

export interface PairingRequest {
  challengeId: string;
  nodeId: string;
  publicKey: string;
  proof: string;
}

export interface PairedNodeCredential {
  credentialId: string;
  nodeId: string;
  token: string;
  scopes: NodeScope[];
  createdAt: string;
}

interface StoredChallenge {
  challengeHash: string;
  expiresAtMs: number;
  used: boolean;
}

interface StoredCredential {
  credentialId: string;
  nodeId: string;
  tokenHash: string;
  publicKeyFingerprint: string;
  scopes: NodeScope[];
  revoked: boolean;
  createdAt: string;
}

export type PairingProofVerifier = (input: {
  publicKey: string;
  challenge: string;
  proof: string;
}) => Promise<boolean> | boolean;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

function safeHashEqual(leftHex: string, rightHex: string): boolean {
  const left = Buffer.from(leftHex, 'hex');
  const right = Buffer.from(rightHex, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

export class NodePairingService {
  readonly #challenges = new Map<string, StoredChallenge>();
  readonly #credentials = new Map<string, StoredCredential>();
  readonly #challengePlaintext = new Map<string, string>();

  constructor(
    private readonly verifyProof: PairingProofVerifier,
    private readonly now: () => Date = () => new Date(),
    private readonly challengeTtlMs = 5 * 60_000,
  ) {
    if (challengeTtlMs < 30_000 || challengeTtlMs > 15 * 60_000) {
      throw new Error('challenge TTL must be between 30 seconds and 15 minutes');
    }
  }

  issueChallenge(): PairingChallenge {
    const challengeId = randomToken(18);
    const challenge = randomToken(32);
    const expiresAtMs = this.now().getTime() + this.challengeTtlMs;
    this.#challenges.set(challengeId, {
      challengeHash: sha256(challenge),
      expiresAtMs,
      used: false,
    });
    this.#challengePlaintext.set(challengeId, challenge);
    return {
      challengeId,
      challenge,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  }

  async pair(request: PairingRequest): Promise<PairedNodeCredential> {
    const stored = this.#challenges.get(request.challengeId);
    if (!stored) throw new Error('pairing challenge not found');
    if (stored.used) throw new Error('pairing challenge already used');

    const challenge = this.#challengePlaintext.get(request.challengeId);
    if (!challenge) throw new Error('pairing challenge not found');
    if (this.now().getTime() > stored.expiresAtMs) throw new Error('pairing challenge expired');
    if (!safeHashEqual(stored.challengeHash, sha256(challenge))) throw new Error('pairing challenge integrity failure');
    if (!request.nodeId.trim()) throw new Error('nodeId is required');
    if (!request.publicKey.trim()) throw new Error('publicKey is required');
    if (!request.proof.trim()) throw new Error('proof is required');

    const verified = await this.verifyProof({
      publicKey: request.publicKey,
      challenge,
      proof: request.proof,
    });
    if (!verified) throw new Error('pairing proof verification failed');

    stored.used = true;
    this.#challengePlaintext.delete(request.challengeId);

    const token = randomToken(32);
    const credentialId = randomToken(18);
    const scopes: NodeScope[] = ['register', 'heartbeat', 'task:read', 'task:result'];
    const createdAt = this.now().toISOString();
    this.#credentials.set(credentialId, {
      credentialId,
      nodeId: request.nodeId,
      tokenHash: sha256(token),
      publicKeyFingerprint: sha256(request.publicKey),
      scopes,
      revoked: false,
      createdAt,
    });

    return {
      credentialId,
      nodeId: request.nodeId,
      token,
      scopes: [...scopes],
      createdAt,
    };
  }

  authenticate(credentialId: string, token: string, requiredScope: NodeScope): boolean {
    const credential = this.#credentials.get(credentialId);
    if (!credential || credential.revoked) return false;
    if (!credential.scopes.includes(requiredScope)) return false;
    return safeHashEqual(credential.tokenHash, sha256(token));
  }

  revoke(credentialId: string): boolean {
    const credential = this.#credentials.get(credentialId);
    if (!credential) return false;
    credential.revoked = true;
    return true;
  }

  credentialMetadata(credentialId: string): Omit<StoredCredential, 'tokenHash'> | undefined {
    const credential = this.#credentials.get(credentialId);
    if (!credential) return undefined;
    const { tokenHash: _tokenHash, ...metadata } = credential;
    return { ...metadata, scopes: [...metadata.scopes] };
  }
}
