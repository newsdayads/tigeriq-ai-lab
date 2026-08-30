import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileJournal } from '../packages/event-store/src/index.js';
import { DurableNodeCredentialStore } from '../packages/workforce/src/node-credentials.js';
import { NodePairingService, verifyAndroidP256PairingProof } from '../packages/workforce/src/pairing.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function journal() {
  const dir = await mkdtemp(join(tmpdir(), 'tigeriq-credentials-'));
  dirs.push(dir);
  return new FileJournal(join(dir, 'credentials.jsonl'));
}

function deviceKey() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const publicKeyBase64 = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  return {
    publicKeyBase64,
    proof(challenge: string) {
      return sign('sha256', Buffer.from(challenge, 'utf8'), privateKey).toString('base64url');
    },
  };
}

describe('workforce node security', () => {
  it('verifies a real P-256 signature compatible with Android Keystore EC signing', () => {
    const key = deviceKey();
    const challenge = 'challenge-123';
    expect(verifyAndroidP256PairingProof({
      publicKey: key.publicKeyBase64,
      challenge,
      proof: key.proof(challenge),
    })).toBe(true);
    expect(verifyAndroidP256PairingProof({
      publicKey: key.publicKeyBase64,
      challenge: 'tampered',
      proof: key.proof(challenge),
    })).toBe(false);
  });

  it('persists only token hashes and authenticates after controller restart', async () => {
    const fileJournal = await journal();
    const key = deviceKey();
    const pairing = new NodePairingService(verifyAndroidP256PairingProof);
    const challenge = pairing.issueChallenge();
    const paired = await pairing.pair({
      challengeId: challenge.challengeId,
      nodeId: 'PHONE-01',
      publicKey: key.publicKeyBase64,
      proof: key.proof(challenge.challenge),
    });

    const store1 = new DurableNodeCredentialStore(fileJournal);
    const saved = await store1.issue(paired, key.publicKeyBase64);
    expect(saved.tokenHash).not.toBe(paired.token);
    expect(saved.tokenHash).toHaveLength(64);

    const store2 = new DurableNodeCredentialStore(fileJournal);
    const authenticated = await store2.authenticate(paired.credentialId, paired.token, 'heartbeat');
    expect(authenticated?.nodeId).toBe('PHONE-01');
    expect(await store2.authenticate(paired.credentialId, 'wrong-token', 'heartbeat')).toBeUndefined();

    expect(await store2.revoke(paired.credentialId)).toBe(true);
    expect(await store2.authenticate(paired.credentialId, paired.token, 'heartbeat')).toBeUndefined();
    expect((await store2.get(paired.credentialId))?.revokedAt).toBeTruthy();
  });
});
