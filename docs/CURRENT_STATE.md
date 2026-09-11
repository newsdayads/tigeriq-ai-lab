# TigerIQ — Current State

Date: 2026-09-12
Status: CURRENT — autonomous coding lane verified
Authority: Owner instruction > Constitution/Workflow > CENTRAL #280 > Registry #335 > this snapshot > runtime/evidence

## Canonical architecture
- **TigerIQ Core 24/7** remains the primary orchestration/runtime service at `100.97.23.87:8795`.
- **TigerIQ Coding Lane 24/7** is a separate runtime at `100.97.23.87:8797` for repository implementation automation.
- **TigerIQ Web Control 24/7** remains a separate read-only runtime at `100.97.23.87:8796`.
- Canonical source branch: `main`; normal engineering path is **GitHub branch → PR → CI/review → merge**.
- PC01 is runtime/diagnostics only. It is not a normal source-edit, coding, development-worktree, build, or web-deploy machine.
- Durable runtime state: PostgreSQL `5432`; local AI: Ollama `127.0.0.1:11434`.
- Execution boundary authority: `docs/EXECUTION_BOUNDARY.md`.

## Autonomous Coding Lane — VERIFIED
- AI Manager creates durable coding objectives/jobs; the Coding Lane manager currently uses eligible free/trial API NV resources.
- Implementer receives an explicit file scope and writes only to an isolated branch named `tigeriq/<nv>/<job>` through GitHub API.
- Direct Coding Lane writes to `main` are not implemented; merge occurs only through a PR after required gates.
- Required gates: `CI Verify`, `Queue Hygiene Verify`, `Vercel Online Verify`.
- Independent reviewer must be a different NV from the implementer. Review rejection returns the job for fix/retest, bounded by the job retry limit.
- Credential/security, paid AI, destructive operations, and production/release-control work fail closed.

## Coding Lane E2E evidence
- Initial smoke E2E: objective `CODEOBJ-8740a833-8ffe-4d09-8794-a6eae79875f1` → job `CODE-08c497bf-cfd8-40d8-865e-fc8c2689d048` → branch `tigeriq/nv12/code-08c497bf-cfd8-40d8-865e-fc8c2689d048` → PR #604 → 3/3 gates PASS → NV11 independent review approved → merged as `d6972207df30f43400cea9650c8168d272f1f7bf`.
- Persistent scheduled-runtime E2E: objective `CODEOBJ-02ee5c98-f679-40e2-9dd4-2b1cea5e8890` → job `CODE-ddfc9b5f-5f19-4735-93d1-1e7bba38914e` → branch `tigeriq/nv12/code-ddfc9b5f-5f19-4735-93d1-1e7bba38914e` → PR #607 → 3/3 gates PASS → NV11 independent review approved → merged as `830c6b0fe8567a8702cb38a4de1ac7d453111649`.
- Persistent E2E ran from the Scheduled Task-backed Coding Lane runtime, not a development shell.

## Path-aware runtime updater — VERIFIED
- `update-core-runtime.ps1` classifies changed paths before runtime action.
- Core runtime paths → restart Core.
- Web Control-only paths → restart Web Control only.
- Coding Lane-only paths → restart Coding Lane only.
- Docs/other non-runtime paths → no service restart.
- PR #605 fixed PowerShell PID state handling after the first rollout exposed a `.HasValue` runtime defect.
- Final Web Control-only E2E via PR #606 changed only `apps/tigeriq-core/web-control-updater-probe.md`.
- Updater evidence: `impact.core=false`, `impact.web=true`, `impact.coding=false`, `coreRestarted=false`, `webRestarted=true`, `result=UPDATED`.
- Core PID remained `28696` before/after the Web Control-only update; Web Control Node PID changed `23856 → 31396`.
- Initial rollout incident: the legacy updater restarted Core once before path-aware activation; the final verified path no longer does so for non-Core changes.

## PC01 verified runtime
- Core `/health`: `ok=true`, PID `28696` at final verification.
- Coding Lane `/health`: `ok=true`, 3 eligible API resources, Scheduled Task-backed.
- Web Control `/health`: `ok=true`, Scheduled Task-backed, Core upstream healthy.
- Core Runtime Updater state reached `NO_CHANGE` on installed SHA `830c6b0fe8567a8702cb38a4de1ac7d453111649` after the persistent Coding Lane E2E.
- Always-on Scheduled Tasks now include Core / Coding Lane / Web Control / Core Runtime Updater / Desktop Commander Remote / Ollama Runtime.

## GitHub governance
- `main` required checks remain `CI Verify`, `Queue Hygiene Verify`, `Vercel Online Verify`.
- Coding Lane always creates a job-specific branch and PR; it does not call repository contents writes against `main`.
- GitHub branch protection remains the final repository-side authority; the Coding Lane adds its own fail-closed gate before merge.
- Desktop Commander remains operations/diagnostics only for PC01 runtime.

## Existing autonomy/integrations
- GitHub issue → Core intake → AI resource → objective completion → GitHub result/close remains verified by #595.
- SurfSense #581 remains `ADOPTED_ON_DEMAND` through Core `/api/research`.
- Chrome DevTools MCP #582 remains completed with 3/3 final E2E PASS.

## AI resource truth
- Core resources remain governed by recorded LOCAL/READY/free-proof state.
- Coding Lane active eligible resources at final E2E: NV11 Groq, NV12 Gemini, NV19 Cohere.
- No paid fallback is enabled.
- Deferred/broken providers remain excluded until separately repaired/authorized.

## Source of Truth
- CENTRAL #280: update target v45 for Coding Lane + path-aware updater completion.
- Registry #335 = v42.
- Interaction #504 = v14.
- Browser/authenticated UI guardrail = #497.
- Engineering execution boundary = `docs/EXECUTION_BOUNDARY.md`.
- Chat/memory is not runtime authority.

## Active work
- `NONE` for WO-061 after Source of Truth reconciliation.
- PR #603, #605, #606, #607 are completion/evidence history.
- PR #602 remains a separate Web Control source-integration item and is not part of WO-061 completion.

STATE: `CURRENT_V45_AUTONOMOUS_CODING_LANE_E2E_PATH_AWARE_UPDATER_PASS_20260912`
