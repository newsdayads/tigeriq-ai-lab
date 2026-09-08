# Current State

Date: 2026-09-08
Status: CURRENT — candidate synchronized with CENTRAL #280 + Registry #335 v5
Authority: Owner instruction > Constitution/Workflow > CENTRAL #280 > Registry #335 > exact runtime/evidence

## Current operating policy
- TigerIQ project background AI/runtime is ACTIVE.
- Browser/Chrome/ChatGPT authenticated UI automation is AUTHORIZED_WITH_GUARDRAILS under #497; no per-session Owner approval is required for normal browser jobs.
- One authenticated account/session = one automation owner at a time; UI actions must be queued, bounded-retry/backoff, logged, and kill-switch capable.
- Suspicious activity, rate limit, CAPTCHA/challenge, re-auth/verification or security warning => stop that UI lane immediately, do not bypass; keep safe non-UI lanes running.
- Prefer API/connector/CLI when more stable/effective; use browser UI when it is the appropriate execution path.
- No password/2FA/recovery/security-setting changes, paid actions, MAIN/Production release, reboot or irreversible action without the normal gate.

## PC01 live state — 2026-09-08 09:04 +07
Authoritative live evidence recorded in CENTRAL #280:
- Runtime canonical root: `D:\TigerIQ`.
- Workforce Controller: RUNNING; `/api/v1/status` reports `ok=true`, `postgres=true`.
- PC01 Native Worker: RUNNING; online/health=`ok`; queue=0, active leases=0 at the recorded check.
- Autonomous Planner: RUNNING.
- Mission Orchestrator: RUNNING.
- Autonomy Supervisor: RUNNING.
- Command Center: RUNNING `100.97.23.87:8787`.
- Workforce Controller: RUNNING `100.97.23.87:8790`.
- PostgreSQL: RUNNING `5432`.
- Ollama: RUNNING `127.0.0.1:11434`.
- Remote Desktop Commander: RUNNING from D-root with S4U/BootTrigger.
- No live `F:\TigerIQ` process references; F is rollback legacy only.

Repository alignment candidate: Draft PR #494 (`pc01/d-root-recovery-20260908`) remains OPEN, DRAFT, OFF-MAIN and must not be represented as merged/Production.

## OpenClaw — current
- Config valid at `D:\TigerIQ-OpenClaw\state\openclaw.json`.
- Default model: `ollama/qwen3:4b`.
- Browser plugin is enabled; CUA is not considered operational until tested.
- Gateway `127.0.0.1:18789` is currently STOPPED in the latest CENTRAL evidence.
- Native OpenClaw service installer rejected install because of custom state/config path; #318 owns the managed D-root wrapper/task or canonical-compatible service-path resolution.
- OpenClaw requires 3 consecutive Agent/tool E2E passes before it may be claimed operational.
- OpenClaw must not own or disrupt Controller, PostgreSQL, Ollama, Planner, Worker, Mission Orchestrator, Autonomy Supervisor or Command Center lifecycle unless explicitly authorized.

## Current P0 — ordered
1. #318 — PC01 autonomous 24/7: control plane + queue/lease + Planner/Orchestrator/Worker/Supervisor + AI routing + OpenClaw + browser/ChatGPT + mobile execution + self-heal + zero-touch + E2E.
2. #497 — browser/account guardrails.
3. #486 — Web Control bridge/self-healing integration.
4. #478 — system-wide zero-touch update framework.
5. Keep CENTRAL/Registry/CURRENT_STATE/evidence synchronized to runtime truth.

## Command / employee registry
Registry authority: #335 (`REGISTRY_ROOT_VERSION=5`).
- `1` = NV01 / Minh — `foreground_interactive` — enabled — ACTIVE.
- `2` = NV02 / Khoa — `background_auto` — enabled — ACTIVE_PROJECT_BACKGROUND.
- `3` = NV03 / Huy — paused/disabled.
- `4` = NV04 / Khải — enabled but PENDING_OWNER_ACTIVATION.
- `5` = NV05 / An — pending/disabled.
- Unknown/disabled command must fail closed; never infer semantics from chat/memory.

## Active safety invariants
- One Work Order/resource/account-session = one active owner.
- Exact evidence is required before `ĐẠT/HOÀN TẤT` claims.
- Current Owner instruction supersedes stale queue/status snapshots.
- Browser authority is standing but #497 guardrails are mandatory.
- Queue/lease/heartbeat/checkpoint/dedupe/retry must remain bounded and auditable.
- No fake heartbeat/background/online/browser/runtime evidence.
- Registry cannot self-authorize MAIN/Production/paid/security/reboot/irreversible actions.

## Superseded state notice
The previous MAIN snapshot that said unattended Chrome/ChatGPT UI automation was paused and referenced Registry v4 is superseded by CENTRAL #280 + Registry #335 v5 + #497. Until this candidate is merged through the normal gate, those dynamic sources remain authoritative when conflict exists.

## Next evidence required
- Continue #318 PC01 autonomy work without duplicating the other chat's owned PC/OpenClaw mutation scope.
- Dedicated OpenClaw lane publishes exact current gateway/task/config/model/runtime evidence and updates CENTRAL/state accordingly.
- Complete guarded browser/ChatGPT E2E, mobile->PC01 execution, self-heal and reboot-recovery evidence before final autonomy completion claim.
