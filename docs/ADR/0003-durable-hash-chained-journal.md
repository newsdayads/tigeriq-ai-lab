# ADR 0003: Durable hash-chained journal

Status: Accepted

## Context

Phase 1 state is process-local. Restart loses state, concurrent writers can overwrite decisions, and an in-memory audit trail cannot demonstrate later tampering.

## Decision

Phase 2 introduces an append-only JSON Lines journal. Every entry has a global sequence, stream identity, actor, timestamp, payload, previous-entry hash, and its own SHA-256 content hash. Writes use an exclusive lock and per-stream expected version. Reads verify the complete chain before returning data.

## Consequences

The journal survives restart, detects stale writes and tampering, and remains human-inspectable. It is a single-node foundation, not a distributed database: stale-lock recovery, key-backed signatures, encryption, retention, backup, and multi-node consensus remain future work.
