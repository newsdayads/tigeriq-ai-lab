# ADR 0002: Phase 1 in-memory control plane

Status: Accepted

## Context

Phase 0 defined contracts but did not provide an executable lifecycle authority. Persistence and network APIs would add operational complexity before the invariants are proven.

## Decision

Phase 1 implements a deterministic in-memory control plane around the existing Work Order, Evidence, Gate, and Audit contracts. It enforces role-authorized transitions, evidence references, independent gate evaluation, fail-closed verification, and a SHA-256-linked audit history.

## Consequences

The domain behavior can be tested without infrastructure. State is intentionally ephemeral; durable append-only storage, authentication, concurrency control, and an HTTP boundary are required before multi-process or Production use.
