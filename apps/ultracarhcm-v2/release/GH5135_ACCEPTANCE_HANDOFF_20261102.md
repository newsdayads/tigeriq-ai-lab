# GH-5135 — UltraCarHCM V2 acceptance handoff — 2026-11-02

Status: **NOT DONE — source clean-clone gate improved; signed TEST and real hardware acceptance remain blocked**  
Work Order: #5135 - [P1][AUTO][DeXCam] UltraCarHCM V2 — Kế hoạch triển khai xây dựng lại APP gốc  
Canonical repository: `newsdayads/tigeriq-ai-lab` / `main`

## 1. Current canonical source

- Current main SHA: `634884b1acc98ddb2c3acf1fc4df1bf1657f241d`
- Latest R01 PR: PR #5572 - [P1][GH-5135] Prove clean-clone Android native build
- PR exact-head SHA: `1610860e78962dd11dab167a501414b4cc604016`
- PR exact-head CI run: `41369165113` — SUCCESS
- Queue Hygiene run: `41369165041` — SUCCESS
- Vercel Online Verify run: `41369165092` — SUCCESS
- Repository Vitest: 2548 PASS / 3 SKIP / 0 FAIL
- Playwright: 60 PASS / 0 FAIL
- Android JVM rules: 99 / 99 PASS
- Clean-checkout debug APK SHA-256: `ef338272ec6559ac8d25aa1ea454893f247e31b9e4e02c281778c3bf249c6d08`

The Android native gate now builds, lints and unit-tests the exact GitHub head from an **unmodified clean checkout**. CI no longer injects synthetic versions of the six governed V1 media files before Gradle.

This proves clean-clone Android source buildability. It does **not** prove V1 media rights/parity, signed TEST provenance, device acceptance, or Production readiness. The verification debug APK is not published.

## 2. Current F10 unsigned handoff tooling

PR #5571 - [P1][GH-5135] Add exact-main unsigned APK handoff preparer is merged.

`Prepare-UltraCarV2Dev11UnsignedHandoff.ps1`:
- requires an explicit 40-hex expected main SHA;
- requires checkout HEAD to equal that SHA;
- requires a clean tracked worktree;
- builds `:app:assembleRelease`;
- verifies the release APK remains unsigned;
- zip-aligns and verifies alignment;
- verifies package/version identity;
- writes source SHA, artifact SHA-256 and signer-certificate requirement to a JSON receipt;
- never signs, reads/enrolls credentials, creates/starts tasks, installs with ADB, stages Drive content or releases Production.

## 3. PC01 verified state

Latest verified PC01 checkout:
- detached HEAD: `41c16a563094d36ef68c6f9cc9bcc0987b1caf60`
- local main ref: `bfb452918bbf36263b0461bfb138fde18f68ff2f`
- current preparer synced locally: **NO**
- exact current-main unsigned handoff: **NO**

Existing V2 signer task:
- `TigerIQ_UltraCar_V2_dev11_f22c408aa_Sign_TEST`
- state: Ready
- scope: old `f22c408aa` artifact only
- last result: 1
- last verified error: `LOCAL_DPAPI_ENROLLMENT_REQUIRED`

The old signer task must not be repurposed for a newer main SHA.

## 4. Real-device and hardware state

Previously verified S10 dev.10 partial QA remains valid only for that older installed build:
- V1/V2 coexist and launch;
- V2 Home launches;
- CAMERA permission path works;
- no-UVC wait state is correct;
- camera open/close/reopen works;
- sleep/wake bounded test passed;
- no bounded-run V2 fatal/ANR was recorded.

Still required:
- exact-current-main signed V2 TEST APK;
- full R08 on the S10 against that exact APK;
- external Samsung DeX display;
- physical USB UVC camera;
- real Gear-R/reverse signal and guide calibration.

## 5. Remaining product gates

- F01/F02/F17/F19 exact visual/media/V1-semantic parity still requires authorized original media or independently verified V1 evidence.
- F18 remains fail-closed because no verified admin/license backend contract exists in the repository.
- F03/F04/F05/F06/F07 and other runtime-sensitive rows require device/hardware acceptance.
- R10 signed TEST publication cannot be claimed until the required earlier acceptance gates are genuinely satisfied.
- Production remains a separate prohibited gate under the current Work Order.

## 6. Exact next sequence

1. Synchronize exact current `main` to PC01 through an authorized route.
2. Run the build-only unsigned handoff preparer against that exact SHA.
3. Create/use a separately authorized signer scoped to the exact new artifact and valid current-user DPAPI enrollment.
4. Verify package/version/APK SHA-256/signer certificate/v2-v3 signature.
5. Install only the existing V2 package on the authorized QA device.
6. Execute full R08.
7. Execute R09 with external DeX + physical UVC + Gear-R.
8. Complete remaining media/backend evidence.
9. Only then publish the signed V2 TEST handoff. Production remains separately gated.

Current state: **EXTERNAL WAIT / REAL BLOCKERS REMAIN**. No false DONE and no signer/security bypass.
