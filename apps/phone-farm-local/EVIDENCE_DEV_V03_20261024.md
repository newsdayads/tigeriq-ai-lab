# TigerIQ Phone Farm — DEV v0.3 (24/10/2026)

Work Order: [GH-5291](https://github.com/newsdayads/tigeriq-ai-lab/issues/5291). PR: [#5292](https://github.com/newsdayads/tigeriq-ai-lab/pull/5292).

## New capability: local persistent schedules

Feature source started at commit `3e0f23593a12952a3a00a402808bf87f439ae11a`; the ZIP was restaged after README update at `10087d55ba6dfb0b411b08b5d28bca8a4a0bed95`.
- `schedule-engine.mjs`: persists JSON schedule on PC; one-off or repeat between 1 and 1440 minutes; bounded macros; no external provider. Prevents replay when scheduled work is more than 1 hour late, and refuses malformed records.
- `app.mjs`: loopback-only schedule list/create/remove API, timer checks every 15 seconds while local Node server runs.
- `ui.js` / `index.html`: local schedule create/view/remove. A real user must choose device, steps and time.
- `run-local.cmd`: local launch helper. No bundled third-party executable. Requires user-installed Node.js + ADB.

## Verified on PC01

- Source tests `node --test`: **12/12 PASS**.
- Local HTTP API: `POST /api/schedules` returned id `cb4a1380-3ce5-4635-a7f0-e19b0e6a5325`; `GET /api/schedules` confirmed id; `POST /api/schedules/delete` returned `removed:true`, list count returned 0. The smoke schedule was **deleted before its due time** and never executed.
- Packaged portable DEV ZIP on PC01:
  `D:\TigerIQ\Apps\TigerIQ-PhoneFarm\dist\TigerIQ-PhoneFarm-DEV-v0.3.zip`
  size **22,179 bytes**, SHA-256 **DD0607E3BF2046C43B1C9042C96C03F52D20D7C6C0D4C1CCE2DCA2A877A41273**.
- Extracted ZIP (9 source/test/docs/launcher files plus drop directory); tests **12/12 PASS** again from extracted artifact. Package intentionally has **no credentials, LAIXI files, native Qt upstream binary, or packaged Node**.
- Trial API listener at `127.0.0.1:8766` stopped; confirmed no longer listening. Temporary Android smoke upload and generated APK signing attempts were cleaned up.

## Still not verified / cannot assert DONE

- **Actual clock-triggered macro verified on one real Samsung:** saved once-only HOME schedule due 2026-10-24 07:22:09 UTC; local 15-second poll fired 07:22:14 UTC. `GET /api/schedules` reported `lastRunId=95875930-1db0-4e4a-ae8f-332cecf6407c`, `lastError=null`, `enabled=false`; `GET /api/macro/status` reported `completed`, `done=1`, `total=1`, `error=null`. Smoke schedule deleted and test server stopped after verification. **Not a real-device restart/recovery or multi-device scale test.**
- Windows owner interactive session was logged out during native application audit; native UI cannot be visually verified until a valid interactive session exists.
- One physical Samsung only. No 20/100+ load test, full no-Internet test, native build reproducibility or Qt LGPL redistribution assessment.
- Actual APK install test was blocked at package signing; no signing check was bypassed, and no test APK was installed.
- **NO production release, no merge**, no LAIXI patch or license bypass. GH-5291 remains OPEN, PR-5292 remains DRAFT.
