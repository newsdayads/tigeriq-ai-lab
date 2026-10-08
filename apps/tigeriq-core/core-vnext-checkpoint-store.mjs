import { createHash } from 'node:crypto';
import { stableObjectiveThreadId } from './world-model-contract.mjs';

// Isolated adapter only. No Core route calls this module and no schema migration is implicit.
export const CORE_VNEXT_CHECKPOINT_NAMESPACE = 'tigeriq-core-vnext-shadow-v1';

const KINDS = new Set(['plan', 'replan', 'dispatch_proposal', 'acceptance']);

function fail(code) { throw new Error(code); }
function token(value, code) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,159}$/.test(value)) fail(code);
  return value;
}
function digest(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function normalizedTransition(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('VNEXT_TRANSITION_INVALID');
  const objectiveId = token(input.objective_id, 'VNEXT_OBJECTIVE_ID_INVALID');
  const sourceRevision = token(input.source_revision, 'VNEXT_SOURCE_REVISION_INVALID');
  const transitionId = token(input.transition_id, 'VNEXT_TRANSITION_ID_INVALID');
  const eventId = token(input.event_id, 'VNEXT_EVENT_ID_INVALID');
  const kind = token(input.kind, 'VNEXT_KIND_INVALID');
  if (!KINDS.has(kind)) fail('VNEXT_KIND_UNSUPPORTED');
  const priority = token(input.priority, 'VNEXT_PRIORITY_INVALID');
  if (!/^P[1-5]$/.test(priority)) fail('VNEXT_P0_OR_INVALID_PRIORITY_DENIED');
  if (input.owner_gate !== null && input.owner_gate !== undefined) fail('VNEXT_OWNER_GATE_DENIED');
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 0 || input.sequence > 999_999_999) fail('VNEXT_SEQUENCE_INVALID');
  const phase = token(input.phase, 'VNEXT_PHASE_INVALID');
  const planRevision = token(input.plan_revision, 'VNEXT_PLAN_REVISION_INVALID');
  if (!Array.isArray(input.task_ids) || input.task_ids.length > 100 ||
      input.task_ids.some(x => typeof x !== 'string')) fail('VNEXT_TASK_IDS_INVALID');
  const taskIds = input.task_ids.map(x => token(x, 'VNEXT_TASK_ID_INVALID'));
  if (new Set(taskIds).size !== taskIds.length) fail('VNEXT_DUPLICATE_TASK_ID');
  if (input.live_dispatch === true || input.production_release === true) fail('VNEXT_EFFECT_DENIED');
  if (input.live_dispatch !== undefined && input.live_dispatch !== false) fail('VNEXT_EFFECT_INVALID');
  if (input.production_release !== undefined && input.production_release !== false) fail('VNEXT_EFFECT_INVALID');
  return Object.freeze({
    objective_id: objectiveId, source_revision: sourceRevision,
    transition_id: transitionId, event_id: eventId, kind, priority, owner_gate: null,
    sequence: input.sequence, phase, plan_revision: planRevision,
    task_ids: Object.freeze(taskIds), live_dispatch: false, production_release: false,
  });
}
function configuration(objectiveId, checkpointId) {
  const configurable = { thread_id: stableObjectiveThreadId(objectiveId), checkpoint_ns: CORE_VNEXT_CHECKPOINT_NAMESPACE };
  if (checkpointId) configurable.checkpoint_id = checkpointId;
  return { configurable };
}
function checkpointOf(tuple) {
  const state = tuple?.checkpoint?.channel_values?.vnext_state;
  if (!tuple) return null;
  if (!state || typeof state !== 'object' || typeof state.digest !== 'string' ||
      !Number.isSafeInteger(state.sequence)) fail('VNEXT_STORED_CHECKPOINT_INVALID');
  return state;
}

// Caller must hold the verified existing one-writer lease. This is NOT an autonomous lease provider.
export function createCoreVNextCheckpointStore({
  checkpointer, enabled = false, schemaReady = false, verifyWriterLease = async () => false,
} = {}) {
  if (!checkpointer || typeof checkpointer.getTuple !== 'function' || typeof checkpointer.put !== 'function')
    fail('VNEXT_CHECKPOINTER_INVALID');

  async function read(objectiveId) {
    if (!enabled || !schemaReady) fail('VNEXT_CHECKPOINT_DISABLED_OR_SCHEMA_NOT_READY');
    const tuple = await checkpointer.getTuple(configuration(token(objectiveId, 'VNEXT_OBJECTIVE_ID_INVALID')));
    const state = checkpointOf(tuple);
    return state ? Object.freeze({ ...state }) : null;
  }

  async function save(input, { nowMs = Date.now() } = {}) {
    if (!enabled || !schemaReady) fail('VNEXT_CHECKPOINT_DISABLED_OR_SCHEMA_NOT_READY');
    const row = normalizedTransition(input);
    if (!Number.isFinite(nowMs)) fail('VNEXT_TIMESTAMP_INVALID');
    const permitted = async () => (await verifyWriterLease({
      objective_id: row.objective_id, resource_scope: 'TIGERIQ_CORE_VNEXT_CHECKPOINT_V1',
    })) === true;
    if (!await permitted()) fail('VNEXT_WRITER_LEASE_REQUIRED');
    const stateDigest = digest(row);
    const checkpointId = 'cp-' + String(row.sequence).padStart(10, '0') + '-' + stateDigest.slice(0, 20);
    const root = configuration(row.objective_id);
    const latestTuple = await checkpointer.getTuple(root);
    const latest = checkpointOf(latestTuple);
    if (latest) {
      if (latest.objective_id !== row.objective_id) fail('VNEXT_THREAD_MISMATCH');
      if (latest.sequence === row.sequence) {
        if (latest.digest !== stateDigest || latestTuple.checkpoint.id !== checkpointId) fail('VNEXT_CONFLICTING_REPLAY');
        return Object.freeze({ written: false, replay: true, checkpoint_id: checkpointId, state: latest });
      }
      if (latest.sequence + 1 !== row.sequence) fail('VNEXT_SEQUENCE_GAP_OR_STALE');
      if (latest.source_revision !== row.source_revision) fail('VNEXT_SOURCE_REVISION_CHANGED');
    } else if (row.sequence !== 0) fail('VNEXT_FIRST_SEQUENCE_MUST_BE_ZERO');

    if (!await permitted()) fail('VNEXT_WRITER_LEASE_LOST');
    const payload = Object.freeze({ ...row, digest: stateDigest });
    const version = row.sequence + 1;
    const checkpoint = {
      v: 4, id: checkpointId, ts: new Date(nowMs).toISOString(),
      channel_values: { vnext_state: payload },
      channel_versions: { vnext_state: version }, versions_seen: {},
    };
    const parent = latestTuple?.config?.configurable?.checkpoint_id;
    await checkpointer.put(configuration(row.objective_id, parent), checkpoint, {
      source: 'update', step: row.sequence, writes: {}, parents: {},
      objective_id: row.objective_id, source_revision: row.source_revision,
      transition_id: row.transition_id, event_id: row.event_id,
    }, { vnext_state: version });
    const verified = await checkpointer.getTuple(configuration(row.objective_id, checkpointId));
    if (checkpointOf(verified)?.digest !== stateDigest) fail('VNEXT_WRITE_READBACK_MISMATCH');
    return Object.freeze({ written: true, replay: false, checkpoint_id: checkpointId, state: payload });
  }

  return Object.freeze({ read, save });
}
