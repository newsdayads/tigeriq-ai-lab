# Current State

Date: 2026-09-04

TigerIQ AI Lab is being operated as a continuous distributed AI company. Tiger IQ Driver (`newsdayads/drivetrack`) remains isolated and unchanged.

## P0 — Dynamic command router / state continuity — #334/#335/#320/#319
Bootstrap 2.2 generic numeric-command resolver has been applied in ChatGPT Project Source.

Current authoritative registry root: GitHub issue #335.
- `1 -> NV-EXEC-01 / Minh — Thực thi trực tiếp / interactive / OWNER_FOREGROUND`.
- `2 -> NV-OPS-01 / Khoa — Vận hành tự động / autonomous / AUTONOMOUS_P0_FIRST`.
- `3/4/5/...` are currently unregistered. Unknown/disabled/malformed commands must fail closed with `COMMAND_UNREGISTERED`; do not infer semantics from chat history.

Regression state:
- Genuine NEW CHAT `2`: ĐẠT — resolved from CENTRAL #280 -> Registry Root #335 to `NV-OPS-01 / Khoa / autonomous` without relying on chat history.
- Repeated `2` messages in the same chat do not count as new NEW CHAT regressions.
- Remaining #334/#320 acceptance: genuine NEW CHAT `1`; genuine NEW CHAT `3` while unregistered must fail closed; only then enable test `3` dynamically -> genuine NEW CHAT `3` resolve; disable `3` -> genuine NEW CHAT `3` fail closed; ownership SKIP/TAKEOVER/OWNER_HOLD + browser/runtime acceptance.
- Bootstrap/Project Source must not be replaced for ordinary command/employee/mapping/role/capability changes that remain inside the existing authority envelope.

Ownership contract remains one active owner per Work Order/resource scope. Current policy allows Khoa takeover only after the foreign lease is stale beyond policy, with no mutation in-flight, no `OWNER_HOLD`, and a current idempotent checkpoint/evidence trail.

## P0 — PC01 self-operation / issue #318
Current technical parent initiative: #318 `PC01 tự vận hành — bỏ thao tác PowerShell thủ công`.

Current architecture authority:
- `TigerIQ Workforce Controller` = primary PC01 control authority.
- `PC01 Secure Worker` = bounded background executor/command-mailbox worker.
- `OpenClaw` = optional downstream AI/operations worker only; currently `TẠM GÁC` and not a P0 selection target.

### Verified current evidence
- Remote mailbox canaries #321/#323/#324: 3/3 consecutive ĐẠT for `Vy/ChatGPT -> GitHub mailbox -> PC01 claim -> bounded action -> evidence -> auto-close`, without manual PowerShell/restart/port-check work by anh Sơn.
- `TigerIQ Workforce Controller` Scheduled Task is enabled/running as `SYSTEM` with startup/repeating triggers.
- `TigerIQ Worker` and `TigerIQ Worker Watchdog` were observed enabled but logon-only; boot-before-login self-recovery is not yet proven.
- #329 `workforce.controller.status` proved listener `100.97.23.87:8790` with no wildcard/public listener, but HTTP status probe returned `404 Not Found`.
- #330 is the canonical completed read-only Controller diagnostic: `diagnostic_version=3`; Controller entry + `pg` module + database/pgpass/ingress-token files exist and are readable; the expected runner exists, parses, and sets required runtime variables; task is Running as SYSTEM; self-heal result is `FAILED`; ensure-log error class is `DATABASE_URL_MISSING`; listener remains Tailscale-only.
- #333 was closed as a duplicate diagnostic; do not re-create or re-run equivalent work without new evidence.
- PR #314 current exact head `ac43b0aca31f039cdd7ca4b04ade3666ee8d539d`: exact-head CI and technical review evidence exist for the bounded 90s->300s timeout repair, but that is not a genuinely independent approval and does not authorize merge/deploy/runtime activation.
- Draft PR #328 current exact head `7164a643216c2edc09796f86616b82f8153c9d1f`: documents the Secure Worker reboot identity gate and explicitly forbids silently converting Worker/Watchdog to SYSTEM, copying GitHub credentials, enabling auto-logon, or otherwise widening credential scope.
- Physical reboot E2E is not authorized under normal command `2`; explicit Owner authorization is required before reboot.

