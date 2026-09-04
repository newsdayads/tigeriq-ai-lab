# Current State

Date: 2026-09-05

TigerIQ AI Lab is being operated as a continuous distributed AI company. Tiger IQ Driver (`newsdayads/drivetrack`) remains isolated and unchanged.

## P0 — Dynamic command router / state continuity — #334/#335/#320/#319
Bootstrap 2.2 generic numeric-command resolver has been applied in ChatGPT Project Source.

Current authoritative registry root: GitHub issue #335.
- `1 -> NV01 / Minh — Thực thi trực tiếp / interactive / OWNER_FOREGROUND / enabled=true`.
- `2 -> NV02 / Khoa — Vận hành tự động / autonomous / AUTONOMOUS_P0_FIRST / enabled=true`.
- `3 -> NV03 / Huy — AI PC01 / Kỹ sư Hệ thống Local / specialized / REGRESSION_ONLY / enabled=false`.
- Legacy IDs `NV-EXEC-01`, `NV-OPS-01`, `NV-SYS-01` are historical/evidence aliases only; new authoritative writes use `NV01/NV02/NV03`.
- Unknown/disabled/malformed commands must fail closed with `COMMAND_UNREGISTERED`; do not infer semantics from chat history.

Regression / continuity state:
- Genuine NEW CHAT `1`: ĐẠT — resolved from CENTRAL #280 -> Registry Root #335 to Minh/NV01.
- Genuine NEW CHAT `2`: ĐẠT — resolved from CENTRAL #280 -> Registry Root #335 to Khoa/NV02.
- Genuine NEW CHAT `3` while unregistered: ĐẠT fail-closed (`COMMAND_UNREGISTERED`).
- Temporary dynamic `3 -> NV03 / specialized / REGRESSION_ONLY / test_only_no_runtime_mutation`: genuine NEW CHAT `3` resolved Huy correctly — ĐẠT Acceptance D; no PC01/Ollama/runtime mutation.
- Alias `3` was then disabled dynamically; genuine NEW CHAT `3` at 2026-09-05 00:23 +07 failed closed `COMMAND_UNREGISTERED` — ĐẠT Acceptance E.
- The command enable/disable cycle required no Project Source replacement, proving the Bootstrap 2.2 dynamic-registry contract.
- Repeated numeric messages in the same chat do not substitute for genuine NEW CHAT regression evidence.
- #319 continuity acceptance A/B/C/D/E has explicit evidence. This off-MAIN candidate is the stable post-regression reconciliation; default-branch `docs/CURRENT_STATE.md` remains stale until an authorized integration gate is completed.
- Bootstrap/Project Source must not be replaced for ordinary command/employee/mapping/role/capability changes that remain inside the existing authority envelope.

Ownership contract remains one active owner per Work Order/resource scope. Khoa must SKIP any active foreign lease/resource. Current policy allows Khoa takeover only after the foreign lease is stale beyond policy, with no mutation in-flight, no `OWNER_HOLD`, and a current idempotent checkpoint/evidence trail.

## Owner foreground — Web Control three-layer status / issue #338
- #338 is `OWNER_FOREGROUND` for Minh/NV01, with `OWNER_HOLD=true`.
- Claimed resources: `public/index.html`, `public/command-center.html`, `command-center.html`, `tests/pc01-three-layer-status.test.ts` on branch `feat/338-pc01-three-layer-status-v1`.
- Khoa must not mutate those resources.
- Draft PR #339 repo UI tests/CI/Vercel verification have evidence; it remains gated on independent review and physical E2E.
- Khoa's independent verifier remains isolated in PR #337; stacked integration PR #340 proved repo-level compatibility with #338 without modifying Minh-owned resources.
- No MAIN/Production integration is authorized by repo-only evidence.

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
- PR #314 has exact-head CI and technical review evidence for the bounded timeout repair, but that does not authorize merge/deploy/runtime activation.
- Draft PR #328 documents the Secure Worker reboot identity gate and explicitly forbids silently converting Worker/Watchdog to SYSTEM, copying GitHub credentials, enabling auto-logon, or otherwise widening credential scope.
- Physical reboot E2E is not authorized under normal command `2`; explicit Owner authorization is required before reboot.

### Immediate safe continuation
1. Preserve single-worker/idempotency/resource-lock semantics around #318/#282.
2. Do not issue another blind Controller diagnostic or open another PC01 mutation lane: #330/#333 already provide the current bounded diagnostic evidence.
3. #314 remains gated on a genuinely independent approval/authorization path before activation; after activation it still requires runtime acceptance proving model review no longer times out around 90 seconds.
4. #328 keeps reboot/principal/security work behind explicit Owner/security gates.
5. After Controller + Secure Worker path is stable, verify Executor -> independent Reviewer -> Judge and Web Control physical E2E.
6. Keep credential/security boundary changes, MAIN/Production and paid services behind their required gates.

