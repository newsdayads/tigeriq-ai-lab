# Current State

Date: 2026-09-04

TigerIQ AI Lab is being operated as a continuous distributed AI company. Tiger IQ Driver (`newsdayads/drivetrack`) remains isolated and unchanged.

## P0 — PC01 self-operation / issue #318
Current active parent initiative: #318 `PC01 tự vận hành — bỏ thao tác PowerShell thủ công`.

Current architecture authority:
- `TigerIQ Workforce Controller` = primary PC01 control authority.
- `PC01 Secure Worker` = bounded background executor/command-mailbox worker.
- `OpenClaw` = optional downstream AI/operations worker only; currently `TẠM GÁC` and not a P0 selection target.
- NEW CHAT command `1`/`2` must read this file + #318/#319 + CENTRAL #280 and must not resume the old OpenClaw benchmark/fallback lane unless a newer Owner decision reactivates it.

### Verified current evidence
- Remote mailbox canaries #321/#323/#324: 3/3 consecutive PASS for `Vy/ChatGPT -> GitHub mailbox -> PC01 claim -> bounded action -> evidence -> auto-close`, without manual PowerShell/restart/port-check work by anh Sơn.
- `TigerIQ Workforce Controller` Scheduled Task is enabled/running as `SYSTEM` with startup/repeating triggers.
- `TigerIQ Worker` and `TigerIQ Worker Watchdog` were observed enabled but logon-only; boot-before-login self-recovery is not yet proven.
- #329 `workforce.controller.status` proved listener `100.97.23.87:8790` with no wildcard/public listener, but HTTP status probe returned `404 Not Found`.
- #330 is the canonical completed read-only Controller diagnostic: `diagnostic_version=3`; Controller entry + `pg` module + database/pgpass/ingress-token files exist and are readable; the expected runner exists, parses, and sets required runtime variables; task is Running as SYSTEM; self-heal result is `FAILED`; ensure-log error class is `DATABASE_URL_MISSING`; listener remains Tailscale-only.
- #333 was closed as a duplicate diagnostic; do not re-create or re-run equivalent work without new evidence.
- PR #314 exact head `ac43b0aca31f039cdd7ca4b04ade3666ee8d539d`: exact-head CI PASS and technical exact-head review found the timeout repair bounded/fail-closed, including Process/User/Machine override and principal/task-wrapper checks. This review is not a genuinely independent GitHub-account approval because the connector uses the same repository identity; no merge/deploy is authorized from it.
- Draft PR #328 exact head `7164a643216c2edc09796f86616b82f8153c9d1f`: repository/doc gate PASS; it records the Secure Worker reboot identity decision tree and explicitly forbids silently converting Worker/Watchdog to SYSTEM, copying GitHub credentials, enabling auto-logon or otherwise widening credential scope.
- Physical reboot E2E is not authorized under normal command `2`; explicit Owner authorization is required before reboot.

### Immediate safe continuation
1. Preserve single-worker/idempotency/resource-lock semantics around #318/#282.
2. Do not issue another blind Controller diagnostic or open another PC01 mutation lane: #330/#333 already provide the current bounded diagnostic evidence.
3. #314 remains gated on a genuinely independent approval/authorization path before activation; after activation it still requires runtime acceptance proving model review no longer times out around 90 seconds.
4. #328 defines the boot-recovery gate: first perform the current-config physical reboot E2E only after explicit Owner authorization; only if that fails may a credential/principal design be proposed through its own security gate.
5. After Controller + Secure Worker path is stable, verify Executor -> independent Reviewer -> Judge and Web Control physical E2E.
6. Keep credential/security boundary changes, MAIN/Production and paid services behind their required gates.

## OpenClaw — deferred
OpenClaw 2026.9.1 had a verified working online path using `openai/gpt-5.6-sol`, loopback Control UI and TigerIQ policy/skill behavior. Historical evidence remains in `docs/evidence/OPENCLAW-PC01-HANDOFF-2026-09-04.md`.

That lane is intentionally `TẠM GÁC` by the newer #318/#319 authority. Do not continue local fallback benchmarking, gateway-owner migration or Ollama/OpenClaw mutation under command `1`/`2` until a newer explicit Owner decision reactivates it.

## P0 process/state continuity — issues #319/#320
- Chat is not authoritative state.
- CENTRAL #280 now carries Workflow V2 command `1`/`2` semantics and the current safe execution queue.
- Actionable Owner goals/fixes/decision changes must be reflected in GitHub/TigerIQ state/queue.
- Work selection precedence for current operations: latest explicit Owner instruction -> Bootstrap contracts -> active parent initiative/CENTRAL queue/current issue evidence -> older issue titles/history.
- #156/#161/#196 are superseded as independent P0 lanes; #282 is an active dependency only under #318.
- #319 acceptance A/B/C/E has recorded evidence; D remains CHỜ three consecutive chat-switch consistency checks.
- #320 Source V2 has command `2` continuation evidence; `vy` / `bc` / `đưa prompt làm việc` regressions remain CHỜ user-driven NEW CHAT checks.
- Bootstrap V2 governs command semantics; stale dynamic text cannot override Workflow V2.

## Auto Worker — issue #306
Issue #306 remains OPEN. Repository comments record local repair iterations through V9.8. Current evidence is not enough to claim HOÀN TẤT: physical Chrome reload/regression on PC01 is still required for A–G acceptance. Do not fake PASS from mock/offline checks alone.

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
