import { describe, expect, it, vi } from 'vitest';
import { LeaseRecoveryLoop } from '../apps/workforce-controller/src/lease-recovery-loop.js';
import type { RecoverySummary } from '../packages/work-state/src/types.js';

const empty: RecoverySummary = { expiredLeases: 0, requeuedJobs: 0, terminalJobs: 0 };

describe('LeaseRecoveryLoop', () => {
  it('sweeps expired leases using the supplied clock and reports recovery evidence', async () => {
    const recoverAfterRestart = vi.fn(async () => ({ expiredLeases: 2, requeuedJobs: 1, terminalJobs: 1 }));
    const onSweep = vi.fn();
    const loop = new LeaseRecoveryLoop(
      { recoverAfterRestart },
      { now: () => new Date('2026-09-10T00:00:00.000Z'), onSweep },
    );

    await expect(loop.sweep()).resolves.toEqual({ expiredLeases: 2, requeuedJobs: 1, terminalJobs: 1 });
    expect(recoverAfterRestart).toHaveBeenCalledWith('2026-09-10T00:00:00.000Z');
    expect(onSweep).toHaveBeenCalledWith({ expiredLeases: 2, requeuedJobs: 1, terminalJobs: 1 });
  });

  it('never overlaps recovery sweeps', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const recoverAfterRestart = vi.fn(async () => { await gate; return empty; });
    const loop = new LeaseRecoveryLoop({ recoverAfterRestart });

    const first = loop.sweep();
    await expect(loop.sweep()).resolves.toBeUndefined();
    expect(recoverAfterRestart).toHaveBeenCalledTimes(1);
    release();
    await expect(first).resolves.toEqual(empty);
  });

  it('fails closed on recovery errors and remains usable on the next sweep', async () => {
    const onError = vi.fn();
    const recoverAfterRestart = vi.fn()
      .mockRejectedValueOnce(new Error('postgres unavailable'))
      .mockResolvedValueOnce(empty);
    const loop = new LeaseRecoveryLoop({ recoverAfterRestart }, { onError });

    await expect(loop.sweep()).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(1);
    await expect(loop.sweep()).resolves.toEqual(empty);
    expect(recoverAfterRestart).toHaveBeenCalledTimes(2);
  });

  it('rejects an unsafe tight recovery interval', () => {
    expect(() => new LeaseRecoveryLoop({ recoverAfterRestart: async () => empty }, { intervalMs: 1000 }))
      .toThrow('lease recovery interval must be >= 5000ms');
  });
});
