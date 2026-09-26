# WO-PHASE6-RUNTIME-GUARDRAILS

- Status: APPROVED
- Authorization: Project owner instructed continuation on 2026-08-29.
- Base: verified `phase5/operational-safety` / draft PR #7
- Delivery branch: `phase6/runtime-guardrails`

## Acceptance criteria

1. Requests have a finite configurable timeout.
2. Drain removes readiness and rejects new protected work.
3. Close stops accepting traffic and bounds graceful completion time.
4. Structured completion events contain correlation and timing fields.
5. Logs exclude bearer tokens, request bodies, and query strings.
6. Full local and independent CI gates pass.

## Safety

No public exposure, merge, or Production deployment.
