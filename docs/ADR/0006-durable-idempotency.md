# ADR 0006: Durable idempotency responses

Status: Accepted

## Decision

Persist completed mutation responses in a separate tamper-evident journal, keyed by actor and idempotency key. Requests compare a method/path/body fingerprint before replay. An identical request returns the original status and body after restart; different content with the same key returns conflict.

## Consequences

Single-node retries become restart-safe without mixing operational responses into domain streams. In-progress reservations and distributed exactly-once execution require a transactional store and remain future work.
