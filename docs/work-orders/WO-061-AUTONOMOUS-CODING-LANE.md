# WO-061 — Autonomous Coding Lane

Status: DONE
Priority: P0
Owner: Vy / TigerIQ GitHub engineering lane
Date: 2026-09-12

## Goal
Enable API employees to receive coding work from an AI manager, implement changes on isolated GitHub branches, open PRs, wait for CI, receive independent AI review, revise automatically, and merge only when governance allows.

## Hard boundaries
- Never write directly to `main` from Coding Lane jobs.
- No local source edit/build/development worktree on PC01.
- TigerIQ API Health/Core `:8795` must not be restarted for Coding Lane/Web Control-only changes.
- Paid AI, credentials/security, destructive, release/production-control changes fail closed.
- Official Coding Lane runtime uses only API resources with verified free/trial proof.

## Runtime architecture
- Separate service: `apps/tigeriq-coding-lane/` on `:8797`.
- Durable coding queue: PostgreSQL tables `tigeriq_coding_objectives` and `tigeriq_coding_jobs`.
- Manager selects exact repository paths and creates a coding job.
- Implementer NV writes only those paths to a generated `tigeriq/<nv>/<job>` branch through GitHub API.
- A different NV performs independent review.
- Required checks: `CI Verify`, `Queue Hygiene Verify`, `Vercel Online Verify`.
- Review failures return to implementer for bounded fix/retest cycles.
- Merge is attempted only after CI PASS + independent review approval; GitHub branch protection remains authoritative.

## Runtime updater
`update-core-runtime.ps1` is path-aware:
- Core source change → restart Core.
- Web Control-only change → restart Web Control only.
- Coding Lane-only change → restart Coding Lane only.
- Docs/other non-runtime change → no service restart.

## Acceptance evidence
1. CI regression coverage validates branch isolation, protected-path blocking, independent review, gate-before-merge, free-only resource policy and updater path isolation.
2. Coding Lane runs as `TigerIQ Coding Lane 24x7` Scheduled Task on PC01 and remains separate from Core.
3. E2E #1: PR #604, NV12 implementer, NV11 reviewer, 3/3 gates PASS, merged.
4. E2E #2 from persistent Scheduled Task runtime: PR #607, branch `tigeriq/nv12/code-ddfc9b5f-5f19-4735-93d1-1e7bba38914e`, NV12 implementer, NV11 reviewer, 3/3 gates PASS, merged as `830c6b0fe8567a8702cb38a4de1ac7d453111649`.
5. Updater PR #605 fixed nullable PID runtime state handling.
6. Web-only updater E2E PR #606 recorded `coreRestarted=false`, `webRestarted=true`; Core PID stayed `28696`, Web Control PID changed `23856 → 31396`.
7. Core/API Health remained healthy through the final verified E2E sequence.
8. Source of Truth is reconciled in `docs/CURRENT_STATE.md` and CENTRAL #280 v45.

## Resolved rollout incident
The first rollout attempt was caught while the legacy updater was still active and restarted Core once. The updater was replaced with the path-aware version, its PID-state defect was fixed in PR #605, and the final Web Control-only E2E proves non-Core changes no longer restart Core.

STATE: `WO061_DONE_AUTONOMOUS_CODING_LANE_E2E_PATH_AWARE_UPDATER_PASS`
