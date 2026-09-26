# WO-PHASE4-DURABLE-API

- Status: APPROVED
- Authorization: Project owner authorized continuous automatic implementation on 2026-08-29.
- Base: verified `phase3/http-api` / draft PR #5
- Delivery branch: `phase4/durable-api`

## Goal

Connect the authenticated API to the tamper-evident journal so lifecycle state and audit history recover after restart.

## Acceptance criteria

1. API mutations persist versioned Work Order snapshots in the journal.
2. Reads reconstruct the latest verified snapshot.
3. Work Order status and audit history survive an API restart.
4. Duplicate creation and stale writes fail with conflict rather than overwrite state.
5. The in-memory API remains available for isolated tests.
6. All local and independent CI gates pass.

## Safety

Single-node development storage only. No public exposure, merge, or Production deployment.
