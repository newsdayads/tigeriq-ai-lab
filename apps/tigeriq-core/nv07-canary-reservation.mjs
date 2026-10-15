import { createHash } from 'node:crypto';
import { NV07_CANARY_CORE_SCOPE } from './shared-resource-lease.mjs';

const JOB = /^[a-z0-9:_-]{6,128}$/i;
const SHA = /^[a-f0-9]{40}$/i;
const RESOURCE = /^[a-z0-9:_-]{6,128}$/i;

// Core's existing event ledger is durable. The partial unique index is a
// cross-process, crash-safe one-shot reservation fence for this one canary.
export async function ensureNv07CanaryReservationIndex(db) {
  if (!db || typeof db.query !== 'function') return false;
  await db.query(
    "create unique index if not exists tigeriq_nv07_once_per_job_idx " +
    "on tigeriq_events(job_id) where type='NV07_CANARY_RESERVED' and employee_id='NV07'",
  );
  return true;
}

const denied = code => Object.freeze({
  accepted: false, durable: false, code, state: 'DENIED_NOT_RESERVED',
});

function validPinnedIdentity({ jobId, sourceSha, resourceId, idempotencyKey, resourceScope }) {
  return JOB.test(String(jobId || '')) && SHA.test(String(sourceSha || ''))
    && RESOURCE.test(String(resourceId || ''))
    && typeof idempotencyKey === 'string' && idempotencyKey.length >= 16
    && idempotencyKey.length <= 128
    && resourceScope === NV07_CANARY_CORE_SCOPE;
}

// This Core-private primitive never trusts an LLM/job payload for authority.
// One INSERT sees the live DB lease and makes an atomic immutable reservation.
// The unique index denies replay, even between separate Core processes.
export async function reserveNv07OneShotCanary(db, pinned = {}) {
  if (!db || typeof db.query !== 'function') return denied('NV07_RESERVATION_DB_UNAVAILABLE');
  if (!validPinnedIdentity(pinned)) return denied('NV07_RESERVATION_IDENTITY_INVALID');
  const { jobId, sourceSha, resourceId, idempotencyKey } = pinned;
  const idempotencyHash = createHash('sha256').update(idempotencyKey, 'utf8').digest('hex');
  const scope = NV07_CANARY_CORE_SCOPE;
  const evidence = JSON.stringify({
    workOrderId: 4783, resourceScope: scope, sourceSha, idempotencyHash,
    state: 'RESERVED_NOT_EXECUTED', source: 'CORE_CANONICAL_LEASE',
  });
  const sql = [
    "insert into tigeriq_events(type,job_id,employee_id,resource_id,task_kind,data)",
    "select 'NV07_CANARY_RESERVED',$1,'NV07',$3,'nv07_bootstrap',$5::jsonb",
    "from tigeriq_ai_resource_leases l",
    "join tigeriq_ai_resources r on r.resource_id=l.resource_id",
    "where l.employee_id='NV07' and l.work_id=$1 and l.resource_id=$3",
    "and l.lease_until>now() and l.lane='nv07_bootstrap' and l.role='canary'",
    "and r.employee_id='NV07' and r.enabled=true and r.current_job_id=l.work_id",
    "and l.metadata->>'workOrderId'='4783'",
    "and l.metadata->>'resourceScope'=$6",
    "and l.metadata->>'sourceSha'=$2",
    "and l.metadata->>'action'='READ_METADATA'",
    "and l.metadata->>'idempotencyKey'=$4",
    "on conflict do nothing returning seq",
  ].join('\n');
  const result = await db.query(sql,
    [jobId, sourceSha, resourceId, idempotencyKey, evidence, scope]);
  const seq = result?.rows?.[0]?.seq;
  if (seq === null || seq === undefined) return denied('NV07_CANARY_LEASE_OR_ONE_SHOT_DENIED');
  return Object.freeze({
    accepted: true, durable: true, code: 'NV07_CANARY_RESERVED_ONCE',
    state: 'RESERVED_NOT_EXECUTED', reservationSeq: String(seq),
  });
}

// Bind identity solely from the trusted Core; host cannot replace source SHA
// or resource ID via the callback request. No bearer lease token is emitted.
export function bindNv07CoreReservationCallback(db, { jobId, sourceSha, resourceId } = {}) {
  const pinned = { jobId, sourceSha, resourceId, resourceScope: NV07_CANARY_CORE_SCOPE };
  const valid = validPinnedIdentity({ ...pinned, idempotencyKey: 'PIN_VALIDATION_ONLY' });
  return async ({ jobId: requestedJobId, resourceScope, idempotencyKey } = {}) => {
    if (!valid || requestedJobId !== jobId || resourceScope !== NV07_CANARY_CORE_SCOPE)
      return denied('NV07_CANARY_RESERVATION_SCOPE_DENIED');
    return reserveNv07OneShotCanary(db, { ...pinned, idempotencyKey });
  };
}
