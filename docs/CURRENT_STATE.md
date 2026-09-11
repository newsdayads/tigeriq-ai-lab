# TigerIQ — Current State

Date: 2026-09-11
Status: CURRENT — clean operational baseline
Authority: Owner instruction > Constitution/Workflow > CENTRAL #280 > Registry #335 > this snapshot > runtime/evidence

## Canonical architecture
- One hot-path runtime: **TigerIQ Core 24/7**.
- Canonical source branch: `main`.
- Runtime entry: `apps/tigeriq-core/core-entry.mjs` → `core.mjs` + GitHub intake.
- Engineering path: **GitHub → CI**; hosted Web/UI uses **Vercel** when deployment is required.
- **PC01 is excluded from the normal coding/repository/web-build/web-deploy path.**
- PC01 launcher: `D:\TigerIQ\Workspace\tigeriq-ai-lab\scripts\tigeriq-core\run-core.ps1`.
- Core endpoint: `100.97.23.87:8795`.
- Durable state: PostgreSQL `5432`.
- Local AI: Ollama `127.0.0.1:11434`.
- Remote administration: TigerIQ Desktop Commander Remote, limited to runtime operations/diagnostics and genuinely local/device-bound verification.
- API providers are Core resource profiles, not independent background workers.
- Execution boundary authority: `docs/EXECUTION_BOUNDARY.md`.

## PC01 verified state
- Core `/health`: `ok=true`; 11 resources.
- Always-on Scheduled Tasks: Core / Desktop Commander Remote / Ollama Runtime / Core Runtime Updater.
- PowerShell/CMD supervising Core/Ollama/Desktop Commander are runtime launchers only, not a coding lane.
- Core source on `main` hard-blocks `coding` with `LOCAL_CODING_DISABLED_GITHUB_ONLY`; Core resource capabilities are `general/reasoning/review` only.
- PR #594 merged as `6b6fa5e`; PC01 zero-touch updater automatically advanced `44acbbc → 6b6fa5e` after required gates passed.
- Core PID changed `30672 → 27960`; `/health` remained `ok=true` after update.
- Supervisor/updater now enforce a single live Core, clear stale/orphan Node processes, require a changed healthy PID after update, and roll back on failed health validation.
- Updater reloads itself after self-update so the running updater script cannot remain stale.
- Legacy tasks/worktrees/clones are archived/non-executable unless Owner explicitly reactivates them.

## GitHub → Core autonomy
- GitHub executable issues are materialized by Core intake into durable `OBJ-GH-*` objectives.
- #588–#590 completed through the GitHub intake path.
- #595 is the post-fix E2E proof: Core automatically wrote `[CLAIM]`, completed the objective, wrote `[RESULT]`, and closed the issue without manual runtime activation.
- Verified path: **GitHub issue → Core intake → AI resource → objective completion → GitHub result/close**.
- This autonomy path does not turn PC01 into a coding lane; repository implementation remains GitHub/CI only.

## Integrations
- SurfSense #581: COMPLETED, `ADOPTED_ON_DEMAND`, Core-integrated `/api/research`.
- SurfSense E2E: `JOB-6143510e-2cbf-4e6d-8078-0def48132f81`, 9.771s, sourced research → Ollama summary with citations.
- SurfSense benchmark: ~4.2 GiB RAM container; Docker images ~16.97 GB. Task remains Disabled by default to save resources and is started only when research is needed.
- Chrome DevTools MCP #582: COMPLETED, v1.9.0, smoke lane on `main` commit `2490bcd`.
- Chrome DevTools MCP final E2E: 3/3 PASS, 29 tools/run, no material console/network errors.

## GitHub governance
- `main` protected with strict required checks: `CI Verify`, `Queue Hygiene Verify`, `Vercel Online Verify`.
- One approving review required; stale reviews dismissed; conversations resolved; force-push/delete disabled.
- GitHub-only engineering boundary is enforced by `AGENTS.md`, `docs/EXECUTION_BOUNDARY.md`, CENTRAL #280 and Interaction #504.
- Desktop Commander/PC01 must not be used for ordinary source implementation, repository edits, or web build/deploy.
- Merged legacy remote branches were cleaned with branch→SHA restore manifest preserved in PC01 Archive.
- Persistent open control issues: #280 CENTRAL, #335 Registry, #497 browser guardrail, #504 Interaction policy.
- These control issues are not executable backlog.

## AI resource truth
- NV02 Ollama: local Core resource.
- NV11 Groq, NV12 Gemini, NV13 OpenRouter, NV15 Cloudflare Workers AI, NV16 Hugging Face, NV19 Cohere: live PASS/READY_WHEN_CALLED per recorded evidence.
- NV14 Mistral: rate-limited/cooldown.
- NV17 Vercel AI Gateway: BLOCKED/OFFLINE 403.
- NV18 IBM watsonx.ai Lite: BLOCKED/OFFLINE, deferred.
- NV20 NVIDIA NIM: WAIT_KEY/OFFLINE.
- API provisioning/repair is Owner-deferred; no paid fallback.

## Source of Truth
- CENTRAL #280 = v44.
- Registry #335 = v42.
- Interaction #504 = v14.
- Browser/authenticated UI guardrail = #497.
- Engineering execution boundary = `docs/EXECUTION_BOUNDARY.md`.
- Chat/memory is not runtime authority.

## Active work
- `NONE` — no executable backlog is active.
- #588, #589, #590 and #595 are completed/closed evidence only.
- New work starts only from a new Owner objective or an explicit reactivation recorded in CENTRAL.

STATE: `CURRENT_V44_GITHUB_CORE_AUTONOMY_E2E_PASS_NO_ACTIVE_BACKLOG_20260911`
