# Current State

Date: 2026-09-08
Status: CURRENT — reconciliation candidate, OFF-MAIN
Authority: Owner instruction > Constitution/Workflow > CENTRAL #280 > Registry #335 > exact runtime/evidence

## Current operating policy
- TigerIQ project background AI/runtime is ACTIVE.
- Only unattended browser/Chrome/ChatGPT UI automation is PAUSED / fail-closed.
- Safe OFF-MAIN repository/runtime work, local AI, tests, evidence, queue/state maintenance and API/HTTP checks may continue within existing authority.
- No MAIN/Production/paid/credential/security widening/reboot/irreversible action without the normal gate.

## PC01 live state — 2026-09-08
Authoritative live evidence recorded in CENTRAL #280 after D-root migration repair:
- Runtime canonical root: `D:\TigerIQ`.
- Workforce Controller: RUNNING; `/api/v1/status` reports `ok=true`, `postgres=true`.
- PC01 Native Worker: RUNNING; `pc01.online=true`, health=`ok`.
- Autonomous Planner: RUNNING.
- Mission Orchestrator: RUNNING.
- Autonomy Supervisor: RUNNING; `overallOk=true`.
- Ollama: operational from `D:\TigerIQ\OllamaModels`.
- PostgreSQL: operational from `D:\TigerIQ\PostgreSQL\16\data`.
- Command Center + Remote Desktop Commander: operational from D:.
- Active live process references to `F:\TigerIQ`: 0; F is rollback legacy only.
- Operational runtime script scan found no Chrome/Playwright/DevTools launcher.

Repository alignment candidate: Draft PR #494 (`pc01/d-root-recovery-20260908`) aligns autonomy runtime defaults to D-root and qwen3:4b CPU-local-AI defaults. It is OFF-MAIN and must not be represented as merged/Production.

## OpenClaw — current Owner directive / 2026-09-08
OpenClaw has been REACTIVATED by the Owner for a dedicated audit/configuration workstream so it can be made suitable for TigerIQ operation.

Rules for this workstream:
- Do not treat the stale 2026-09-04 OpenClaw snapshot as current runtime truth.
- Do not claim OpenClaw healthy/active/complete until the dedicated OpenClaw session records exact current runtime evidence.
- Do not duplicate or parallel-mutate the same OpenClaw resource while that dedicated session owns it; other workers should checkpoint/SKIP conflicting scope.
- OpenClaw must not own or disrupt protected TigerIQ services (Controller, PostgreSQL, Ollama, Planner, Worker, Mission Orchestrator, Autonomy Supervisor, Command Center) unless explicitly authorized.
- Unattended Chrome/ChatGPT UI automation remains denied even if OpenClaw itself is being configured.
- Any gateway/model/fallback change requires evidence and bounded reversible execution; no credential/security widening or Production gate bypass.

Historical OpenClaw PRs #279 and #315 remain historical/superseded evidence only; they do not override the Owner's 2026-09-08 reactivation. New runtime truth must be recorded from the current OpenClaw workstream.

## Current P0
1. Keep PC01 background AI/runtime healthy on `D:\TigerIQ`.
2. Continue Web Control / continuous self-healing OFF-MAIN using safe non-browser execution paths (#482/#484/#486).
3. Keep unattended Chrome/ChatGPT UI automation blocked.
4. Complete CURRENT_STATE reconciliation through normal OFF-MAIN review/gate.
5. Continue the dedicated OpenClaw audit/configuration lane without conflicting parallel mutation; record exact runtime evidence back into CENTRAL/current state when verified.

## Command / employee registry
Registry authority: #335 (`REGISTRY_ROOT_VERSION=4`).
- `1` = NV01 / Minh — foreground interactive — enabled.
- `2` = NV02 / Khoa — background project execution — enabled.
- `3` = NV03 / Huy — paused/disabled.
- `4` = NV04 / Khải — specialized — pending Owner activation.
- `5` = NV05 / An — pending/disabled.
- Unknown/disabled command must fail closed.

## Active safety invariants
- One Work Order/resource scope = one active owner.
- Exact evidence is required before `ĐẠT/HOÀN TẤT` claims.
- Current Owner instruction supersedes stale queue/status snapshots.
- Browser/Chrome UI automation denial is capability-specific and must not disable unrelated project background AI.
- No fake heartbeat/background/online/runtime evidence.
- No self-bypass of MAIN/Production/paid/security/reboot/irreversible gates.

## Superseded state notice
The previous `docs/CURRENT_STATE.md` dated 2026-09-04 contained stale runtime/priority information, including an obsolete OpenClaw priority interpretation and pre-recovery PC01 assumptions. Those details are historical context only and must not be used to route current work when they conflict with CENTRAL #280, Registry #335, this current reconciliation, or newer exact evidence.

## Next evidence required
- Review/gate this CURRENT_STATE reconciliation before MAIN integration.
- Dedicated OpenClaw session publishes exact current gateway/task/config/model/runtime evidence and updates CENTRAL/state accordingly.
- Continue evidence-driven Web Control/Self-Healing work OFF-MAIN.
