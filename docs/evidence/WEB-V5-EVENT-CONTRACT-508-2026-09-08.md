# Web Control V5 — Live Event Contract

Issue: #508  
Parent: #507  
Scope: OFF-MAIN design/preparation only. Runtime apply remains gated by #318 reboot recovery evidence.

## Safety invariants

- An open issue/Work Order alone never implies active execution.
- `work.*` active state requires a compatible lease/heartbeat/evidence projection.
- `source_evidence_ref` is mandatory for execution-state events; consumers must fail closed when absent.
- `correlation_id` and `idempotency_key` are stable per logical operation/event emission.
- One work/resource/account-session has at most one active owner.
- Unknown event types are ignored safely by older clients; malformed events are rejected rather than rendered as active state.
- No secret, credential, private browser path, token, or raw account/session data is emitted.

## Event types

Required baseline event names:

- `work.queued`
- `work.claimed`
- `work.started`
- `work.step`
- `work.heartbeat`
- `work.blocked`
- `work.failed`
- `work.completed`
- `system.health`
- `system.error`
- `system.recovered`

## Common envelope

```ts
type WebControlEvent<T extends string, P> = {
  schema_version: 1;
  event_type: T;
  event_id: string;
  occurred_at: string; // ISO-8601 UTC
  entity_type: 'work' | 'system';
  entity_id: string;
  correlation_id: string;
  idempotency_key: string;
  source_evidence_ref: string;
  payload: P;
};
```

## Work payload

```ts
type WorkPayload = {
  owner_id?: string;
  worker_id?: string;
  phase?: string;
  step?: string;
  status: 'queued' | 'claimed' | 'running' | 'blocked' | 'failed' | 'completed';
  heartbeat_at?: string;
  next_action?: string;
  error_code?: string;
};
```

`work.heartbeat` must include `heartbeat_at`; `work.started`, `work.step`, `work.blocked`, `work.failed`, and `work.completed` must include enough phase/step/status data to reconstruct the current lifecycle without guessing.

## System payload

```ts
type SystemPayload = {
  component_id: string;
  status: 'healthy' | 'degraded' | 'stale' | 'failed' | 'recovered';
  observed_at: string;
  last_error_code?: string;
};
```

## Consumer rules

1. Deduplicate by `idempotency_key`.
2. Reject events with invalid/missing envelope fields.
3. Order by `occurred_at`, then `event_id` for deterministic ties.
4. Compute `last_activity_age` from the latest accepted heartbeat/activity event; do not use client receipt time.
5. If age exceeds the configured stale threshold, render `stale` / `có thể đang treo` and never keep an active green state solely because the Work Order is open.
6. A stream disconnect must not erase the last verified state; mark freshness unknown until reconnection or safe polling evidence arrives.
7. On reconnect, replay/dedupe from the last known event cursor; duplicate events must not create duplicate timeline entries.

## SSE boundary

The future SSE endpoint should emit the same JSON envelope as above with `event:` set to `event_type` and `id:` set to `event_id`. Transport failure must fall back to evidence-backed polling; polling must not create a second authority or fabricate events.

## Acceptance mapping

- Event ordering/dedupe: covered by deterministic consumer tests.
- Reconnect without duplicate timeline: covered by SSE adapter tests.
- Heartbeat stale threshold: covered by time-controlled tests.
- Stream loss/fallback/resume: covered by adapter integration tests.
- No fake active state: covered by authority/evidence gate tests.
- No sensitive leakage: covered by payload allow-list tests.

## Current gate

This document is design/preparation evidence only. It does **not** prove runtime SSE, heartbeat, or reboot recovery. Those require implementation tests and, for runtime application, the #318 reboot-recovery gate.
