import { describe, expect, it } from 'vitest';
import type { FileJournal } from '../packages/event-store/src/index.js';
import { FileJournalWorkManagementStateStore } from '../packages/work-management/src/journal-store.js';
import type { WorkManagementSnapshot } from '../packages/work-management/src/types.js';

function snapshot(sequence: number, historySequences: number[]): WorkManagementSnapshot {
  return {
    version: 1,
    sequence,
    goals: [],
    history: historySequences.map((eventSequence, index) => ({
      sequence: eventSequence,
      at: `2026-09-03T08:0${index}:00.000Z`,
      goalId: 'G-INTEGRITY',
      type: 'goal_submitted',
      detail: 'integrity fixture',
    })),
  };
}

describe('Work Management snapshot evidence integrity', () => {
  it('rejects duplicate or out-of-order history sequence before persistence', async () => {
    const store = new FileJournalWorkManagementStateStore({} as FileJournal);
    await expect(store.save(snapshot(2, [1, 1]))).rejects.toThrow(/history sequence/i);
    await expect(store.save(snapshot(2, [2, 1]))).rejects.toThrow(/history sequence/i);
  });

  it('rejects snapshot.sequence that does not match the last retained history event', async () => {
    const store = new FileJournalWorkManagementStateStore({} as FileJournal);
    await expect(store.save(snapshot(3, [1, 2]))).rejects.toThrow(/sequence\/history mismatch/i);
  });
});
