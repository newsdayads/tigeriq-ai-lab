# TigerIQ — Current State

Date: 2026-09-12
Status: CURRENT — autonomous coding lane + Web Control verified
Authority: Owner instruction > Constitution/Workflow > CENTRAL #280 > Registry #335 > this snapshot > runtime/evidence

## Canonical architecture
- **TigerIQ Core 24/7** remains the primary orchestration/runtime service at `100.97.23.87:8795`.
- **TigerIQ Coding Lane 24/7** is a separate runtime at `100.97.23.87:8797` for repository implementation automation.
- **TigerIQ Web Control 24/7** is a separate read-only runtime at `100.97.23.87:8796`.
- Canonical source branch: `main`; normal engineering path is **GitHub branch → PR → CI/review → merge**.
- PC01 is runtime/diagnostics only. It is not a normal source-edit, coding, development-worktree, build, or web-deploy machine.
- Durable runtime state: PostgreSQL `5432`; local AI: Ollama `127.0.0.1:11434`.
- Execution boundary authority: `docs/EXECUTION_BOUNDARY.md`.

## Autonomous Coding Lane — VERIFIED
- AI Manager creates durable coding objectives/jobs using eligible free/trial resources.
- Implementer receives explicit file scope and writes only to an isolated branch `tigeriq/<nv>/<job>` through GitHub API.
- Direct Coding Lane writes to `main` are forbidden; merge occurs only through PR after required gates.
- Required gates: `CI Verify`, `Queue Hygiene Verify`, `Vercel Online Verify`.
- Independent reviewer must differ from implementer; review rejection returns the job for bounded fix/retest.
- Credential/security, paid AI, destructive operations, and production/release-control work fail closed.

## Coding Lane E2E evidence
- Initial smoke: `CODEOBJ-8740a833-8ffe-4d09-8794-a6eae79875f1` → `CODE-08c497bf-cfd8-40d8-865e-fc8c2689d048` → PR #604 → 3/3 gates PASS → NV11 review → merge `d6972207df30f43400cea9650c8168d272f1f7bf`.
- Persistent runtime: `CODEOBJ-02ee5c98-f679-40e2-9dd4-2b1cea5e8890` → `CODE-ddfc9b5f-5f19-4735-93d1-1e7bba38914e` → PR #607 → 3/3 gates PASS → NV11 review → merge `830c6b0fe8567a8702cb38a4de1ac7d453111649`.
- Autonomous GitHub intake E2E: issue #618 → `CODEOBJ-67adad52-5386-4ff8-b3a9-d653123ec222` → PR #619 merged → issue auto-closed with evidence.

## Web Control — VERIFIED FINAL
- Approved PR #602 design baseline was ported to current main through PR #626 instead of merging the stale branch directly.
- PR #628 added live Core + Coding Lane truth, real pipeline phases, compact NV cards, working filters, reconnect/last-known-data behavior, and removed fake progress.
- PR #629 fixed Web Control runtime bundle synchronization in the updater and removed favicon 404 console noise.
- Final merged runtime SHA: `01158d4e03f9d8f77c27224b3c3e27df8baccdb9`.
- Final browser matrix PASS: widths `1648/1366/1280/1024/768/624/430/390` × zoom `100/125%` = 16/16.
- Final matrix evidence: HTTP 200, no overflow, no connection banner, no console error, no page error, no failed network request; filter PASS.
- Pipeline shown from runtime truth: Intake → Running → Review → CI → Done → Blocked.
- Evidence: `docs/evidence/WEB-CONTROL-FINAL-20260912.md`.

## Path-aware runtime updater — VERIFIED
- Core paths → restart Core only.
- Web Control-only paths → synchronize approved runtime bundle and restart Web Control only.
- Coding Lane-only paths → restart Coding Lane only.
- Docs/other non-runtime paths → no service restart.
- Rollback path re-synchronizes the previous Web Control bundle before restart.
- PR #605 fixed prior PowerShell PID `.HasValue` defect.
- PR #629 finalized Web Control runtime bundle sync behavior.

## PC01 verified runtime
- Core `/health`: `ok=true`, PID `40448` at final Web Control verification.
- Coding Lane `/health`: `ok=true`, PID `24212`, 3 eligible resources.
- Web Control `/health`: `ok=true`, Core and Coding upstream healthy.
- Runtime Updater Scheduled Task: `Running` after PR #629 bootstrap activation.
- Web Control `/api/status` verified live Coding Lane truth; final sample contained 16 coding jobs and 18 coding objectives.

## GitHub governance
- `main` required checks remain `CI Verify`, `Queue Hygiene Verify`, `Vercel Online Verify`.
- Coding Lane creates job-specific branch and PR; no direct `main` source writes.
- GitHub branch protection remains final repository-side authority.
- Desktop Commander remains PC01 runtime operations/diagnostics only.

## Existing autonomy/integrations
- SurfSense #581 remains `ADOPTED_ON_DEMAND` through Core `/api/research`.
- Chrome DevTools MCP #582 remains completed with 3/3 final E2E PASS.
- Web Control is the read-only operator view for Core + Coding Lane runtime truth.

## AI resource truth
- Coding Lane active eligible resources: NV11 Groq, NV12 Gemini, NV19 Cohere.
- No paid fallback enabled.
- Deferred/broken providers remain excluded until separately repaired/authorized.

## Source of Truth
- CENTRAL #280: update target after Web Control finalization.
- Registry #335 = v42 unless separately changed.
- Interaction #504 = v14.
- Browser/authenticated UI guardrail = #497.
- Engineering execution boundary = `docs/EXECUTION_BOUNDARY.md`.
- Chat/memory is not runtime authority.

## Active work
- Web Control implementation/final QA: DONE.
- PR #602 is superseded by merged PRs #626/#628/#629 and should remain closed/not merged.
- Issue #627 final QA is complete after evidence/SOT merge.

STATE: `CURRENT_V46_WEB_CONTROL_FINAL_RUNTIME_TRUTH_UI_MATRIX_PASS_20260912`
