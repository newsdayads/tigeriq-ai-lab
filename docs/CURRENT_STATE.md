# Current State

Date: 2026-09-05
Status: repo-side mirror only. Runtime/current execution truth follows fresher dynamic authority and exact evidence.

TigerIQ AI Lab is operated as a continuous distributed AI company. Tiger IQ Driver (`newsdayads/drivetrack`) remains isolated and unchanged.

## Authority / loading order
1. Explicit current instruction from anh Sơn.
2. Dynamic Command + AI Employee Registry #335.
3. CENTRAL authoritative queue/router #280.
4. Exact current target/ownership/evidence issues.
5. This file as a repo-side mirror only.

If this file conflicts with fresher authority, fail closed to the fresher source; never infer runtime state from a stale repo mirror.

## Command Registry — current
- `1` -> **Minh (NV01 — Thực thi trực tiếp)** / `OWNER_FOREGROUND` / enabled.
- `2` -> **Khoa (NV02 — Vận hành tự động)** / `AUTONOMOUS_P0_FIRST` / enabled.
- `3` -> **Huy (NV03 — AI PC01 / Kỹ sư Hệ thống Local)** / regression-only / disabled.
- Unknown/disabled command -> `COMMAND_UNREGISTERED`.

Bootstrap 2.2 dynamic-command regression is complete. Ordinary command/employee mapping changes remain in the dynamic Registry and do not require Project Source replacement.

## Current P0 ownership
### #338 — Minh/NV01
- Scope: PC01 Server / TigerIQ Control Plane / AI PC01 Web Control separation.
- `OWNER_HOLD=true`.
- Khoa/NV02 must SKIP this resource scope; no second mutation owner.

### #306 — Khoa/NV02 / Auto Worker
Current corrective candidate: **V13.4.0 — Physical Batch / Readiness Integrity**.

V13.3.6 and earlier are superseded for runtime acceptance after physical evidence showed a navigation/readiness race: command `2` could dispatch before the exact TigerIQ AI Lab Project was fully loaded/hydrated.

Current V13.4.0 contract/evidence:
- Draft PR #349, exact head `099630a44546d2c179fbd60c33ae0e25ab622a9b`, off-MAIN.
- Artifact: `TIGERIQ_AUTO_WORKER_V13_4_0_PHYSICAL_BATCH_UPDATE.cmd`.
- SHA-256: `c7c5cad1fba4104113c394673a212829b28789d2d2f26bd69e771060d74bc8b7`.
- Preserve managed-window layout ~26% width × 60% height, clamp 340–520 × 480–760, right-anchored; persist normal bounds; user resize/maximize is not continuously overridden; recovery prefers prior normal bounds.
- Tiger icon remains visible on the right while managed active; taskbar opens/closes only from the icon; no legacy/full-width header.
- FIRST/recovery `2` dispatch is forbidden until exact Project `g-p-6a925c470a08191a10595e215d044fa` is confirmed, document is complete, composer is visible/enabled, URL is stable 5×500ms, then grace 1500ms. Readiness timeout 90s; navigation retry bounded; wrong/intermediate page does not dispatch.
- Stale content state must not override Pause/Stop; background remains authoritative immediately before submit.
- V13.3.x managed-tab migration reloads the exact managed tab once to prevent mixed-version timers/duplicate dispatch.
- Unneeded `system.display` permission removed.
- Preserved: `dispatchPendingAt`/physical reconcile, persisted cycle/session/turn, single-launch mutex, bounded recovery 3 times, AUTO/ONE, unlimited turns, >5-minute wait-only, minute-29 drain, response watchdog 12 minutes, tail `LƯU TRỮ -> XÁC MINH -> ĐÓNG` 30s/max2, silent/no notifications.
- JS syntax, background mocked Chrome API smoke, contract audit **34/34 ĐẠT**, V13.3.6-shaped mock update -> V13.4.0, and installer payload exactness: **ĐẠT**.

Physical Chrome acceptance remains **CHỜ**:
- update/reload V13.4.0 on real Chrome;
- run regression A–N;
- verify layout/icon/readiness/slow-network behavior, one correct `2` dispatch only after exact Project readiness, user resize/maximize integrity, recovery bounds, and no legacy header.

