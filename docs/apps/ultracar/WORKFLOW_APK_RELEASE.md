# UltraCarHCM — APK build, release TEST, QA, backup (Owner-locked)

> Canonical task tracking: [Issue #5129](https://github.com/newsdayads/tigeriq-ai-lab/issues/5129). Owner interface/policy: [Issue #504](https://github.com/newsdayads/tigeriq-ai-lab/issues/504). This file is an operational runbook, **not** an automatic task scheduler, elevated permission or release approval. Last verified: 2026-10-24 (Asia/Ho_Chi_Minh).

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
