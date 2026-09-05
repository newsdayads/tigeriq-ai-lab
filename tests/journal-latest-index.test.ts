import { describe, expect, it } from 'vitest';
import { JournalLatestIndex } from '../packages/event-store/src/latest-index.js';
import type { JournalEntry } from '../packages/event-store/src/index.js';

function entry(sequence: number, streamId: string, type = 'x'): JournalEntry {
  return {
    sequence,
    streamId,
    eventId: `e${sequence}`,
    type,
    actor: 'test',
    timestamp: '2026-09-05T00:00:00.000Z',
    payload: { sequence },
    previousHash: sequence === 1 ? null : `h${sequence - 1}`,
    hash: `h${sequence}`,
  };
}

describe('JournalLatestIndex', () => {
  it('loads the canonical journal once then serves repeated latest/version reads from index', async () => {
    let loads = 0;
    const index = new JournalLatestIndex(async () => {
      loads++;
      return [entry(1, 'a'), entry(2, 'b'), entry(3, 'a')];
    });
    expect((await index.latest('a'))?.sequence).toBe(3);
    expect(await index.version('a')).toBe(2);
    expect((await index.latest('b'))?.sequence).toBe(2);
    expect(loads).toBe(1);
  });

  it('records a successful canonical append without a full reload', async () => {
    let loads = 0;
    const index = new JournalLatestIndex(async () => { loads++; return [entry(1, 'a')]; });
    await index.warm();
    index.record(entry(2, 'a'));
    expect((await index.latest('a'))?.sequence).toBe(2);
    expect(await index.version('a')).toBe(2);
    expect(loads).toBe(1);
  });

  it('invalidates and reloads when out-of-process mutation is possible', async () => {
    let loads = 0;
    let data = [entry(1, 'a')];
    const index = new JournalLatestIndex(async () => { loads++; return data; });
    expect((await index.latest('a'))?.sequence).toBe(1);
    data = [entry(1, 'a'), entry(2, 'a')];
    index.invalidate();
    expect((await index.latest('a'))?.sequence).toBe(2);
    expect(loads).toBe(2);
  });
});
