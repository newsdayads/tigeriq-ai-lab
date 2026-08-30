# ADR 0009: Actor-scoped rate limits

Status: Accepted

## Decision

Apply a configurable fixed-window quota after authentication and before route execution. Quotas are keyed by actor identity, return 429 with retry guidance when exhausted, and do not affect public health/readiness probes. Actor isolation prevents one credential from consuming another actor's quota.

## Consequences

The API gains simple single-process abuse and accident protection. Distributed quotas, persistence, endpoint weights, trusted-proxy IP policy, and adaptive limiting remain future work.
