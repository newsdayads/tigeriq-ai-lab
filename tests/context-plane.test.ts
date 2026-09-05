import { describe, expect, it } from 'vitest';
import {
  buildGlobalHotIndex,
  ContextPlane,
  type ContextRead,
  type ContextReader,
  type ContextRef,
  type GlobalHotIndex,
  type WorkerHotState,
} from '../packages/context-plane/src/index.js';

class MemoryReader implements ContextReader {
  readonly values = new Map<string, ContextRead<unknown>>();
  readonly counts = new Map<string, number>();
  delayMs = 0;

  put<T>(ref: ContextRef, value: T, byteLength = 100): void {
    this.values.set(this.key(ref), { value, revision: ref.revision, sha: ref.sha, byteLength });
  }

  async read<T = unknown>(ref: ContextRef): Promise<ContextRead<T>> {
    const key = this.key(ref);
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
    if (this.delayMs) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    const value = this.values.get(key);
    if (!value) throw new Error(`MISSING:${key}`);
    return structuredClone(value) as ContextRead<T>;
  }

  count(ref: ContextRef): number {
    return this.counts.get(this.key(ref)) ?? 0;
  }

  key(ref: ContextRef): string {
    return `${ref.kind}:${ref.key}@${ref.revision ?? ''}#${ref.sha ?? ''}`;
  }
}

const central = (revision = 'c1'): ContextRef => ({ key: '#280', revision, kind: 'authority' });
const registry = (revision = 'r1'): ContextRef => ({ key: '#335', revision, kind: 'registry' });
const indexRef = (revision = 'i1'): ContextRef => ({ key: 'GLOBAL_HOT_INDEX', revision, kind: 'global-index' });
const stateRef = (employee: string, revision = 's1'): ContextRef => ({ key: `${employee}.json`, revision, kind: 'hot-state' });

function state(employee: string, stateRevision = 's1', c = 'c1', r = 'r1'): WorkerHotState {
  return {
    schema: 'tigeriq-hot-state/v1',
    employee_id: employee,
    revision: stateRevision,
    authority_revision: { central: c, registry: r },
    current_work: '#441',
    lease: null,
    checkpoint: { key: `${employee}/CHECKPOINT.md`, revision: 'p1', kind: 'checkpoint' },
    next_action: 'continue',
    blockers: [],
    open_gates: [],
    evidence: [],
    updated_at: 1,
  };
}

function index(employeeIds: string[], revision = 'i1', c = 'c1', r = 'r1'): GlobalHotIndex {
  const commands: Record<string, string> = {};
  const employees: GlobalHotIndex['employees'] = {};
  employeeIds.forEach((id, i) => {
    const command = String(i + 1);
    commands[command] = id;
    employees[id] = {
      employee_id: id,
      state: stateRef(id),
      enabled: true,
      background: id !== 'NV01',
      activation_state: 'ACTIVE',
    };
  });
  return buildGlobalHotIndex({ revision, central: central(c), registry: registry(r), commands, employees, generated_at: 1 });
}

