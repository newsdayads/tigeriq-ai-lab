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
      [{ ...transition, owner_hold: true }, 'VNEXT_OWNER_OR_HARD_HOLD_DENIED'],
      [{ ...transition, hard_gate: true }, 'VNEXT_OWNER_OR_HARD_HOLD_DENIED'],
      [{ ...transition, owner_hold: 'false' }, 'VNEXT_HOLD_FLAG_INVALID'],
      [{ ...transition, hard_gate: null }, 'VNEXT_HOLD_FLAG_INVALID'],
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

  it('fails closed on tampered persisted fields, without replay or extra writes', async () => {
    const db = saver();
    const obj = store(db);
    const saved = await obj.save(transition);
    const persisted = db.entries.get(saved.checkpoint_id);
    const original = structuredClone(persisted.checkpoint.channel_values.vnext_state);
    for (const field of ['phase', 'task_ids', 'plan_revision']) {
      persisted.checkpoint.channel_values.vnext_state = {
        ...original, [field]: field === 'task_ids' ? ['TAMPERED'] : 'tampered',
      };
      await expect(obj.read(transition.objective_id))
        .rejects.toThrow('VNEXT_STORED_CHECKPOINT_DIGEST_MISMATCH');
      await expect(obj.save(transition))
        .rejects.toThrow('VNEXT_STORED_CHECKPOINT_DIGEST_MISMATCH');
    }
    persisted.checkpoint.channel_values.vnext_state = { ...original, hard_gate: true };
    await expect(obj.read(transition.objective_id))
      .rejects.toThrow('VNEXT_STORED_CHECKPOINT_INVALID');
    persisted.checkpoint.channel_values.vnext_state = structuredClone(original);
    expect((await obj.save(transition)).replay).toBe(true);
    expect(db.writes).toBe(1);
  });

  it('rejects wrong-objective and wrong-checkpoint identity on read', async () => {
    const db = saver();
    const obj = store(db);
    const saved = await obj.save(transition);
    const persisted = db.entries.get(saved.checkpoint_id);
    const otherObjectiveStore = store({
      getTuple: async () => structuredClone(persisted),
      put: db.put.bind(db),
    });
    await expect(otherObjectiveStore.read('OBJ-GH-OTHER'))
      .rejects.toThrow('VNEXT_THREAD_MISMATCH');

    persisted.checkpoint.channel_values.vnext_state.objective_id = 'OBJ-GH-OTHER';
    await expect(obj.read(transition.objective_id))
      .rejects.toThrow('VNEXT_STORED_CHECKPOINT_DIGEST_MISMATCH');
    persisted.checkpoint.channel_values.vnext_state.objective_id = transition.objective_id;
    persisted.checkpoint.id = 'cp-corrupt';
    await expect(obj.read(transition.objective_id))
      .rejects.toThrow('VNEXT_STORED_CHECKPOINT_INVALID');
    expect(db.writes).toBe(1);
  });


  it('serializes divergent concurrent saves across adapter instances of one writer', async () => {
    for (const separateInstance of [false, true]) {
      const db = saver();
      // Capture a stale read BEFORE yielding: both saves race without an
      // objective-scoped critical section even when one-writer lease is valid.
      const delayed = {
        async getTuple(config) {
          const snapshot = await db.getTuple(config);
          if (!config.configurable.checkpoint_id)
            await new Promise(resolve => setImmediate(resolve));
          return snapshot;
        },
        put: (config, checkpoint, metadata, versions) =>
          db.put(config, checkpoint, metadata, versions),
      };
      const first = store(delayed);
      const second = separateInstance ? store(delayed) : first;
      const conflicting = { ...transition, transition_id: 'PLAN-0002',
        event_id: 'EVT-0002', plan_revision: 'rev-2', task_ids: ['TASK-B'] };
      const results = await Promise.allSettled([first.save(transition), second.save(conflicting)]);
      expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter(x => x.status === 'rejected')).toHaveLength(1);
      expect(results.find(x => x.status === 'rejected').reason.message)
        .toBe('VNEXT_CONFLICTING_REPLAY');
      expect(db.writes).toBe(1);
      expect(db.entries.size).toBe(1);
    }
  });

  it('deduplicates identical in-flight saves, even from separate instances', async () => {
    const db = saver();
    const a = store(db);
    const b = store(db);
    const results = await Promise.all([a.save(transition), b.save(transition)]);
    expect(results.map(r => r.written).sort()).toEqual([false, true]);
    expect(results[1].checkpoint_id).toBe(results[0].checkpoint_id);
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
