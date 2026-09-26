# WO-027 — Buildable TigerIQ Android Worker MVP

Status: DONE — APK BUILD/CI VERIFIED; REAL DEVICE NOT YET CLAIMED

## Delivered
- Android 35 / minSdk26 app with applicationId `ai.tigeriq.worker`.
- Android Keystore P-256 device identity.
- Persistent foreground worker service skeleton.
- Safe AccessibilityService semantic bridge skeleton.
- Explicit permissions/resources and dedicated Android APK build workflow.

## Branch/PR hygiene
The original stacked PR #86 was closed without merge after WO-026 was squash-merged. A clean branch was rebuilt from MAIN containing only the 11 Android Worker/workflow files, preventing duplicate WO-026 changes.

## Verified evidence
- Clean PR: #87.
- Exact head: `e824dddf577efd6bf378c9fbba760b4ddf6a9f78`.
- CI: run `33332788143` PASS.
- Queue Hygiene: run `33332788235` PASS.
- Vercel Verify: run `33332788210` PASS.
- Android Worker APK build: run `33332788122` PASS.
- Preview: `dpl_9NLq3mSvWbK4X8hqgtk4tURmy8qR` READY at exact head.
- Merge SHA: `eeff17c2ffdea30d8c82fbab3ab8a7478dd64efa`.
- Production: `dpl_4dQ8ngBi4ogiSraGJBHitkC1bLsQ` READY at merge SHA.
- Post-merge `/api/control`: HTTP 200; canonical queue remained #57/#58.

## Non-claims
The APK has not been installed/paird on a physical phone; Accessibility permission, account login and real task execution are not claimed.
