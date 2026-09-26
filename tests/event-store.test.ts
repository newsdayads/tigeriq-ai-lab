import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConcurrencyError, FileJournal, IntegrityError } from '../packages/event-store/src/index.js';

const directories: string[] = [];

async function journal() {
  const directory = await mkdtemp(join(tmpdir(), 'tigeriq-journal-'));
  directories.push(directory);
  const path = join(directory, 'events.jsonl');
  return { path, store: new FileJournal(path) };
}

afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

describe('FileJournal', () => {
  it('persists events and recovers them with a valid hash chain', async () => {
    const { path, store } = await journal();
    const first = await store.append('WO-001', 0, { type: 'created', actor: 'planner-1', payload: { status: 'draft' }, timestamp: '2026-08-29T00:00:00Z' });
    const second = await store.append('WO-001', 1, { type: 'approved', actor: 'approver-1', payload: { status: 'approved' }, timestamp: '2026-08-29T00:01:00Z' });
    expect(second.previousHash).toBe(first.hash);
    const restarted = new FileJournal(path);
    const recovered = await restarted.readStream<{ status: string }>('WO-001');
    expect(recovered.map((entry) => entry.payload.status)).toEqual(['draft', 'approved']);
  });

  it('rejects stale writers through expected version', async () => {
    const { store } = await journal();
    await store.append('WO-001', 0, { type: 'created', actor: 'planner-1', payload: {} });
    await expect(store.append('WO-001', 0, { type: 'duplicate', actor: 'planner-2', payload: {} })).rejects.toBeInstanceOf(ConcurrencyError);
  });

  it('detects content tampering on restart', async () => {
    const { path, store } = await journal();
    await store.append('WO-001', 0, { type: 'created', actor: 'planner-1', payload: { status: 'draft' } });
    const content = await readFile(path, 'utf8');
    await writeFile(path, content.replace('draft', 'verified'));
    await expect(new FileJournal(path).readAll()).rejects.toBeInstanceOf(IntegrityError);
  });

  it('maintains one global chain across independent streams', async () => {
    const { store } = await journal();
    const first = await store.append('WO-001', 0, { type: 'created', actor: 'planner', payload: {} });
    const second = await store.append('WO-002', 0, { type: 'created', actor: 'planner', payload: {} });
    expect(second.sequence).toBe(2);
    expect(second.previousHash).toBe(first.hash);
  });

  it('rejects a second writer while the journal lock is held', async () => {
    const { path, store } = await journal();
    await writeFile(`${path}.lock`, 'writer-1');
    await expect(store.append('WO-001', 0, { type: 'created', actor: 'planner', payload: {} }))
      .rejects.toBeInstanceOf(ConcurrencyError);
  });
});
