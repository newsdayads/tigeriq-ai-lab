import { describe, expect, it } from 'vitest';
import { buildGlobalHotIndex, ContextPlane, type ContextRead, type ContextReader, type ContextRef, type WorkerHotState } from '../packages/context-plane/src/index.js';

class Reader implements ContextReader {
  readonly data = new Map<string, ContextRead<unknown>>();
  reads = 0;
  key(ref: ContextRef) { return `${ref.kind}:${ref.key}@${ref.revision ?? ''}`; }
  put<T>(ref: ContextRef, value: T) { this.data.set(this.key(ref), { value, revision: ref.revision, byteLength: 200 }); }
  async read<T = unknown>(ref: ContextRef): Promise<ContextRead<T>> {
    this.reads++;
    const value = this.data.get(this.key(ref));
    if (!value) throw new Error(`MISSING:${this.key(ref)}`);
    return structuredClone(value) as ContextRead<T>;
  }
}

const central: ContextRef = { key: '#280', revision: 'central-current', kind: 'authority' };
const registry: ContextRef = { key: '#335', revision: 'registry-current', kind: 'registry' };
const globalRef: ContextRef = { key: 'GLOBAL_HOT_INDEX', revision: 'fleet-1', kind: 'global-index' };
const stateRef = (id: string): ContextRef => ({ key: `${id}.json`, revision: 'state-1', kind: 'hot-state' });

function state(id: string): WorkerHotState {
  return {
    schema: 'tigeriq-hot-state/v1',
    employee_id: id,
    revision: 'state-1',
    authority_revision: { central: 'central-current', registry: 'registry-current' },
    current_work: id === 'NV02' ? '#441' : null,
    lease: null,
    checkpoint: null,
    next_action: null,
    blockers: [],
    open_gates: [],
    evidence: [],
    updated_at: 1,
  };
}

describe('TigerIQ command semantics through Context Plane v3', () => {
  it('preserves commands 1..5 without activating pending workers', async () => {
    const reader = new Reader();
    const index = buildGlobalHotIndex({
      revision: 'fleet-1',
      central,
      registry,
      commands: { '1': 'NV01', '2': 'NV02', '3': 'NV03', '4': 'NV04', '5': 'NV05' },
      employees: {
        NV01: { employee_id: 'NV01', state: stateRef('NV01'), enabled: true, background: false, activation_state: 'ACTIVE' },
        NV02: { employee_id: 'NV02', state: stateRef('NV02'), enabled: true, background: true, activation_state: 'ACTIVE' },
        NV03: { employee_id: 'NV03', state: stateRef('NV03'), enabled: false, background: false, activation_state: 'PAUSED', unavailable_error: 'COMMAND_UNREGISTERED/TẠM_NGƯNG' },
        NV04: { employee_id: 'NV04', state: stateRef('NV04'), enabled: true, background: false, activation_state: 'PENDING_OWNER_ACTIVATION' },
        NV05: { employee_id: 'NV05', state: stateRef('NV05'), enabled: false, background: false, activation_state: 'PENDING_OWNER_ACTIVATION', unavailable_error: 'COMMAND_PENDING_ACTIVATION' },
      },
      generated_at: 1,
    });
    reader.put(globalRef, index);
    reader.put(stateRef('NV01'), state('NV01'));
    reader.put(stateRef('NV02'), state('NV02'));
    reader.put(stateRef('NV04'), state('NV04'));
    const plane = new ContextPlane(reader);

    const one = await plane.startup('1', globalRef);
    const two = await plane.startup('2', globalRef);
    const three = await plane.startup('3', globalRef);
    const four = await plane.startup('4', globalRef);
    const five = await plane.startup('5', globalRef);

    expect({ ok: one.ok, employee: one.employee_id, background: one.background }).toEqual({ ok: true, employee: 'NV01', background: false });
    expect({ ok: two.ok, employee: two.employee_id, background: two.background }).toEqual({ ok: true, employee: 'NV02', background: true });
    expect({ ok: three.ok, error: three.error }).toEqual({ ok: false, error: 'COMMAND_UNREGISTERED/TẠM_NGƯNG' });
    expect({ ok: four.ok, employee: four.employee_id, background: four.background, activation: four.activation_state }).toEqual({ ok: true, employee: 'NV04', background: false, activation: 'PENDING_OWNER_ACTIVATION' });
    expect({ ok: five.ok, error: five.error }).toEqual({ ok: false, error: 'COMMAND_PENDING_ACTIVATION' });
    expect(plane.metrics().source_fetches).toBe(4); // 1 global + active/specialized states only
    expect(plane.metrics().deep_reads).toBe(0);
  });
});
