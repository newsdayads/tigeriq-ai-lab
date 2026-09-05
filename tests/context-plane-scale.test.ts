import { describe, expect, it } from 'vitest';
import { buildGlobalHotIndex, ContextPlane, type ContextRead, type ContextReader, type ContextRef, type GlobalHotIndex, type WorkerHotState } from '../packages/context-plane/src/index.js';

class FleetReader implements ContextReader {
  readonly values = new Map<string, ContextRead<unknown>>();
  fetches = 0;
  key(ref: ContextRef) { return `${ref.kind}:${ref.key}@${ref.revision ?? ''}`; }
  put<T>(ref: ContextRef, value: T) { this.values.set(this.key(ref), { value, revision: ref.revision, byteLength: 256 }); }
  async read<T = unknown>(ref: ContextRef): Promise<ContextRead<T>> {
    this.fetches++;
    await new Promise((resolve) => setTimeout(resolve, 2));
    const value = this.values.get(this.key(ref));
    if (!value) throw new Error(`MISSING:${this.key(ref)}`);
    return structuredClone(value) as ContextRead<T>;
  }
}

const central: ContextRef = { key: '#280', revision: 'c-scale', kind: 'authority' };
const registry: ContextRef = { key: '#335', revision: 'r-scale', kind: 'registry' };
const globalRef: ContextRef = { key: 'GLOBAL_HOT_INDEX', revision: 'i-scale', kind: 'global-index' };
const stateRef = (id: string): ContextRef => ({ key: `${id}.json`, revision: 's-scale', kind: 'hot-state' });

function workerState(id: string): WorkerHotState {
  return {
    schema: 'tigeriq-hot-state/v1',
    employee_id: id,
    revision: 's-scale',
    authority_revision: { central: 'c-scale', registry: 'r-scale' },
    current_work: null,
    lease: null,
    checkpoint: null,
    next_action: null,
    blockers: [],
    open_gates: [],
    evidence: [],
    updated_at: 1,
  };
}

describe('Context Plane fleet scale', () => {
  it('serves 200 concurrent startups for 20 employees with only 21 source fetches', async () => {
    const reader = new FleetReader();
    const commands: Record<string, string> = {};
    const employees: GlobalHotIndex['employees'] = {};
    const ids = Array.from({ length: 20 }, (_, i) => `NV${String(i + 1).padStart(2, '0')}`);
    ids.forEach((id, i) => {
      commands[String(i + 1)] = id;
      employees[id] = { employee_id: id, state: stateRef(id), enabled: true, background: true, activation_state: 'ACTIVE' };
      reader.put(stateRef(id), workerState(id));
    });
    reader.put(globalRef, buildGlobalHotIndex({ revision: 'i-scale', central, registry, commands, employees, generated_at: 1 }));
    const plane = new ContextPlane(reader);

    const calls = Array.from({ length: 10 }, () => ids.map((_, i) => plane.startup(String(i + 1), globalRef))).flat();
    const results = await Promise.all(calls);

    expect(results).toHaveLength(200);
    expect(results.every((x) => x.ok)).toBe(true);
    expect(reader.fetches).toBe(21); // 1 shared index + 20 per-employee compact states
    expect(plane.metrics().source_fetches).toBe(21);
    expect(plane.metrics().deep_reads).toBe(0);
    expect(plane.metrics().coalesced_reads).toBeGreaterThan(0);
  });
});
