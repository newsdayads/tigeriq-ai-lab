import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileJournal } from '../packages/event-store/src/index.js';
import { CapabilityScheduler, TaskQueue, VyAuthorityBridge, WorkforceRegistry, type AuthorityContext } from '../packages/workforce/src/index.js';
import { DurableWorkforceRuntime, MemoryWorkforceStateStore } from '../packages/workforce/src/runtime.js';

const dirs: string[] = [];
afterEach(async () => Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))));

async function bridge() {
  const dir = await mkdtemp(join(tmpdir(), 'tigeriq-vy-authority-'));
  dirs.push(dir);
  const registry = new WorkforceRegistry();
  const runtime = new DurableWorkforceRuntime(registry, new TaskQueue(), new CapabilityScheduler(registry), new MemoryWorkforceStateStore());
  let tick = 0;
  return new VyAuthorityBridge(runtime, new FileJournal(join(dir, 'authority.jsonl')), () => new Date(Date.UTC(2026, 8, 8, 0, 0, tick++)));
}

function context(key: string, overrides: Partial<AuthorityContext> = {}): AuthorityContext {
  return { actorId: 'Vy', workOrderId: 'WO-441', priority: 'P0', environment: 'off-main', idempotencyKey: key.padEnd(16, 'x'), ...overrides };
}

describe('Vy authoritative OFF-MAIN bridge', () => {
  it('allows the bounded NV02 -> NV01 dry-run transfer and writes checkpointed evidence', async () => {
    const app = await bridge();
    const claimed = await app.claim(context('claim-nv02-00001'), 'NV02', 'WO-441:auto-worker');
    const transferred = await app.transfer(context('transfer-nv02-nv01'), 'NV02', 'NV01', claimed.lease!.leaseId);
    const hash = 'a'.repeat(64);
    const written = await app.writeState(context('state-nv01-000001'), 'NV01', transferred.lease!.leaseId, 'DRY_RUN_NV02_TO_NV01_VALID', [hash, hash]);
    expect(written).toMatchObject({ checkpoint: 'DRY_RUN_NV02_TO_NV01_VALID', evidenceHashes: [hash], lease: { ownerId: 'NV01' } });
    expect((await app.read(context('read-authority-1'))).lease?.ownerId).toBe('NV01');
  });

  it('is idempotent and preserves one active owner', async () => {
    const app = await bridge();
    const request = context('same-claim-key-01');
    const first = await app.claim(request, 'NV02', 'WO-441:auto-worker');
    const replay = await app.claim(request, 'NV02', 'WO-441:auto-worker');
    expect(replay.lease?.leaseId).toBe(first.lease?.leaseId);
    await expect(app.claim(context('other-claim-key'), 'NV01', 'WO-441:auto-worker')).rejects.toThrow('active authority lease already exists');
  });

  it('rejects stale leases and leaves the current owner unchanged', async () => {
    const app = await bridge();
    const claimed = await app.claim(context('stale-claim-key1'), 'NV02', 'WO-441:auto-worker');
    const transferred = await app.transfer(context('stale-transferkey'), 'NV02', 'NV01', claimed.lease!.leaseId);
    await expect(app.release(context('stale-release-key'), 'NV02', claimed.lease!.leaseId)).rejects.toThrow('stale or unauthorized authority lease');
    expect((await app.read(context('stale-read-key00'))).lease?.leaseId).toBe(transferred.lease?.leaseId);
  });

  it('default-denies unauthorized actors and scopes', async () => {
    const app = await bridge();
    await expect(app.claim(context('actor-denied-key', { actorId: 'NV02' }), 'NV02', 'WO-441:auto-worker')).rejects.toThrow('unauthorized actor');
    await expect(app.claim(context('scope-denied-key', { priority: 'P1' }), 'NV02', 'WO-441:auto-worker')).rejects.toThrow('unauthorized scope');
    await expect(app.claim(context('main-denied-key0', { environment: 'main' }), 'NV02', 'WO-441:auto-worker')).rejects.toThrow('unauthorized scope');
  });
});
