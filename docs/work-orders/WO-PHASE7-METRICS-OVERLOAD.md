# WO-PHASE7-METRICS-OVERLOAD

- Status: APPROVED
- Authorization: Active autonomous continuation heartbeat on 2026-08-29.
- Base: verified `phase6/runtime-guardrails` / draft PR #8
- Delivery branch: `phase7/metrics-overload`

## Acceptance criteria

1. API concurrency has a configurable positive bound.
2. Exhausted capacity returns 503 without entering protected work.
3. Aggregate metrics track completion, status, latency, active work, and overload rejection.
4. Metrics contain no secrets, payloads, query values, actor IDs, or Work Order IDs.
5. Metrics require the operator role.
6. Full local and independent CI gates pass.

## Safety

In-process development controls only. No public exposure, merge, or Production deployment.
