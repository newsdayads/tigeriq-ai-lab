# WO-061 — Autonomous Coding Lane

Status: ACTIVE
Priority: P0
Owner: Vy / TigerIQ GitHub engineering lane
Date: 2026-09-12

## Goal
Enable API employees to receive coding work from an AI manager, implement changes on isolated GitHub branches, open PRs, wait for CI, receive independent AI review, revise automatically, and merge only when governance allows.

## Hard boundaries
- Never write directly to `main`.
- No local source edit/build/worktree on PC01.
- TigerIQ API Health/Core `:8795` must not be interrupted by Coding Lane rollout.
- Paid AI, credentials/security, destructive, release/production-control changes fail closed.
- Official Coding Lane runtime uses only API resources with verified free/trial proof.

## Runtime architecture
- Separate service: `apps/tigeriq-coding-lane/` on `:8797`.
- Durable coding queue: PostgreSQL tables `tigeriq_coding_objectives` and `tigeriq_coding_jobs`.
- Manager selects exact repository paths and creates a coding job.
- Implementer NV writes only those paths to a generated `tigeriq/<nv>/<job>` branch through GitHub API.
- A different NV performs independent review.
- Required checks: `CI Verify`, `Queue Hygiene Verify`, `Vercel Online Verify`.
- Review failures return to implementer for up to 3 fix/retest cycles.
- Merge is attempted only after CI PASS + independent review approval; GitHub branch protection remains authoritative.

## Runtime updater
`update-core-runtime.ps1` becomes path-aware:
- Core source change → restart Core.
- Web Control-only change → restart Web Control only.
- Coding Lane-only change → restart Coding Lane only.
- Docs/other non-runtime change → no service restart.

## Acceptance
1. CI validates branch isolation, protected-path blocking, independent review, gate-before-merge and updater path isolation.
2. Coding Lane runs separately on PC01 without changing Core PID.
3. E2E creates a harmless repository change through Manager → API NV → branch → PR → CI → reviewer.
4. Auto-merge succeeds only if GitHub governance permits; otherwise record the exact governance blocker without bypass.
5. Source of Truth is updated with evidence.
