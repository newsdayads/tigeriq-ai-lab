# WO-PHASE3-HTTP-API

- Project: TigerIQ AI Lab
- Status: APPROVED
- Authorization: Project owner authorized fully automatic continuation on 2026-08-29.
- Base: verified `phase2/durable-journal` / draft PR #4
- Delivery branch: `phase3/http-api`

## Goal

Expose the evidence-gated Control Plane through a bounded, authenticated HTTP interface suitable for integration testing, not Production.

## Acceptance criteria

1. Health is public; Work Order state requires authentication.
2. Bearer credentials resolve to explicit actors and existing domain role separation remains enforced.
3. Mutation bodies are size-bounded, JSON-only, and structurally validated.
4. Mutations require actor-scoped idempotency; identical replay is stable and conflicting reuse is rejected.
5. An end-to-end API flow can create, approve, run, attach evidence, and independently verify a Work Order.
6. Typecheck, unit/integration tests, Playwright smoke, build, and independent CI pass.

## Safety and rollback

Bind to loopback by default. No stored credentials, TLS claim, public exposure, `main` mutation, merge, or Production deployment. Roll back by deleting the stacked Phase 3 branch/PR.