### Immediate safe continuation
1. Preserve single-worker/idempotency/resource-lock semantics around #318/#282.
2. Do not issue another blind Controller diagnostic or open another PC01 mutation lane: #330/#333 already provide the current bounded diagnostic evidence.
3. #314 remains gated on a genuinely independent approval/authorization path before activation; after activation it still requires runtime acceptance proving model review no longer times out around 90 seconds.
4. #328 keeps reboot/principal/security work behind explicit Owner/security gates.
5. After Controller + Secure Worker path is stable, verify Executor -> independent Reviewer -> Judge and Web Control physical E2E.
6. Keep credential/security boundary changes, MAIN/Production and paid services behind their required gates.

## Auto Worker — issue #306
Issue #306 remains OPEN.

Current field evidence supersedes the older V9.8-only summary:
- V10.0/V10.1 created mixed-state behavior: V9.8 core and V10 overlay could disagree on version/UI/runtime ownership.
- Current chosen direction is **V10.2 CLEAN REBUILD**: restore the proven V9.8 outer lifecycle core, remove V10.0/V10.1 secondary state-machine modules, add only one `v102_turn_follower.js` for post-response next-turn dispatch, and expose one canonical Khoa/Auto Worker UI/state source.
- Preserve V9.8 proven safety behaviors: URL-derived verify key, unexpected-window self-heal, bounded VERIFY watchdog/retry, no fake completion, silent notifications, transactional backup/rollback and fail-closed installer gates.
- Do not claim HOÀN TẤT until physical Chrome Reload confirms one canonical Version 10.2.0/UI without overlap and runtime regression proves continuous `1/6 -> 2/6 -> ...`, lifecycle/tail behavior and ownership acceptance A-M.

## OpenClaw — deferred
OpenClaw 2026.9.1 had a verified working online path using `openai/gpt-5.6-sol`, loopback Control UI and TigerIQ policy/skill behavior. Historical evidence remains in `docs/evidence/OPENCLAW-PC01-HANDOFF-2026-09-04.md`.

That lane is intentionally `TẠM GÁC` by the newer #318/#319 authority. Do not continue local fallback benchmarking, gateway-owner migration or Ollama/OpenClaw mutation under command `1`/`2` until a newer explicit Owner decision reactivates it.

## Web Control / physical E2E
- #322 Web Control repo-only preparation exists off-MAIN and must remain subordinate to current P0 gates. Repo-only CI evidence is not physical E2E proof.
- #261 remains the canonical physical acceptance tracker for real queue/state -> Web Control E2E; it is not itself a broad executable job.
- UI/evidence must eventually show employee/owner/scope and `SKIP/TAKEOVER` reason from authoritative registry/state, not invented activity.

## Current MAIN baseline
- Repository: `newsdayads/tigeriq-ai-lab`.
- Current observed MAIN head before this off-MAIN state reconciliation: `e17fa4d3101a43dc845e0c497a7d35b9dc7732ff`.
- Production Web Control: `https://tigeriq-ai-lab.vercel.app`.
- Vercel/Production changes remain gated; do not retry/spam rate-limited deployment or pay/upgrade automatically.

## Verified Workforce history
WO-024 through WO-039 established the software foundations for hierarchy, scheduling, task/evidence contracts, idempotency/retry, persistent state, scoped credentials, Android pairing/worker, Controller API, Command Center, signing/release preparation and simulator evidence. These historical software results are not proof of current physical PC01/device runtime unless re-verified against the active head/artifact.

## External/deferred boundaries
- PC01/Tailscale/live Controller state must be re-verified; repository/CI is not runtime proof.
- Protected PC01 services must not be restarted/reconfigured merely to make another lane pass.
- No provider/owner/signing secret may enter source control or issue evidence.
- No MAIN/Production, paid service, credential/security-boundary mutation or irreversible action without the applicable authorization/gate.
