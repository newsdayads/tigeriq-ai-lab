# UltraCarHCM — APK build, release TEST, QA, backup (Owner-locked)

> Canonical task tracking: [Issue #5129](https://github.com/newsdayads/tigeriq-ai-lab/issues/5129). Owner interface/policy: [Issue #504](https://github.com/newsdayads/tigeriq-ai-lab/issues/504). This file is an operational runbook, **not** an automatic task scheduler, elevated permission or release approval. Last verified: 2026-10-24 (Asia/Ho_Chi_Minh).

<!-- CURRENT_STATUS_20261024 -->
## MỚI NHẤT: 24/10/2026 — v1.0.42 TEST (283)
STATUS=V42_TEST_SIGNED_DRIVE_VERIFIED|ORIGINAL_GUIDE_SINGLE_WARP_IMPLEMENTED|PHYSICAL_DEX_REVERSE_QA_PENDING|NO_CALIBRATED_STEERING|PROD_UNCHANGED|DONE=false
Owner videos IMG_8048/IMG_8049 v41 proved two overlapped guides, wrong curved geometry, reversed left/right and low sensitivity. Owner approved TEST fix.
v42 signed TEST APK: https://drive.google.com/file/d/1ihgK-LQgcINrC5UAV_CcOfrdplZfZx46/view ; SHA256 32EA13B7E8EC2A8D23716C9B40F9F41330A25E3910F9BA7FDA410C428F3776E7 ; size 35,154,333 bytes, versionCode283, original signing cert unchanged. PC01 one-shot Drive task exit=0; independent Drive readback SHA256 and ZIP integrity PASS.
Code: both original ParkingGuideFactory implementations instantiate NativeGuideWarpView subclass of the **original unchanged** ParkingGuidelinesOverlayView; draw original static lines/colored notches/distance pills and warp that same bitmap via 32x20 Canvas.drawBitmapMesh only upon gyro+video motion, otherwise parent draws static without changes. Secondary GuideTrackView custom paths removed (now sensing only). Rendering direction inverted once relative to failing v41. Faster 120ms sampling, lower optical and yaw/gyro gates, 0.64/0.36 smoothing. This is still visual heuristic, NOT actual steering angle/distance and needs parked-car DeX real QA for direction, response and absence of double lines.
Static hash guard original renderer, saved layouts, drag, Camera close X, manifest, MainActivity, USB and service preserved. Stable v1.0.35 backup + v41 TEST + Production v1.0.17 unchanged. Do not label FULL DONE or promote until confirmed on device.
Evidence: https://github.com/newsdayads/tigeriq-ai-lab/issues/5129#issuecomment-6380272691

### Historical v41
## MỚI NHẤT: 24/10/2026 — v1.0.41 TEST (282)
STATUS=V41_NATIVE_CAMERA_CLOSE_PATCH_SIGNED_DRIVE_INDEPENDENT_SHA_ZIP_VERIFIED|ACTUAL_SAMSUNG_DEX_QA_PENDING|DONE=false|PROD_UNCHANGED
APK: https://drive.google.com/file/d/10qa01UMxNbpt9qVsFvzy8z04KLkBjXSW/view ; SHA256 41422053E08E9B73FB4985F0FC7570DFAC3D4F14F9A23C6745F27F91E60EEFD0, 35,154,333 bytes. Signed same certified identity, versionCode282; Drive sync exit0, independent download hash and ZIP pass.
Owner physical QA v40: actual black X remains on Camera top-right, erroneous newly added red X sits OUTSIDE Camera next to Settings. Correct v41 patch modifies the original Compose Camera CLOSE control in smali/pd0.smali: removes spacer pushing it right, changes its own background to red; hides erroneous extra outside TextView in OverlayControls.smali while preserving GuideTrackView. ONLY X UI changed, all v40 features retained. This is a TEST, physical DeX QA for placement and button click pending.
Static source file preservation v40→v41: zc4/lh, Manager/DragGhost, camera GuideTrackView/DynamicGuideView, MainActivity, Manifest, original guideline drawing byte-identical. Working fallback v1.0.35 and Production v1.0.17 UNCHANGED.
Evidence: https://github.com/newsdayads/tigeriq-ai-lab/issues/5129#issuecomment-6379926646

### Historical v40
## MỚI NHẤT: 24/10/2026 — v1.0.40 TEST (281)
STATUS=V40_SIGNED_DRIVE_SHA_ZIP_VERIFIED|FIVE_OWNER_CODE_CORRECTIONS_STAGED|DEX_PHYSICAL_QA_PENDING|R_SOURCE_UNVERIFIED|CAMERA_CURVE_EXPERIMENTAL|PROD_UNCHANGED|DONE=false
Signed TEST APK: https://drive.google.com/file/d/12wv6A255u1-TRWsSc3A5_eObADRuqoRu/view ; SHA256 51D3C85EDE1F9F0103C8593023CA1B3588B0EE12A60451ADCC1975E2148B3476; size 35,154,333 bytes. PC01 one-shot G: Drive task exit0, receipt STAGED_VERIFIED_LOCAL; independently downloaded Drive APK checksum and ZIP PASS. Same original signer, package com.tigeriq.dexsplit, code281.
Owner v39 FAILS: ICON outside colored ratios, cropped drag card image, top-left red X Camera, curved guides absent even during actual reversing+steering, clipped bottom action labels.
v40 code: 48dp icon gutter OUTSIDE preserved 80dp colored ratio graphics in 128dp preview width; DragGhost 230dp full card snapshot; red TOP LEFT additional close control and legacy orphan button moved left; image-motion + gravity-projected gyro yaw new GuideTrackView wired via MainActivity UVC view finder (old ReverseGuidelineOverlay.wrapSurface had NO caller), adds supplementary experimental curved lines only during image/gyro motion; Saved-card-only button labels allow two lines, smaller font. Full visual outcome unverified. Red left X may coexist with old right X. Actual camera static marks may stay straight. NO vehicle steering sensor, NO reliable distance calibration. Parked DeX physical runtime QA mandatory; do not claim DONE.
Protected working rollback v1.0.35 untouched Drive https://drive.google.com/file/d/1Lja5vHEh4PyHfTXOs0a08C-nxByFObfL/view; v39 TEST and production v1.0.17 untouched.
Technical receipt: https://github.com/newsdayads/tigeriq-ai-lab/issues/5129#issuecomment-6379518076

### v39 historical status
## MỚI NHẤT: 24/10/2026 — v1.0.39 TEST (280)
STATUS=V39_SIGNED_DRIVE_VERIFIED|ICON_COMPOSITE_2X2_AND_DRAG_GHOST_AND_CAMERA_BROADCAST_GUARD_STAGED|DEX_PHYSICAL_QA_PENDING|GEAR_R_SOURCE_UNVERIFIED|PROD_UNCHANGED|DONE=false
APK TEST: https://drive.google.com/file/d/1R5-ZaeqeSVqNkxXaJPTfFym_InSFrukM/view ; SHA256 412C71183A9BE57D5A932CFBBA64DFBEE5BA9F950448E6FE30241F942912B2B1; 35,154,333 bytes.
OWNER evidence v38: icons too small and some apps missing, camera popup unexpectedly appears, drag reorder without floating card effect. v39 attempts code fixes: 40dp combined app icon (2x2 actual app logos, fallback initials), ViewOverlay moving card snapshot, block unverified R broadcasts from opening/closing camera. Existing manual Camera and USB auto-open fix retained; real R signal remains missing. Camera+gyro curved overlay inherited from v38 is uncalibrated and not accepted.
Protected approved v1.0.35 rollback and production v1.0.17 unchanged. Physical SM-F916N parked QA MUST verify every icon, drag visuals, Camera unexpected popup/manual controls and dynamic guide; no DONE claim. GitHub technical receipt: https://github.com/newsdayads/tigeriq-ai-lab/issues/5129#issuecomment-6378864674

### Mốc v38 — lịch sử
## MỚI NHẤT: 24/10/2026 — v1.0.38 TEST (279)
STATUS=V38_SIGNED_DRIVE_VERIFIED|APP_ICON_NATIVE_COMPOSE_AND_DYNAMIC_GUIDE_STAGED|DEX_DEVICE_QA_PENDING|GEAR_R_UNVERIFIED|PROD_UNCHANGED|DONE=false
APK TEST: https://drive.google.com/file/d/1FtizSoCwlxJidRJantFA3M0z-0kTWGTN/view ; SHA256 67E7E527912894E6879BBF93A07BC3E3E1B6D0E3C153AA8596596E0EC9F21C4D.
Thay thế lớp phủ ICON cũ bằng vẽ Compose cho từng App; thêm vạch cong thử nghiệm dùng Camera+Gyroscope, thiếu tín hiệu giữ thẳng. Chưa QA thật DeX; tín hiệu số R chưa xác minh. Không đổi v1.0.35 backup hoặc production v1.0.17.
Biên nhận mới nhất: https://github.com/newsdayads/tigeriq-ai-lab/issues/5129#issuecomment-6378175575

### Mốc cũ — giữ làm lịch sử
## Current canonical status — 2026-10-24 07:10 ICT

`OPEN | v1.0.37_TEST_BUILD_SIGNED_DRIVE_VERIFIED | DeX_RUNTIME_QA_PENDING | GEAR_R_SIGNAL_UNVERIFIED | CURVED_GUIDELINES_NOT_IMPLEMENTED | PROD_UNCHANGED | DONE=false`

- **Next valid action:** perform physical Samsung DeX (SM-F916N) QA, safely parked, for 3 columns, per-assigned-app icons next to proportional zones, all buttons/drag/drop persistence, and USB reconnect/manual Camera popup regression. No real-device PASS evidence has been supplied yet.
- **P0 blocker:** no verified external reverse-gear signal source; USB connection / GPS / phone gyro are NOT equivalent to selected gear R. Do not claim automatic R detection works.
- **P1 open:** image motion + gyro curved parking guide still requires implementation and calibration; static 0.5m/1.0m/1.5m original artwork preserved in v37.
- Working-backup immutable: v1.0.35; v1.0.37 is TEST only and must not replace production v1.0.17.
- Owner status/live receipts: [Issue #5129](https://github.com/newsdayads/tigeriq-ai-lab/issues/5129); latest test artifact: [UltraCar v1.0.37 TEST](https://drive.google.com/file/d/15dCMNZSLrCSCVXA1UMwIp9ZKZbjCbmpx/view).

## Non-negotiable scope / authority
- User-approved designs are authoritative. **Saved Layouts and Reverse Camera are different UI screens.** Never combine their visuals.
- Saved Layouts: **three cards per row**, original compact cards, original orange MỞ and five bottom actions with unchanged behaviors; each card's existing colored proportional zone preview gains a **tiny app icon per assigned app immediately to the LEFT of the matching color shape**, no new app names. Do not replace zone preview. Maintain default badge, drag reorder, ordering persistence, session IDs, shortcut icon chooser.
- Camera: original floating popup frame, sizing and controls, original green 1.5m/yellow 1.0m/red 0.5m markup; manual Camera remains functional. Never auto-open from USB plug/reconnect, app resume, permission grant, or boot. Auto R requires actual verified external R state, R off closes auto popup. Curve is an **estimate using image motion plus device gyro**, only with sufficient measured motion and separately QA-calibrated against the original fixed guideline artwork; do not claim steering wheel angle, true trajectory, or metric distance accuracy. If no R source, **block automatic-R acceptance**, do not infer R from phone sensors.
- User authorized TEST operations in isolated stage and Drive, but **production rollout, signing identity changes, elevated permissions or paid services still require scope-appropriate authorization**. No repeated approval prompts for already-authorized TEST build steps.
- Fail safely: if a required check is absent, mark TEST/PARTIAL/BLOCKED; never assert DONE or 100%; never tell a future chat the data auto-updated.

## Hardware / paths / backup
- Remote PC01 Windows DeX build machine, deviceID `99f8189f-28c6-4b47-86e6-5e68415a4368`. Project root `D:\TigerIQ\Apps\DeXCamPersonal`; tools `D:\TigerIQ\Tools`.
- Confirmed Owner-working fallback **v1.0.35 build 276**, SHA256 `3434BFB0A4667174880C447C31FCAC1F285A06CBD06D18F93A32652FA82F9E9B`. Immutable [Drive backup](https://drive.google.com/file/d/1Lja5vHEh4PyHfTXOs0a08C-nxByFObfL/view). Do not overwrite/delete. Older v1.0.28 backup remains.
- v1.0.36 build 277 was TEST only, SHA256 `73F0628C1D195670D8C4C72E2AC86360A496753C18A45E05B00AFA7CB03458FA`. [Drive](https://drive.google.com/file/d/1S0SPowMykiSp88A69JX1-S5Th4oNoQwL/view).
- **v1.0.37 build 278** (2026-10-24) TEST only, SHA256 `382DEE79A9383DB4E9C9616EC76E59901219313A6B1F77C3636BB702F4BC1985`, [Drive TEST](https://drive.google.com/file/d/15dCMNZSLrCSCVXA1UMwIp9ZKZbjCbmpx/view). Package `com.tigeriq.dexsplit`, signed same certificate as baseline, APK ZIP and Drive readback checksum match. **Runtime DeX NOT verified, no curved guides, real R not verified**.
- Production v1.0.17 must remain unmodified unless explicit separate production authorization.
- Drive release folder ID `1QTOWvtgrdGIml15J55LttcyKa7rLkdva` = TigerIQ UltraCar; backup folder ID `1-h6u2qp-b3QZXqtPj0g2UUwp1s0GDu8j`. Only unique TEST filename by version; no overwrite known-good build.

## Native source points (Apktool SMALI + Java overlay)
- v37 isolated stage: `Staged_v1_0_37_OwnerLockedGridCamera_278`, cloned from v36. Prior stages and confirmed v35 remain unchanged.
- `smali/lh.smali`: saved layout LazyVerticalGrid branch `:pswitch_3` has 3 columns; `div-int/lit8 v1, v0, 0x3` and `v10=0x3`; do not change other branches.
- `smali/zc4.smali` preview Compose card: original size/controls maintained. `smali/c8.smali` preview zone drawing uses a left 22dp gutter for app icons, proportional color bars scaled into remaining 58dp. Watch SMALI register encoding: high registers v16+ require wider instruction forms.
- App assignment source: `Lta1.getAssignments(): List<Lto5>`; each `Lto5.getZoneId()`, `Lto5.getApp(): Lfo`; `Lfo.getPackageName()` for installed app icon. Use actual per-zone app icon; **do not use saved shortcut icon** or just first app.
- Java implementation `patch_v37/src/com/tigeriq/layout/CardIconOverlay.java`, attached in `MainActivity` through existing v36 hook. Every saved-layout card gets assigned app icons drawn next to original colored zones. The overlay should be **considered experimental until validated on physical DeX**; accessibility-title anchors might fail, or show misplaced images.
- Camera open entry points: `ReverseGearReceiver.smali` handles `ACTION_REVERSE_GEAR` broadcast; `MainActivity.smali` manual Camera bridge; `fw2.smali` permission path; `TigerIQBridge.smali` USB watcher; **`jt.smali` hidden secondary USB receiver**. v37 has `jt.smali` USB ATTACHED direct `TigerIQBridge.openCamera()` changed to `nop`; critical fix for spontaneous popup.
- Camera imagery `res/drawable/reverse_guidelines.png` displayed from `smali/com/ultracar/dexsplit/ui/ReverseGuidelineOverlay.smali` as FIT_XY overlay. Dynamic gyro+camera image-motion transformation NOT implemented in v37.

## Procedure (always perform in this order)
1. Reread this runbook + current Issue #5129 + latest evidence and Owner's approved image. Verify baseline hash, Drive folder, no existing target artifact. Don't ask Owner to repeat settled scope.
2. Clone a new isolated stage; do not modify v35 working backup, v36 TEST or production v17. Implement **one purpose at a time** and audit SMALI diff to protect unrelated components; include both bug's callsite and effect path.
3. Compile Java with Android API34 `javac --release 8`, `jar` class bundle, D8 dex conversion, decode isolated mini APK to SMALI, copy only new classes into stage. SMALI changes must successfully build through Apktool. Recompile failed steps until true PASS; never falsify.
4. Increment `apktool.yml` versionCode/versionName and profile build label. Sign using same installed signer and verify zipalign, APK v2/v3 signature, package name/version, exact baseline signing certificate SHA256. Never print/commit keystore credentials.
5. **Static diff** against baseline for untouched camera/core/Compose files; verify app names not confused with shortcut icon selection. Validate checksums and APK ZIP.
6. Stage to Drive **TEST** through the authorized, logged-in interactive sync user (not a SYSTEM process with no mapped drive), using a **one-time job executed immediately** and a receipt: process exit 0, expected file count=1, matching SHA256 on stage and target; verify file appears in official Drive folder; fetch it through Drive connector and independently SHA256 + ZIP test. Do not describe transient sync as verified cloud release.
7. Log GitHub issue evidence: stage path/version/SHA, modified files, build+sign proof, Drive file ID, remaining QA/feasibility blockers. **No production promotion** until physical DeX owner QA.
8. Physical Samsung DeX SM-F916N QA: 3 columns, cards and 2/3 app icon labels correct, drag reorder and persist after restart, original buttons, default and pin shortcut, manual Camera opens/closes; repeated USB reconnect/startup never auto opens, camera only when trusted R signal if actually available, R off closes; where gyro+image curve exists, stationary remains straight and moving curves sensibly without dangerous false precision. Log actual evidence before marking DONE. If crash or regression, rollback v35 immutable backup.

## 2026-10-24 verified build receipts
- v37 local signed: `build/UltraCar_v1.0.37_278_signed_TEST.apk`, size **35,137,949 bytes**; SHA `382DEE79A9383DB4E9C9616EC76E59901219313A6B1F77C3636BB702F4BC1985`.
- Signer cert SHA256 `71617043eace89e5f220ea9168b0a9592808111b0f17eaa219f5e6eceb569558`, same baseline. APK signature v2/v3 PASS; apktool build and stage static diff PASS; Google Drive v37 download rehashed exact match, ZIP test PASS.
- **Unresolved**: runtime DeX QA for 3-column/icon overlay, reverse-R actual event source, future Camera+gyro+image-flow estimate/calibration; do not call these features DONE.
- Documentation on GitHub main persists across chats. Future chat needs to actively **fetch this latest runbook and Issue #5129**; updating GitHub alone does not magically reload an open ChatGPT/Gemini conversation.
