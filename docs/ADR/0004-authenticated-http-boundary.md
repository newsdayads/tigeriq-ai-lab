# ADR 0004: Authenticated HTTP boundary

Status: Accepted

## Context

Domain services cannot safely serve external callers without a narrow boundary for identity, authorization, validation, replay handling, and bounded resource use.

## Decision

Phase 3 adds a dependency-free Node HTTP API. Bearer tokens map to explicit actor identities and roles, comparisons use fixed-length SHA-256 values with timing-safe equality, mutation payloads require JSON and bounded bodies, and every mutation requires an actor-scoped idempotency key. The domain remains the final authorization authority.

## Consequences

The API is testable end-to-end and rejects unauthorized, malformed, oversized, or conflicting replay requests. Static token provisioning, TLS termination, rate limiting, durable idempotency, journal transaction integration, and Production-grade observability remain outside this phase.