## Auto Worker — issue #306
Issue #306 remains OPEN and is owned by Khoa/NV02.

Current corrective candidate is **V12.4.2** according to the latest physical/runtime evidence in #306. V11.0.1 and earlier V12.x candidates are superseded by subsequent field failures and corrective builds.

Latest field chain:
- V12.4.1 physical updater failed closed with `SOURCE_NOT_FOUND`; rollback/no-change behavior was preserved.
- Root cause: the generated JavaScript contained an incorrectly escaped Windows source-path literal, so source resolution failed before UI mutation.
- V12.4.2 removes that fixed-string dependency: it first checks the canonical path using `String.raw`, then scans Chrome Default/Profile Preferences + Secure Preferences for canonical extension ID `leidfhbpdillakmcbijagelghhilbnpc`, and fails closed on ambiguity.
- The V12.4.2 payload preserves the legacy-header killer + Tiger icon taskbar design, backup/rollback, syntax checks and on-disk version/content-script verification.
- No physical V12.4.2 PASS has been recorded yet.

Acceptance N is now mandatory in addition to A–M:
- `NO_MUTABLE_SCOPE` must not terminal-stop Auto Worker or leave it stuck on the first turn.
- Required transition: `SKIP -> SCAN_NEXT_SAFE -> READ_ONLY_VERIFY/WAIT_BOUNDED -> ADVANCE_CYCLE`.
- Safe fallback order: missing verification/gate -> state hygiene -> review preparation -> independent regression/audit -> safe backlog.
- Do not touch `OWNER_HOLD` scope, do not duplicate completed work, and only conclude global `EXTERNAL_WAIT` after a full authoritative audit.

Do not claim HOÀN TẤT until physical Chrome update/reload confirms V12.4.2 and runtime regression proves recovery, turn progression, no duplicate send, stop modes, unexpected-window recovery, tail watchdog, canonical UI/identity, ownership/failover and Acceptance A–N.

## OpenClaw — deferred
OpenClaw 2026.9.1 had a verified working online path using `openai/gpt-5.6-sol`, loopback Control UI and TigerIQ policy/skill behavior. Historical evidence remains in `docs/evidence/OPENCLAW-PC01-HANDOFF-2026-09-04.md`.

That lane is intentionally `TẠM GÁC` by the newer #318/#319 authority. Do not continue local fallback benchmarking, gateway-owner migration or Ollama/OpenClaw mutation under command `1`/`2` until a newer explicit Owner decision reactivates it.

## Web Control / physical E2E
- #322 Web Control repo-only preparation exists off-MAIN and must remain subordinate to current P0 gates. Repo-only CI evidence is not physical E2E proof.
- #261 remains the canonical physical acceptance tracker for real queue/state -> Web Control E2E; it is not itself a broad executable job.
- UI/evidence must show employee/owner/scope and `SKIP/TAKEOVER/OWNER_HOLD` reason only from authoritative registry/state, not invented activity.

## Current MAIN baseline
- Repository: `newsdayads/tigeriq-ai-lab`.
- Current observed MAIN head before this off-MAIN state reconciliation: `e17fa4d3101a43dc845e0c497a7d35b9dc7732ff`.
- Production Web Control: `https://tigeriq-ai-lab.vercel.app`.
- Vercel/Production changes remain gated; do not retry/spam rate-limited deployment or pay/upgrade automatically.

## Verified Workforce history
WO-024 through WO-039 established the software foundations for hierarchy, scheduling, task/evidence contracts, idempotency/retry, persistent state, scoped credentials, Android pairing/worker, Controller API, Command Center, signing/release preparation and simulator evidence. These historical software results are not proof of current physical PC01/device runtime unless re-verified against the active head/artifact.

## External/deferred boundaries
- PC01/Tailscale/live Controller state must be re-verified; repository/CI is not runtime proof.
- Physical Chrome V12.4.2 update/reload + regression A–N remains a real-device gate for #306.
- Physical reboot/principal/security changes remain explicit Owner gates.
- Protected PC01 services must not be restarted/reconfigured merely to make another lane pass.
- No provider/owner/signing secret may enter source control or issue evidence.
- No MAIN/Production, paid service, credential/security-boundary mutation or irreversible action without the applicable authorization/gate.
