# GH-5135 — Device QA: test actual V2 controls, not merely Activity rendering

## Acceptance target
Baseline: main after merged PR #5737 `f18e5d85b58a7a0d62f64fdebec4f3efdf04cc21`.
Owner: existing work order #5135. Android device: connected S10 running isolated `ai.tigeriq.ultracarhcm.v2.vqa` app only.

The 15-screen smoke and 46 Android tests assert that pages open and render. They do **not** verify live user-facing actions. Add Android instrumentation tests that exercise **real native Activity views** and verify:

1. **F09 Appearance:** click real "ĐỔI NGÀY / ĐÊM" button, confirm persisted `night` toggles and rendered status reflects the new mode. Restore the exact pre-test state (including absent key) in `finally`.
2. **F15 Notifications:** seed an isolated future TEST update notice, click "ĐÁNH DẤU ĐÃ ĐỌC", verify persistent read flag and UI; click "XÓA THÔNG BÁO CỤC BỘ", confirm no notice and disabled controls. Restore exact QA-domain pref snapshot in `finally`. No real push, network or notification permission.
3. **F15 Update:** verify download/install buttons start hidden; no update checks, network calls or Android installer triggered.
4. **F18 License:** assert real local running package/version is rendered, backend unconfigured and activation/registration unavailable. No activation controls or credentials.
5. **F19 Reports/F20 Privacy:** assert report summary plus CSV user-select action exist, and permission status text is genuinely present; do not invoke SAF/export, settings changes or runtime-permission prompts.

### Anti-fake boundaries
- Abort tests unless target package ends **exactly** in `.vqa`; never write V1 or user V2 preferences.
- Never claim these 5 surface-level tests prove F01–F22 parity, functional UVC/Gear-R, Google Play signing, or physical DeX.
- Run Gradle build, unit tests, S10 complete Android instrumentation and record exact source SHA/log/rollback. No release APK or Drive mutations.
