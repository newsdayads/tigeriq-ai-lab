# WO-PHASE8-ACTOR-RATE-LIMITS

- Status: APPROVED
- Authorization: Active autonomous continuation heartbeat on 2026-08-29.
- Base: verified `phase7/metrics-overload` / draft PR #9
- Delivery branch: `phase8/actor-rate-limits`

## Acceptance criteria

1. Authenticated actors receive independent configurable quotas.
2. Exhaustion returns 429 before domain work with retry guidance.
3. A separate actor remains unaffected.
4. Quotas reset after the configured window.
5. Public probes remain available without consuming actor quota.
6. Full local and independent CI gates pass.

## Safety

Single-process development control only. No public exposure, merge, or Production deployment.
