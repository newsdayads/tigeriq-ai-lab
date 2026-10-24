# TigerIQ Phone Farm — DEV v0.3 (24/10/2026)

Work Order: [GH-5291](https://github.com/newsdayads/tigeriq-ai-lab/issues/5291). PR: [#5292](https://github.com/newsdayads/tigeriq-ai-lab/pull/5292).

## New capability: local persistent schedules

Source commit prior to this evidence file: `3e0f23593a12952a3a00a402808bf87f439ae11a`.
- `schedule-engine.mjs`: persists JSON schedule on PC; one-off or repeat between 1 and 1440 minutes; bounded macros; no external provider. Prevents replay when scheduled work is more than 1 hour late, and refuses malformed records.
- `app.mjs`: loopback-only schedule list/create/remove API, timer checks every 15 seconds while local Node server runs.
- `ui.js` / `index.html`: local schedule create/view/remove. A real user must choose device, steps and time.
- `run-local.cmd`: local launch helper. No bundled third-party executable. Requires user-installed Node.js + ADB.

## Verified on PC01

- Source tests `node --test`: **12/12 PASS**.
- Local HTTP API: `POST /api/schedules` returned id `cb4a1380-3ce5-4635-a7f0-e19b0e6a5325`; `GET /api/schedules` confirmed id; `POST /api/schedules/delete` returned `removed:true`, list count returned 0. The smoke schedule was **deleted before its due time** and never executed.
- Packaged portable DEV ZIP on PC01:
  `D:\TigerIQ\Apps\TigerIQ-PhoneFarm\dist\TigerIQ-PhoneFarm-DEV-v0.3.zip`
  size **22,120 bytes**, SHA-256 **A38C626F6DE8F31161FD436F9B3D35C8FF18A4A32E855AC569339097802ED3C3**.
- Extracted ZIP (9 source/test/docs/launcher files plus drop directory); tests **12/12 PASS** again from extracted artifact. Package intentionally has **no credentials, LAIXI files, native Qt upstream binary, or packaged Node**.
- Trial API listener at `127.0.0.1:8766` stopped; confirmed no longer listening. Temporary Android smoke upload and generated APK signing attempts were cleaned up.

## Still not verified / cannot assert DONE

- Actual clock-triggered scheduled macro on connected real Android has not yet been run. Unit+API lifecycle do not prove wall-clock execution.
- Windows owner interactive session was logged out during native application audit; native UI cannot be visually verified until a valid interactive session exists.
- One physical Samsung only. No 20/100+ load test, full no-Internet test, native build reproducibility or Qt LGPL redistribution assessment.
- Actual APK install test was blocked at package signing; no signing check was bypassed, and no test APK was installed.
- **NO production release, no merge**, no LAIXI patch or license bypass. GH-5291 remains OPEN, PR-5292 remains DRAFT.
