# TigerIQ Phone Farm — DEV v0.2 execution evidence

Date: 2026-10-24 (PC01, Asia/Ho_Chi_Minh). Work Order: [GH-5291](https://github.com/newsdayads/tigeriq-ai-lab/issues/5291); review: [PR-5292](https://github.com/newsdayads/tigeriq-ai-lab/pull/5292).

## Implemented

Independent Node controller:
- `farm-ops.mjs`: fixed allowlist for Android package operations (install/launch/forceStop) and file upload from application-local `drop/`. Max 200 selected devices in one request, up to 4 concurrent actions; rejects duplicate serials, path traversal, oversized files, Windows reserved device names, symlinks. No arbitrary ADB command execution.
- `macro-engine.mjs`: declarative `tap/swipe/key/text/wait` actions, max 50 steps, bounded delay, grouped execution, run identifiers, progress, cancellation and per-device locking.
- `app.mjs`: local HTTP endpoints `GET /api/packages`, `POST /api/batch`, `POST /api/macro/start`, `GET /api/macro/status`, `POST /api/macro/stop`. Bound to loopback only.
- `index.html` / `ui.js`: visible batch actions and manual JSON macro controls.
- `README.md`: operation and explicit gaps; `.gitignore`: exclude test drop contents and device labels.

## Actual PC01 tests

1. `node --test apps/phone-farm-local/test.mjs`: **10 PASS / 0 FAIL**.
2. Local API at `127.0.0.1:8766`, connected one owner-authorized Samsung Android via USB. Health OK; list devices returned one authorized device; `GET /api/packages` reported 49 third-party package entries (package identifiers not copied into evidence).
3. Safe file transfer: `tigeriq-smoke.txt` created in the local `drop` folder. `POST /api/batch` action `upload` returned `ok:true` on one device. Device-side SHA-256 exactly matched local file SHA-256 **773f22f660572e85148c3ece4b51113de2a2e58f9584fb44bc21c7492edae6ce**. Test file removed from Android and PC; removal verified.
4. Harmless macro `HOME -> WAIT 500ms -> HOME` through `POST /api/macro/start` and status endpoint: `state=completed`, `done=3`, `total=3`, `error=null` on actual device.
5. Test server process listening only on `127.0.0.1:8766` during audit. Stopped precise PID after tests and verified port no longer listened.
6. Native Qt reference feature UI audit (before desktop session ended) confirmed actual navigation across Automations, Scheduler, Applications, Files, Groups, Performance; evidence on PC01 at `D:\TigerIQ\Apps\TigerIQ-PhoneFarm\upstream-eval\page-click-audit.txt`. Menus/buttons are **not proof** that every action was exercised.

## Known blockers / nonclaims

- Windows interactive session was logged out during this continuation. Native Qt GUI tests cannot continue unattended; no simulated GUI PASS was asserted.
- APK install smoke test not completed: a harmless manifest-only Android package was prepared and aligned; the signing step was blocked by the security gate. The test keystore and unsigned trial artifacts were deleted; no test APK installed, and the denial was **not bypassed**.
- No 2+ physical devices were present for real concurrency/load verification; no zero-Internet network-isolation proof, no Auto.js scripting, durable schedule/recovery, APK install success, full native source rebuild or licensed redistribution proof.
- Overall FULL LAIXI-equivalent target remains **NOT DONE**. PR remains draft; no main merge or production release.
