# Vy authority bridge — OFF-MAIN evidence

Scope: `vy/authority-bridge-off-main` only. This artifact does not authorize MAIN, Production, deployment, or any PC01 mutation.

## Implemented boundary

`VyAuthorityBridge` is a narrow adapter over the existing `DurableWorkforceRuntime` and hash-chained `FileJournal`:

- accepts only `actorId=Vy`, `priority=P0`, and `environment=off-main`;
- supports only `queue.claim`, `queue.release`, `lease.transfer`, and `state.write`;
- records every accepted operation in the existing append-only journal, checkpoints the existing workforce runtime, and replays exact idempotent requests;
- preserves one active owner per Work Order stream and rejects stale/unauthorized leases;
- requires bounded checkpoint text and SHA-256 evidence hashes for `state.write`.

## DRY-RUN

The deterministic, temporary-journal test uses the current authoritative APP Work Order `WO-441` and performs:

1. Vy claims `WO-441:auto-worker` for `NV02`.
2. Vy transfers the exact active lease `NV02 -> NV01`.
3. Vy writes checkpoint `DRY_RUN_NV02_TO_NV01_VALID` with a SHA-256 evidence hash.
4. Readback confirms `NV01` is the sole active owner.

This is a test-only DRY-RUN; it does not connect to or mutate a production/runtime journal.

## Verification

Executed locally on 2026-09-08:

- `npm test -- --run tests/vy-authority-bridge.test.ts` — 4/4 passed.
- `npm run typecheck` — passed.
- `npm run ci` — passed: Vercel policy, typecheck, 98 unit tests, 1 Playwright E2E test, and build.

## Remaining gates

Independent automated review and exact-head GitHub CI remain required for the OFF-MAIN PR. MAIN/Production deployment is neither requested nor authorized.
