# ADR 0005: Durable API state through snapshot events

Status: Accepted

## Decision

The HTTP API may use `DurableControlPlane`, which reconstructs a fresh domain instance from the latest journal snapshot for every command. A successful mutation is appended with the stream's expected version. Failed or conflicting appends do not become durable state, and reads always verify the journal chain first.

## Consequences

Work Orders and audit history survive process restart, and concurrent stale commands fail closed. Full snapshots simplify recovery at this stage but increase storage; event-specific reducers, compaction, durable idempotency responses, backup, and multi-node coordination remain future work.
