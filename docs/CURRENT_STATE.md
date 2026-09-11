# TigerIQ — Current State

Date: 2026-09-11
Status: CURRENT — clean operational baseline
Authority: Owner instruction > Constitution/Workflow > CENTRAL #280 > Registry #335 > this snapshot > runtime/evidence

## Canonical architecture
- One hot-path runtime: **TigerIQ Core 24/7**.
- Canonical source branch: `main`.
- Core source: `apps/tigeriq-core/core.mjs`.
- PC01 launcher: `D:\TigerIQ\Workspace\tigeriq-ai-lab\scripts\tigeriq-core\run-core.ps1`.
- Core endpoint: `100.97.23.87:8795`.
- Durable state: PostgreSQL `5432`.
- Local AI: Ollama `127.0.0.1:11434`.
- Remote administration: TigerIQ Desktop Commander Remote.
- API providers are Core resource profiles, not independent background workers.

## PC01 verified state
- Core `/health`: `ok=true`; `verify-core.mjs`: PASS; 11 resources.
- Always-on Scheduled Tasks: Core / Desktop Commander Remote / Ollama Runtime.
- Core supervisor points to canonical `main`; stale in-memory worktree-path failure was fixed and retested.
- Registered Git worktree after cleanup: canonical `main` only, except temporary worktrees created during an active PR.
- Legacy tasks/worktrees/clones are archived/non-executable unless Owner explicitly reactivates them.

## Integrations
- SurfSense #581: COMPLETED, `ADOPTED_ON_DEMAND`, Core-integrated `/api/research`.
- SurfSense E2E: `JOB-6143510e-2cbf-4e6d-8078-0def48132f81`, 9.771s, sourced research → Ollama summary with citations.
- SurfSense benchmark: ~4.2 GiB RAM container; Docker images ~16.97 GB. Task remains Disabled by default to save resources and is started only when research is needed.
- Chrome DevTools MCP #582: COMPLETED, v1.9.0, smoke lane on `main` commit `2490bcd`.
- Chrome DevTools MCP final E2E: 3/3 PASS, 29 tools/run, no material console/network errors.

## GitHub governance
- `main` protected with strict required checks: `CI Verify`, `Queue Hygiene Verify`, `Vercel Online Verify`.
- One approving review required; stale reviews dismissed; conversations resolved; force-push/delete disabled.
- Merged legacy remote branches were cleaned with branch→SHA restore manifest preserved in PC01 Archive.
- Open issues are only #280 CENTRAL, #335 Registry, #497 browser guardrail, #504 Interaction policy.
- These four issues are persistent control sources, not executable backlog.

## AI resource truth
- NV02 Ollama: local Core resource.
- NV11 Groq, NV12 Gemini, NV13 OpenRouter, NV15 Cloudflare Workers AI, NV16 Hugging Face, NV19 Cohere: live PASS/READY_WHEN_CALLED per recorded evidence.
- NV14 Mistral: rate-limited/cooldown.
- NV17 Vercel AI Gateway: BLOCKED/OFFLINE 403.
- NV18 IBM watsonx.ai Lite: BLOCKED/OFFLINE, deferred.
- NV20 NVIDIA NIM: WAIT_KEY/OFFLINE.
- API provisioning/repair is Owner-deferred; no paid fallback.

## Source of Truth
- CENTRAL #280 = v41.
- Registry #335 = v41.
- Interaction #504 = v13.
- Browser/authenticated UI guardrail = #497.
- Chat/memory is not runtime authority.

## Active work
- `NONE` — no autonomous backlog is active.
- New work starts only from a new Owner objective or an explicit reactivation recorded in CENTRAL.

STATE: `CURRENT_V41_CLEAN_CORE24X7_OPTIONAL_TOOLS_ON_DEMAND_20260911`