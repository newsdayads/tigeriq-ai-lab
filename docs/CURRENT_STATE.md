# TigerIQ — Current State

Date: 2026-09-11
Status: CURRENT — TigerIQ Core 24/7 clean-state architecture
Authority: Owner instruction > Constitution/Workflow > CENTRAL #280 > Registry #335 > this snapshot > runtime/evidence

## Canonical architecture
- One hot-path runtime: **TigerIQ Core 24/7**.
- Core source: `apps/tigeriq-core/core.mjs`.
- PC01 runtime branch: `rebuild/core-24x7` until merged to `main`.
- Runtime endpoint: `100.97.23.87:8795`.
- Durable state: PostgreSQL on `5432`.
- Local AI resource: Ollama on `127.0.0.1:11434`.
- Remote administration: TigerIQ Desktop Commander Remote.
- API providers are Core resource profiles, not independent background workers.

## PC01 verified state — 2026-09-11
- Scheduled Task `TigerIQ Core 24x7`: enabled, SYSTEM, At system startup, running.
- Core `/health`: `ok=true`.
- `scripts/tigeriq-core/verify-core.mjs`: PASS.
- Durable objective `OBJ-E2E-578-1` and completed jobs survived restart/reboot evidence.
- Core self-heal: kill child -> supervisor wrapper restarts Core.
- PostgreSQL service: Running / Automatic.
- Ollama runtime: Running.
- Legacy Planner / Mission Orchestrator / Autonomy Supervisor / Native Worker / Command Center / OpenClaw tasks are not part of the current hot path and remain disabled/archive-only unless explicitly reactivated.

## AI resource truth
- NV02 — Ollama: local Core resource.
- NV11 — Groq: READY when called / live PASS.
- NV12 — Gemini: READY when called / live PASS / free-tier guard.
- NV13 — OpenRouter: live PASS.
- NV14 — Mistral: credential installed; rate-limited; 30-minute Core cooldown.
- NV15 — Cloudflare Workers AI: live PASS.
- NV16 — Hugging Face: live PASS.
- NV17 — Vercel AI Gateway: credential valid; inference 403; BLOCKED/OFFLINE.
- NV18 — IBM watsonx.ai Lite: credential installed; runtime association blocked/deferred; BLOCKED/OFFLINE.
- NV19 — Cohere: live PASS.
- NV20 — NVIDIA NIM: WAIT_KEY/OFFLINE.
- Router admits only credential state `LOCAL` or `READY`; `BLOCKED` and `WAIT_KEY` fail closed.

## Source-of-Truth policy
- CENTRAL #280 and Registry #335 are the dynamic authority.
- Interaction policy: #504.
- Browser/authenticated-UI guardrails: #497.
- Legacy issues/PRs from the pre-Core architecture are historical evidence only unless CENTRAL explicitly reactivates them.
- Chat/memory is not runtime authority.

## Current registered next lanes
- #582 — Chrome DevTools MCP: registered P0 browser/Web testing lane; not yet operational until acceptance passes.
- #581 — SurfSense: registered P1 research/knowledge lane; not yet adopted until benchmark/E2E decision.

## Safety invariants
- One resource/session = one active owner.
- No fake RUNNING/PASS/DONE without evidence.
- No paid fallback by default.
- Security/credential changes remain fail-closed.
- MAIN/Production changes require Owner authorization.

STATE: `CURRENT_CORE24X7_CANONICAL_20260911`