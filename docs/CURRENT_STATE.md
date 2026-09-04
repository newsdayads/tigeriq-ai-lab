# Current State

Date: 2026-09-05
Status: repo-side mirror of the current dynamic authority. This file is not runtime proof and must not override fresher CENTRAL/Registry/exact-target evidence.

TigerIQ AI Lab is being operated as a continuous distributed AI company. Tiger IQ Driver (`newsdayads/drivetrack`) remains isolated and unchanged.

## Authority / loading order
For current execution state use:
1. explicit current instruction from anh Sơn;
2. Dynamic Command + AI Employee Registry #335;
3. CENTRAL authoritative queue/router #280;
4. exact current target/ownership/evidence issues;
5. this file only as a repo-side mirror.

If this file becomes stale, fail closed to the fresher dynamic authority instead of inferring runtime state from repository text.

## Command Registry — current
- `1` -> **Minh (NV01 — Thực thi trực tiếp)** / `OWNER_FOREGROUND` / enabled.
- `2` -> **Khoa (NV02 — Vận hành tự động)** / `AUTONOMOUS_P0_FIRST` / enabled.
- `3` -> **Huy (NV03 — AI PC01 / Kỹ sư Hệ thống Local)** / regression-only / disabled.
- Unknown/disabled command -> `COMMAND_UNREGISTERED`.

Bootstrap 2.2 dynamic-command regression is complete. Ordinary command/employee mapping changes stay in the dynamic Registry and do not require Project Source replacement.

## Current P0 ownership
### #338 — Minh/NV01
- Scope: PC01 Server / TigerIQ Control Plane / AI PC01 Web Control separation.
- `OWNER_HOLD=true`.
- Khoa/NV02 must SKIP this resource scope and must not create a second mutation owner.

### #306 — Khoa/NV02 / Auto Worker
Current corrective candidate: **V13.3.6 — Managed Window Layout Integrity**.

Repo/library/static/mock evidence:
- candidate artifact: `TIGERIQ_AUTO_WORKER_V13_3_6_MANAGED_WINDOW_LAYOUT_INTEGRITY_UPDATE.cmd`;
- SHA-256: `af99de40ae75606e88454c5d2805db33c616976a1bb46e2c6029b9c3c21438ed`;
- adaptive initial layout ~26% width × 60% height, clamp 340–520 × 480–760, right-anchored;
- committed normal bounds persist through `chrome.windows.onBoundsChanged`;
- maximize does not overwrite prior normal bounds;
- unexpected-close recovery prefers `lastWindowBounds` for the same cycle/session;
- Tiger icon is visible by default while the managed session is active and the detail taskbar opens/closes only when the icon is pressed;
- static/package/mock checks are **ĐẠT**.

Physical Chrome acceptance is still **CHỜ**:
- update/reload V13.3.6 on real Chrome;
- run regression A–N;
- verify small default managed window, visible Tiger icon, user resize/maximize integrity, recovery bounds and no legacy/full-width header.

V13.3.5 and earlier are superseded for runtime acceptance. Do not create another version without a new physical/runtime finding or a real contract change.

### #318 — PC01 self-operation
Current architecture:
- `TigerIQ Workforce Controller` = primary authority;
- `PC01 Secure Worker` = bounded executor;
- GitHub command mailbox = current remote bridge from Vy/ChatGPT to PC01;
- OpenClaw = **TẠM GÁC** and is not the current P0 authority.

Verified evidence:
- remote mailbox `Vy -> PC01 -> execute -> evidence`: **ĐẠT 3/3** via #321/#323/#324;
- Workforce Controller: Running/Enabled/SYSTEM with `At system startup`; boot authority **ĐẠT at current config/runtime evidence level**;
- Secure Worker + Watchdog remain logon-only; pre-login reboot autonomy is **CHƯA ĐẠT/CHƯA XÁC MINH**.

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
- CENTRAL #280 and #306 are reconciled to V13.3.6.
- PR #332 is a superseded historical V13.3.5 state mirror and must not be merged or used to lower the current candidate.
- The previous default-branch `docs/CURRENT_STATE.md` snapshot was materially stale because it still treated OpenClaw as active P0 and contained older priority/Android/WO state.
- Until a repo-side mirror is integrated through the proper gate, dynamic authority remains authoritative.

## Dynamic Registry / Source — #320/#334/#335
- Bootstrap 2.2 is applied.
- NEW CHAT command `1` and `2` regression: **ĐẠT**.
- Command `3` enable/disable regression completed; current command `3` is disabled and must fail closed.
- Registry/state changes inside the existing authority envelope do not require Project Source replacement.

## Deferred / Owner-gated work — #343
Highest-priority manual/authorization gates are collected at #343 so they do not stop autonomous safe work:
1. #306 physical Chrome V13.3.6 update/reload + regression A–N + layout/icon acceptance.
2. #318 physical reboot E2E only after explicit Owner authorization.
3. #261/#322 physical Web E2E when dependencies are ready.
4. Android/device interaction only after a fresh installed package/version/signer + exact candidate + Controller readiness audit.
5. MAIN/Production/security/paid actions only with the applicable authorization.

## Historical/deferred boundaries
Do not select historical trackers as current execution targets only because their titles still contain P0 or old readiness markers.
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