Do not create another Auto Worker version without a new physical/runtime finding or real contract change.

### #318 — PC01 self-operation
Current architecture:
- `TigerIQ Workforce Controller` = primary authority.
- `PC01 Secure Worker` = bounded executor.
- GitHub command mailbox = current remote bridge from Vy/ChatGPT to PC01.
- OpenClaw = **TẠM GÁC** and is not current P0 authority.

Verified evidence:
- remote mailbox `Vy -> PC01 -> execute -> evidence`: **ĐẠT 3/3** via #321/#323/#324;
- Workforce Controller: Running/Enabled/SYSTEM with `At system startup`; boot authority **ĐẠT at current observed config/runtime evidence level**;
- Secure Worker + Watchdog remain logon-only; pre-login reboot autonomy **CHƯA ĐẠT/CHƯA XÁC MINH**.

P0 correctness #347 / Draft PR #348 exact `80544151b418346d3df38374534f0466cd39c43d`:
- MIN_300 model-timeout clamp + marker V2;
- SYSTEM-safe self-heal path without unsafe caller-principal dependency;
- backup -> `py_compile` -> atomic replace -> restart -> verify -> rollback retained;
- deterministic regressions included;
- CI #988 **ĐẠT**;
- technical review scope **ĐẠT**, but not genuinely independent approval;
- integration and live-runtime acceptance remain gated.

Physical reboot E2E remains an explicit Owner gate. Do not reboot PC01 automatically.

## Continuity / state hygiene — #319
- Continuity acceptance A–E has evidence.
- CENTRAL #280 and exact #306 now select **V13.4.0**.
- PR #332 is a superseded historical V13.3.5 mirror.
- PR #351 / closed integration evidence #352 proved the V13.3.6-era replacement mirror against the current Queue Hygiene verifier, but that exact state became stale after the new V13.4.0 physical finding and must not be used to lower the candidate.
- Default-branch `docs/CURRENT_STATE.md` remains materially stale until an authorized integration occurs.
- Dynamic authority remains authoritative regardless of repo mirror freshness.

## Dynamic Registry / Source — #320/#334/#335
- Bootstrap 2.2 is applied.
- NEW CHAT command `1` and `2` regression: **ĐẠT**.
- Command `3` enable/disable regression completed; current command `3` is disabled and must fail closed.
- Registry/state changes inside the existing authority envelope do not require Project Source replacement.

## Deferred / Owner-gated work — #343
Highest-priority manual/authorization gates are collected so they do not stop autonomous safe work:
1. #306 physical Chrome V13.4.0 update/reload + regression A–N + layout/icon/readiness/slow-network acceptance.
2. #318 physical reboot E2E only after explicit Owner authorization.
3. #261/#322 physical Web E2E when dependencies are ready.
4. Android/device interaction only after a fresh installed package/version/signer + exact candidate + Controller readiness audit.
5. MAIN/Production/security/paid actions only with applicable authorization.

## Historical/deferred boundaries
Do not select historical trackers as current execution targets only because titles still contain P0 or old readiness markers.
- #156/#161: historical PC01 bootstrap/review provenance only.
- #160: deferred Android preflight reference; old physical markers do not authorize current device mutation.
- #165/#167: historical Auto-Resume governance provenance; old NV04/NV05 identities are not active Registry employees.
- #176: historical release-train planning reference.
- #196/#282: historical PC01 recovery/foundation evidence; current PC01 authority is #318/#280.
- #148 COMPANY-001: design-ready but deferred until current runtime acceptance re-activates it.

## Safety boundary
No autonomous MAIN/Production/release, paid/payment, credential/security/firewall widening, destructive/irreversible action, physical reboot/device mutation or secret exposure.

When a current scope is blocked by physical/security/MAIN/external gates, command `2` continues with:
`SKIP -> SCAN_NEXT_SAFE -> READ_ONLY_VERIFY -> STATE_HYGIENE -> REVIEW_PREP -> REGRESSION/BACKLOG`.

Do not claim **ĐẠT/HOÀN TẤT** without applicable evidence.
