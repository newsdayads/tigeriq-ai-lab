# GH-5135 — UltraCarHCM V2 acceptance handoff

Status: **NOT DONE — verified partial device QA + external security/hardware gates remain**  
Work Order: [#5135](https://github.com/newsdayads/tigeriq-ai-lab/issues/5135)  
Canonical repository: `newsdayads/tigeriq-ai-lab` / `main`  
Prepared: 2026-10-31 (Asia/Ho_Chi_Minh)

## 1. Canonical source acceptance

- Current accepted source main SHA: [`33cc758101c478a79aff87d19d545e909217bc15`](https://github.com/newsdayads/tigeriq-ai-lab/commit/33cc758101c478a79aff87d19d545e909217bc15)
- Latest parity PR: [#5498 — evidence-backed narrow DeX HOME panel](https://github.com/newsdayads/tigeriq-ai-lab/pull/5498)
- PR exact-head: `6a39682602123dbbee41f63075cdd45e180e12d4`
- PR required checks: **7/7 SUCCESS**
- Main CI: [run 41136867103](https://github.com/newsdayads/tigeriq-ai-lab/actions/runs/41136867103) — **SUCCESS**
- Main Queue Hygiene: [run 41136867272](https://github.com/newsdayads/tigeriq-ai-lab/actions/runs/41136867272) — **SUCCESS**
- Main Vercel Online Verify: [run 41136867082](https://github.com/newsdayads/tigeriq-ai-lab/actions/runs/41136867082) — **SUCCESS**
- Android native rules: **87/87 PASS**
- Repository tests: **2462 PASS / 3 SKIP / 0 FAIL**
- Source readback: `HomeLayoutRules` and the narrow DeX HOME route are present on the accepted main SHA.
- Evidence comment: [F05 merged acceptance](https://github.com/newsdayads/tigeriq-ai-lab/issues/5135#issuecomment-6534739715)

This proves the current source and automated acceptance state. It does **not** prove full R08/R09/R10 device acceptance.

## 2. Real-device QA receipt

Authorized device route was used only because the TigerIQ PC01 OAuth MCP surface did not expose an ADB/device action. RDC was used only for bounded device QA, never for signer/task/security bypass.

Device:

- Serial: `R3CM400AKRX`
- Model: `SM-G977N`
- Android: `12`
- Installed V2 package: `ai.tigeriq.ultracarhcm.v2`
- Installed V2 version: `2.0.0-dev.10` / code `10`
- Installed V2 APK SHA-256: `80874e789b5e3a1bf821a60640023148a0c9019f39d026db594492ed9a076893`
- V2 signer certificate SHA-256: `71617043eace89e5f220ea9168b0a9592808111b0f17eaa219f5e6eceb569558`
- Local artifact hash matched the installed APK exactly.
- Installed V1: `com.ultracar.dexsplit` / `1.0.240` / code `240`

Verified on the real S10:

- V1 and V2 coexist and both launch.
- V2 HOME launches and exposes its real UI hierarchy.
- Camera runtime permission prompt was handled through Android permission UI.
- Camera USB enters the correct no-device state: `Đang chờ Camera UVC qua USB Host`.
- Camera open → close → reopen passes.
- Permission survives a cold app restart without a second prompt.
- Camera activity survives sleep → wake and resumes.
- Crash scan found no V2 fatal exception or ANR in the bounded run.

Primary device evidence:

- GitHub evidence summary: [R08 real-device dev.10 partial receipt](https://github.com/newsdayads/tigeriq-ai-lab/issues/5135#issuecomment-6534927776)
- PC01 receipt: `D:\TigerIQ\Evidence\gh5135-r08-real-device-dev10-GH-5135-R08-REAL-DEVICE-DEV10-20261031-2026-10-30T22-33-59-802Z.json`
- Receipt SHA-256: `b7ce42850f667eaed8a1a9dcd21719a416d1cadcf08888de261682cd6dc6783c`

Screenshot evidence recorded by that receipt:

| Evidence | SHA-256 |
| --- | --- |
| `v2-dev10-home-awake.png` | `E6B3837C9478001F8E6390D3B567A9D075570AE5547EC5EE3430C72F9F222415` |
| `v2-dev10-camera-aftergrant.png` | `1F7716EC01252F84FC5E03C2C4F513D8CB1573BF6F859E64664EE2BFAAF75C23` |
| `v1-launch.png` | `F6BA17039B737729EFC53B4E17095A900571562BB3BB1F2D37249C627335DFC9` |
| `v2-dev10-after-sleep-wake.png` | `382F00A4E856C1D111ACAAC063354CBAEAE8E3A895DD902B8B856C95D041B5A4` |

R08 remains **PARTIAL**, because this device is running dev.10 rather than the current accepted main build and the complete V1↔V2 flow comparison is not yet accepted.

## 3. TEST APK signing gate

The bounded signer contract is already source-controlled:

- [DEV11_LOCAL_SIGNER.md](https://github.com/newsdayads/tigeriq-ai-lab/blob/33cc758101c478a79aff87d19d545e909217bc15/apps/ultracarhcm-v2/release/DEV11_LOCAL_SIGNER.md)
- [Sign-UltraCarV2Dev11LocalTask.ps1](https://github.com/newsdayads/tigeriq-ai-lab/blob/33cc758101c478a79aff87d19d545e909217bc15/apps/ultracarhcm-v2/release/Sign-UltraCarV2Dev11LocalTask.ps1)

Known dev.11 input:

- Package: `ai.tigeriq.ultracarhcm.v2`
- Version: `2.0.0-dev.11` / code `11`
- Unsigned input SHA-256: `73ef300739f7c356b7f6939eac52246d8feba43b62335d40b9ca526e86e9d03c`
- Required signer certificate SHA-256: `71617043eace89e5f220ea9168b0a9592808111b0f17eaa219f5e6eceb569558`

Current verified state:

- The dev.11 handoff APK is **unsigned**; `apksigner verify` fails as expected.
- The separately authorized local-user V2 signing task is **ABSENT**.
- The expected signed dev.11 output is **ABSENT**.
- Existing V1 signing task must **not** be repurposed.
- Direct signer execution, DPAPI secret reads, task creation/widening, and Production release are outside this lane.

Final blocker readback: [signer/hardware blocker checkpoint](https://github.com/newsdayads/tigeriq-ai-lab/issues/5135#issuecomment-6534937283)

Important lineage note: the existing dev.11 signer input is from `MAIN_9140534`, while the currently accepted source main SHA is `33cc758101c478a79aff87d19d545e909217bc15`. Therefore the final R08/R10 artifact must be rebuilt/pinned from the current accepted main before full acceptance; an older signed dev.11 artifact would not prove current-main acceptance.

## 4. Hardware acceptance gates

The last real-device inspection showed:

- External DeX display: **ABSENT** — only display 0 was present.
- Physical USB UVC camera: **ABSENT**.
- Real UVC preview / attach-detach: **NOT TESTED**.
- Gear-R/reverse signal: **NOT AVAILABLE / NOT TESTED**.
- Real guide calibration: **NOT TESTED**.

Therefore:

- R03 USB UVC full acceptance: **BLOCKED/PARTIAL**
- R04 DeX external-display acceptance: **BLOCKED**
- R08 current-main device acceptance: **BLOCKED/PARTIAL**
- R09 real vehicle/DeX/UVC/Gear-R acceptance: **BLOCKED**
- R10 final signed TEST handoff: **BLOCKED**

No full milestone is promoted to PASS solely from source CI or the dev.10 partial device receipt.

## 5. Other open product gates

The Work Order also still records these independent unresolved requirements:

- F18 verified admin/license backend contract is missing.
- Owner-authorized V1 media reuse / remaining original-UI evidence is incomplete for final parity.
- Production release remains explicitly out of scope until all prior acceptance gates pass.

Canonical Work Order state: [Issue #5135](https://github.com/newsdayads/tigeriq-ai-lab/issues/5135)

## 6. Exact resume sequence

Resume only when the required external inputs exist, in this order:

1. Build/stage an exact TEST artifact from the **current accepted main SHA**, not the older `MAIN_9140534` lineage.
2. Use a **separately authorized local-user V2 signing task** scoped to that exact artifact; do not reuse the V1 signer task.
3. Verify package, version, APK SHA-256, signer certificate and v2/v3 signature before installation.
4. Install with bounded `adb install -r` only to the existing V2 package on the authorized QA device; do not mutate V1 data.
5. Re-run full R08 against that exact current-main signed APK and record screenshots/logcat/hash evidence.
6. Connect an external DeX display plus physical USB UVC camera and execute R09: attach/detach, preview, split/fullscreen, sleep/resume, camera open/close, real Gear-R trigger and guide calibration.
7. Complete missing F01–F22 parity/backend/media evidence.
8. Only after R01–R09 and F01–F22 are accepted, publish the TEST handoff for R10. Production remains a separate gate.

## 7. Security and integrity statement

This handoff does not claim DONE. During the verified device run and blocker analysis:

- no signer security gate was bypassed;
- no V1 signer task was edited or reused;
- no V2 signing task was created;
- no DPAPI secret was read or exposed;
- no Production release was performed;
- no V1 app data was intentionally mutated.

Current final state: **REAL BLOCKER / EXTERNAL WAIT** until current-main signing authorization and required DeX/UVC/Gear-R hardware are available.
