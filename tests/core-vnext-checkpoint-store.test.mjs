import { describe, expect, it } from 'vitest';
import { createCoreVNextCheckpointStore, CORE_VNEXT_CHECKPOINT_NAMESPACE } from '../apps/tigeriq-core/core-vnext-checkpoint-store.mjs';

function saver({ failBefore = false, failAfter = false } = {}) {
  const entries = new Map();
  let writes = 0;
  return {
    entries,
    get writes() { return writes; },
    async getTuple(config) {
      const { thread_id, checkpoint_ns, checkpoint_id } = config.configurable;
      if (checkpoint_ns !== CORE_VNEXT_CHECKPOINT_NAMESPACE) throw Error('WRONG_NAMESPACE');
      const found = [...entries.values()].filter(x => x.config.configurable.thread_id === thread_id);
      const tuple = checkpoint_id
        ? found.find(x => x.checkpoint.id === checkpoint_id)
        : found.sort((a, b) => b.checkpoint.id.localeCompare(a.checkpoint.id))[0];
      return tuple ? structuredClone(tuple) : undefined;
    },
    async put(config, checkpoint, metadata, versions) {
      if (failBefore) { failBefore = false; throw Error('CRASH_BEFORE_COMMIT'); }
      const next = { configurable: { ...config.configurable, checkpoint_id: checkpoint.id } };
      const tuple = { config: next, checkpoint: structuredClone(checkpoint), metadata, versions, parentConfig: config.configurable.checkpoint_id ? config : undefined };
      entries.set(checkpoint.id, tuple);
      writes++;
      if (failAfter) { failAfter = false; throw Error('CRASH_AFTER_COMMIT_BEFORE_ACK'); }
      return next;
    },
  };
}
const transition = {
  objective_id: 'OBJ-GH-4457', source_revision: 'main@d0542965',
  transition_id: 'PLAN-0001', event_id: 'EVT-0001',
  kind: 'plan', priority: 'P1', owner_gate: null, sequence: 0,
  phase: 'shadow', plan_revision: 'rev-1', task_ids: ['TASK-A'],
  live_dispatch: false, production_release: false,
};
const store = (db, overrides = {}) => createCoreVNextCheckpointStore({
  checkpointer: db, enabled: true, schemaReady: true,
  verifyWriterLease: async () => true, ...overrides,
});

describe('Core vNext durable checkpoint adapter (isolated, not connected to live Core)', () => {
  it('is fail-closed without both explicit write gates or verified writer lease', async () => {
    const db = saver();
    await expect(createCoreVNextCheckpointStore({ checkpointer: db }).save(transition))
      .rejects.toThrow('VNEXT_CHECKPOINT_DISABLED_OR_SCHEMA_NOT_READY');
    await expect(store(db, { schemaReady: false }).save(transition))
      .rejects.toThrow('VNEXT_CHECKPOINT_DISABLED_OR_SCHEMA_NOT_READY');
    await expect(store(db, { verifyWriterLease: async () => false }).save(transition))
      .rejects.toThrow('VNEXT_WRITER_LEASE_REQUIRED');
    expect(db.writes).toBe(0);
  });

  it('rejects P0, Owner holds, effects, malformed transitions and bad sequence before writes', async () => {
    const db = saver();
    for (const [row, code] of [
      [{ ...transition, priority: 'P0' }, 'VNEXT_P0_OR_INVALID_PRIORITY_DENIED'],
      [{ ...transition, owner_gate: 'OWNER_HOLD' }, 'VNEXT_OWNER_GATE_DENIED'],
      [{ ...transition, live_dispatch: true }, 'VNEXT_EFFECT_DENIED'],
      [{ ...transition, production_release: true }, 'VNEXT_EFFECT_DENIED'],
      [{ ...transition, sequence: 1 }, 'VNEXT_FIRST_SEQUENCE_MUST_BE_ZERO'],
      [{ ...transition, task_ids: ['TASK-A', 'TASK-A'] }, 'VNEXT_DUPLICATE_TASK_ID'],
    ]) await expect(store(db).save(row)).rejects.toThrow(code);
    expect(db.writes).toBe(0);
  });

  it('writes a v4 LangGraph checkpoint with parent chain, replays identically, and rejects conflicts', async () => {
    const db = saver();
    const obj = store(db);
    const first = await obj.save(transition, { nowMs: 1791450000000 });
    expect(first).toMatchObject({ written: true, replay: false });
    expect(db.writes).toBe(1);
    const replay = await obj.save(transition, { nowMs: 1791452000000 });
    expect(replay).toMatchObject({ written: false, replay: true, checkpoint_id: first.checkpoint_id });
    expect(db.writes).toBe(1);
    await expect(obj.save({ ...transition, task_ids: ['OTHER-TASK'] })).rejects.toThrow('VNEXT_CONFLICTING_REPLAY');
    const second = await obj.save({ ...transition, sequence: 1, transition_id: 'PLAN-0002', event_id: 'EVT-0002', plan_revision: 'rev-2' });
    expect(second.written).toBe(true);
    expect(await obj.read(transition.objective_id)).toMatchObject({ sequence: 1, plan_revision: 'rev-2' });
    const firstRecord = db.entries.get(first.checkpoint_id);
    expect(firstRecord.checkpoint).toMatchObject({
      v: 4, id: first.checkpoint_id,
      channel_versions: { vnext_state: 1 },
      channel_values: { vnext_state: { objective_id: transition.objective_id, digest: first.state.digest } },
    });
    expect(db.entries.get(second.checkpoint_id).parentConfig.configurable.checkpoint_id).toBe(first.checkpoint_id);
    expect(db.writes).toBe(2);
    await expect(obj.save({ ...transition, sequence: 3 })).rejects.toThrow('VNEXT_SEQUENCE_GAP_OR_STALE');
    await expect(obj.save(transition)).rejects.toThrow('VNEXT_SEQUENCE_GAP_OR_STALE');
    await expect(obj.save({ ...transition, sequence: 2, source_revision: 'main@other' })).rejects.toThrow('VNEXT_SOURCE_REVISION_CHANGED');
  });

  it('reacquires persisted checkpoint on restart after crash between commit and acknowledgement', async () => {
    const db = saver({ failAfter: true });
    await expect(store(db).save(transition)).rejects.toThrow('CRASH_AFTER_COMMIT_BEFORE_ACK');
    expect(db.writes).toBe(1);
    const recovered = await store(db).save(transition);
    expect(recovered).toMatchObject({ written: false, replay: true });
    expect(db.writes).toBe(1);
  });

  it('safely retries after a crash before durable commit, without phantom success', async () => {
    const db = saver({ failBefore: true });
    await expect(store(db).save(transition)).rejects.toThrow('CRASH_BEFORE_COMMIT');
    expect(db.writes).toBe(0);
    expect((await store(db).save(transition)).written).toBe(true);
    expect(db.writes).toBe(1);
  });

  it('rechecks writer lease before committing, never calling checkpointer.put on loss', async () => {
    const db = saver();
    let count = 0;
    const lease = store(db, { verifyWriterLease: async () => ++count === 1 });
    await expect(lease.save(transition)).rejects.toThrow('VNEXT_WRITER_LEASE_LOST');
    expect(db.writes).toBe(0);
  });
});
