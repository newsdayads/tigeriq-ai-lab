# ADR 0008: Bounded metrics and overload protection

Status: Accepted

## Decision

Protect the API with a configurable in-process concurrency limiter that returns 503 before protected work begins when capacity is exhausted. Collect aggregate request counts, status counts, active requests, rejected-overload count, and average duration. Expose metrics only to the operator role and never attach headers, bodies, query values, actor IDs, or Work Order IDs.

## Consequences

The single-node API fails closed under local concurrency pressure and offers low-cardinality operational signals. Distributed rate limits, histograms, metrics persistence/export, and tenant quotas remain future work.
