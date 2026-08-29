# ADR 0002: Append-only audit log

- Status: Accepted
- Date: 2026-08-29

## Context

Mutable status alone cannot explain who authorized or performed a transition.

## Decision

Record lifecycle actions as append-only events containing actor, action, subject, timestamp, details, and the previous event hash. Corrections are new events, not edits.

## Consequences

Consumers reconstruct current state from event history and can detect broken hash chains. Durable immutable storage is deferred beyond Phase 0.
