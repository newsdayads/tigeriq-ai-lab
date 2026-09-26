# WO-PHASE2-DURABLE-JOURNAL

- Project: TigerIQ AI Lab
- Status: APPROVED
- Authorization: Project owner instructed continuous execution on 2026-08-29.
- Base: verified `phase1/control-plane` / draft PR #3
- Delivery branch: `phase2/durable-journal`

## Goal

Add a restart-safe, tamper-evident persistence primitive for Control Plane events without introducing Production infrastructure.

## Acceptance criteria

1. Events survive store reconstruction and can be read per Work Order stream.
2. Every event is linked into a verified SHA-256 chain.
3. Modified content or a broken sequence/hash is rejected.
4. A stale expected version cannot append.
5. Concurrent writers cannot enter the append critical section together.
6. Typecheck, unit tests, Playwright smoke, build, and independent CI pass.

## Safety and rollback

No external service, `main` mutation, merge, or Production deployment. Roll back by deleting the stacked Phase 2 branch/PR.
