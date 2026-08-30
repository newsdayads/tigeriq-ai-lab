import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileJournal } from '../packages/event-store/src/index.js';
import type { TaskPacket, WorkerResult } from '../packages/workforce/src/index.js';
import { DurableTaskMailbox } from '../packages/workforce/src/task-mailbox.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()?.(); });

function task(): TaskPacket {
  return {
    taskId: 'TASK-01', idempotencyKey: 'idem-01', objective: 'Collect bounded evidence', priority: 'P0',
    requiredCapabilities: ['android-ui'], constraints: ['no secrets'], inputs: [], expectedArtifacts: ['screenshot'],
    deadline: '2030-01-01T00:00:00.000Z', maxAttempts: 3,
    reviewPolicy: { independentReview: true, judgeRequired: true, preferProviderDiversity: true },
  };
}
function result(): WorkerResult {
  return { taskId: 'TASK-01', employeeId: 'EMP-01', status: 'completed', conclusion: 'done', confidence: 1,
    artifacts: [{ kind: 'screenshot', ref: 'evidence://shot-1' }], risks: [], completedAt: '2026-08-30T18:00:00.000Z' };
}

async function fixture(now: { value: number }) {
  const dir = await mkdtemp(join(tmpdir(), 'tigeriq-mailbox-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'mailbox.jsonl');
  return { path, mailbox: new DurableTaskMailbox(new FileJournal(path), () => new Date(now.value), 15_000) };
}

describe('DurableTaskMailbox', () => {
  it('persists lease metadata without raw token and accepts one idempotent result after restart', async () => {
    const now = { value: Date.parse('2026-08-30T18:00:00.000Z') };
    const first = await fixture(now);
    const lease = await first.mailbox.lease(task(), 'PHONE-01', 1);
    expect(lease.leaseToken).toBeTruthy();

    const restarted = new DurableTaskMailbox(new FileJournal(first.path), () => new Date(now.value), 15_000);
    const stored = await restarted.current('TASK-01');
    expect(stored?.nodeId).toBe('PHONE-01');
    expect(JSON.stringify(stored)).not.toContain(lease.leaseToken);

    const accepted = await restarted.acceptResult('TASK-01', 'PHONE-01', lease.leaseId, lease.leaseToken, result());
    expect(accepted.conclusion).toBe('done');
    const duplicate = await restarted.acceptResult('TASK-01', 'PHONE-01', lease.leaseId, lease.leaseToken, result());
    expect(duplicate.conclusion).toBe('done');
  });

  it('rejects stale/wrong leases and permits a bounded new attempt only after expiry', async () => {
    const now = { value: Date.parse('2026-08-30T18:00:00.000Z') };
    const app = await fixture(now);
    const first = await app.mailbox.lease(task(), 'PHONE-01', 1);
    await expect(app.mailbox.lease(task(), 'PHONE-02', 2)).rejects.toThrow('task already leased');
    await expect(app.mailbox.acceptResult('TASK-01', 'PHONE-01', first.leaseId, 'wrong', result())).rejects.toThrow('invalid task lease token');

    now.value += 15_001;
    await expect(app.mailbox.acceptResult('TASK-01', 'PHONE-01', first.leaseId, first.leaseToken, result())).rejects.toThrow('task lease expired');
    expect(await app.mailbox.expire('TASK-01')).toBe(true);
    const second = await app.mailbox.lease(task(), 'PHONE-02', 2);
    expect(second.nodeId).toBe('PHONE-02');
    await expect(app.mailbox.acceptResult('TASK-01', 'PHONE-01', first.leaseId, first.leaseToken, result())).rejects.toThrow('stale task lease');
  });

  it('refuses attempts beyond task maxAttempts', async () => {
    const now = { value: Date.parse('2026-08-30T18:00:00.000Z') };
    const app = await fixture(now);
    await expect(app.mailbox.lease(task(), 'PHONE-01', 4)).rejects.toThrow('invalid task lease');
  });
});