describe('ContextPlane v3', () => {
  it('coalesces concurrent startup reads for the same employee', async () => {
    const reader = new MemoryReader();
    reader.delayMs = 10;
    const idx = index(['NV02']);
    reader.put(indexRef(), idx, 500);
    reader.put(stateRef('NV02'), state('NV02'), 250);
    const plane = new ContextPlane(reader);

    const results = await Promise.all(Array.from({ length: 20 }, () => plane.startup('1', indexRef())));
    expect(results.every((x) => x.ok)).toBe(true);
    expect(reader.count(indexRef())).toBe(1);
    expect(reader.count(stateRef('NV02'))).toBe(1);
    expect(plane.metrics().source_fetches).toBe(2);
    expect(plane.metrics().coalesced_reads).toBeGreaterThan(0);
  });

  it('shares one global index across many employees and loads only each compact hot state', async () => {
    const reader = new MemoryReader();
    reader.delayMs = 5;
    const ids = ['NV01', 'NV02', 'NV04', 'NV05', 'NV06', 'NV07'];
    const idx = index(ids);
    reader.put(indexRef(), idx, 700);
    ids.forEach((id) => reader.put(stateRef(id), state(id), 220));
    const plane = new ContextPlane(reader);

    const results = await Promise.all(ids.map((_, i) => plane.startup(String(i + 1), indexRef())));
    expect(results.every((x) => x.ok)).toBe(true);
    expect(reader.count(indexRef())).toBe(1);
    expect(plane.metrics().source_fetches).toBe(1 + ids.length);
    expect(plane.metrics().deep_reads).toBe(0);
  });

  it('uses cached immutable snapshots on warm starts', async () => {
    const reader = new MemoryReader();
    reader.put(indexRef(), index(['NV02']));
    reader.put(stateRef('NV02'), state('NV02'));
    const plane = new ContextPlane(reader);

    expect((await plane.startup('1', indexRef())).ok).toBe(true);
    const firstFetches = plane.metrics().source_fetches;
    expect((await plane.startup('1', indexRef())).ok).toBe(true);
    expect(plane.metrics().source_fetches).toBe(firstFetches);
    expect(plane.metrics().cache_hits).toBeGreaterThanOrEqual(2);
  });

  it('naturally invalidates when the index and state revisions change', async () => {
    const reader = new MemoryReader();
    reader.put(indexRef('i1'), index(['NV02'], 'i1', 'c1', 'r1'));
    reader.put(stateRef('NV02', 's1'), state('NV02', 's1', 'c1', 'r1'));
    const plane = new ContextPlane(reader);
    expect((await plane.startup('1', indexRef('i1'))).ok).toBe(true);

    const idx2 = buildGlobalHotIndex({
      revision: 'i2',
      central: central('c2'),
      registry: registry('r2'),
      commands: { '1': 'NV02' },
      employees: {
        NV02: { employee_id: 'NV02', state: stateRef('NV02', 's2'), enabled: true, background: true, activation_state: 'ACTIVE' },
      },
      generated_at: 2,
    });
    reader.put(indexRef('i2'), idx2);
    reader.put(stateRef('NV02', 's2'), state('NV02', 's2', 'c2', 'r2'));

    expect((await plane.startup('1', indexRef('i2'))).ok).toBe(true);
    expect(reader.count(indexRef('i2'))).toBe(1);
    expect(reader.count(stateRef('NV02', 's2'))).toBe(1);
  });

  it('fails closed on stale authority instead of silently deep-loading history', async () => {
    const reader = new MemoryReader();
    reader.put(indexRef(), index(['NV02'], 'i1', 'c2', 'r2'));
    reader.put(stateRef('NV02'), state('NV02', 's1', 'c1', 'r1'));
    const plane = new ContextPlane(reader);

    const result = await plane.startup('1', indexRef());
    expect(result.ok).toBe(false);
    expect(result.error).toBe('HOT_STATE_AUTHORITY_STALE');
    expect(result.requires_deep_read).toBe(true);
    expect(plane.metrics().deep_reads).toBe(0);
  });

  it('deep-reads evidence only when explicitly requested', async () => {
    const reader = new MemoryReader();
    const evidenceRef: ContextRef = { key: '#441/comments', revision: 'e1', kind: 'evidence' };
    reader.put(indexRef(), index(['NV02']));
    reader.put(stateRef('NV02'), state('NV02'));
    reader.put(evidenceRef, { pass: true }, 10_000);
    const plane = new ContextPlane(reader);

    expect((await plane.startup('1', indexRef())).ok).toBe(true);
    expect(reader.count(evidenceRef)).toBe(0);
    await plane.deepRead(evidenceRef);
    expect(reader.count(evidenceRef)).toBe(1);
    expect(plane.metrics().deep_reads).toBe(1);
  });
});
