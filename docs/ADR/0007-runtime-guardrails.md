# ADR 0007: Runtime guardrails and redacted observability

Status: Accepted

## Decision

The API has a bounded request timeout, a drain state that removes readiness and rejects new protected work, and graceful close with an upper grace period. Completed-request logs contain only correlation ID, method, normalized path, status, and duration; authorization headers, bodies, and query strings are excluded.

## Consequences

Orchestrators can stop traffic before shutdown and operators gain useful request telemetry without routine secret/payload exposure. Metrics export, trace propagation, log transport, overload limiting, and distributed shutdown coordination remain future work.
