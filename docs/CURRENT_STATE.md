# TigerIQ — Current State

Date: 2026-09-11
Status: CURRENT — `main` canonical, Core 24/7 operational
Authority: Owner instruction > Constitution/Workflow > CENTRAL #280 v38 > Registry #335 v38 > Interaction #504 v10 > runtime/evidence

## Canonical architecture
- One hot-path runtime: **TigerIQ Core 24/7**.
- Canonical source branch: `main`.
- Core source: `apps/tigeriq-core/core.mjs`.
- PC01 launcher: `D:\TigerIQ\Workspace\tigeriq-ai-lab\scripts\tigeriq-core\run-core.ps1`.
- Runtime endpoint: `100.97.23.87:8795`.
- Durable state: PostgreSQL on `5432`.
- Local AI: Ollama on `127.0.0.1:11434`.
- API providers are Core resource profiles, not independent background workers.

## PC01 verified state
- `TigerIQ Core 24x7`: Running, SYSTEM, At system startup.
- `/health`: `ok=true`; `verify-core.mjs`: PASS; resources=11.
- Durable objective `OBJ-E2E-578-1` and completed jobs survived restart/reboot.
- Active TigerIQ Scheduled Tasks: Core / Desktop Commander Remote / Ollama Runtime only.
- 19 legacy Scheduled Tasks were exported to XML and removed.
- Old clones/worktrees were archived; only current development lanes #581/#582 are retained.

## GitHub governance
- Core PR #579 merged; `main` is canonical.
- `main` protection requires strict checks: `CI Verify`, `Queue Hygiene Verify`, `Vercel Online Verify`.
- 1 approving review; stale reviews dismissed; conversations resolved before merge.
- Force-push and branch deletion disabled for `main`.
- Canary PR #583 proved all 3 required checks PASS and was closed without merge.
- 41 fully merged remote branches were deleted after branch→SHA manifest backup on PC01.
- Unmerged branches are retained to avoid destroying unverified history.
- Open active issues are limited to #280, #335, #497, #504, #581, #582.

## AI resource truth
- NV02 Ollama: local Core resource.
- NV11 Groq, NV12 Gemini, NV13 OpenRouter, NV15 Cloudflare Workers AI, NV16 Hugging Face, NV19 Cohere: prior live PASS / READY_WHEN_CALLED.
- NV14 Mistral: rate-limited; 30-minute Core cooldown.
- NV17 Vercel AI Gateway: BLOCKED/OFFLINE after inference 403.
- NV18 IBM watsonx.ai Lite: BLOCKED/OFFLINE; runtime association deferred.
- NV20 NVIDIA NIM: WAIT_KEY/OFFLINE.
- API provisioning/repair work is Owner-deferred; existing resource truth remains preserved.

## Current active lanes
1. #582 — Chrome DevTools MCP, P0. Separate owner/lane; do not duplicate.
2. #581 — SurfSense, P1. Adopt only after benchmark + E2E evidence.

## Safety invariants
- One resource/session = one active owner.
- No fake RUNNING/PASS/DONE without evidence.
- FREE/zero-cost first; no paid fallback by default.
- Browser/authenticated UI follows #497 guardrails.
- Legacy issues/PRs are historical evidence only unless CENTRAL explicitly reactivates them.
- Admin bypass of `main` is emergency/bootstrap only after explicit Owner instruction, not routine workflow.

STATE: `CURRENT_V38_MAIN_CANONICAL_PROTECTED_CLEAN_20260911`
