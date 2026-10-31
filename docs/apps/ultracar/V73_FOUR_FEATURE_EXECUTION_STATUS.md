# UltraCar V73 TEST candidate — Camera icon and layout sort architecture

Date: 2026-10-31. Owner approved a four-feature package (Camera icon, OTA auto-update, profile responsive cards, layout sorting), but **do not mark this work DONE** or publish a partial APK as a final fix.

## Implemented, PC01 local unsigned candidate only

- Isolated stage `D:\TigerIQ\Apps\DeXCamPersonal\Staged_v1_0_73_TEST_314_MCP` from V72 Build313. Existing V72 signed APK and canonical signing manifest are unchanged.
- Camera floating bubble: `FloatingCameraService$1.onDraw` always uses the existing native Canvas **camera pictogram** fallback, instead of letting the supplied unrelated drawable override it. This changes appearance only, leaving manual shortcut touch handler and camera safety gates intact.
- Layout reorder: the four Saved-screen Compose hooks in `ad4.smali` call `com.tigeriq.v73.LayoutReorderEntry.arm()` instead of overlay `SortPopup.show()`. After the Compose list passes through `bd4.smali` and `Manager.sort(List)`, call `LayoutReorderEntry.listReady()`. Java UI thread delayed execution opens **existing native `Manager.show()` dialog** populated from `Manager.current`, with named layouts, drag handles, and ↑/↓ shift controls. This avoids unreliable x/y card hit-testing and does not depend on a floating sort button being visible. Two Home callbacks reset the one-shot. **May need actual screen routing and lifecycle validation.**
- Profile subtitle string updated to `TIGERIQ HCM v1.0.73 (BUILD 314)`; this is **not** a fix for the separate 2–3 cards per row request.
- USB/DeX automatic Camera open remains blocked. No verified physical reverse-gear signal; auto-camera-on-R not accepted.

**Build evidence:** Java8 + D8 PASS, 5 generated Smali classes, patch source guards PASS; Apktool BUILD PASS, zipalign `-c -p 4` PASS, `aapt2 dump badging` identifies `com.tigeriq.dexsplit`, `versionCode=314`, `versionName=TigerIQ_HCM_v1.0.73`. Aligned unsigned APK `D:\TigerIQ\Apps\DeXCamPersonal\build\UltraCar_v1.0.73_314_CameraSort_aligned_TEST.apk`, 34,986,089 bytes, SHA256 `E52C21E5C4A2E1E126C6F1DF20DCD7E63D60CB9FE8BF6B6D31FC23193AE242A5`.

## Missing: real blockers

1. **OTA auto-install:** Live GitHub `main/version.json` still code306/V65 pointing to a Drive *folder* rather than an APK download. Signed TEST APK V72 Drive file remains private. Android cannot anonymously download a protected Drive file via `HttpURLConnection`. Previous attempted private Tailscale OTA service creation was denied by host policy; do not use a wrapper/alternate route to circumvent it. Public GitHub release needs explicit permission to expose the TEST APK and security check.
2. **Profile 2–3 cards per row:** the entire Profile Compose screen resides in obfuscated compiled `fx3.smali` (~33,000 lines), without a verified original Kotlin Compose UI source/build system. Blindly replacing column layout with a multi-column container risks breaking editable profile fields. No grid change made or claimed. Prefer obtaining canonical source and implementing adaptive `WindowSizeClass`/responsive grid there, then real Fold2/DeX QA.
3. **Release/QA:** V73 is not signed, uploaded, or installed/accepted on owner's Fold2 DeX. No V73 signing manifest activation; V72 stays current TEST. Existing app signing key must stay private. The previously denied remote signing tool action cannot be bypassed through another tool. Real acceptance requires Camera icon, named GreenSM reorder/BE Partner unaffected after reopening, profile grid 2–3 cards, and working direct OTA download + Android package confirmation.

**Status:** V73_CAMERA_ICON_PATCHED|V73_SORT_ALTERNATIVE_PATCHED|BUILD_PASS|OTA_BLOCKED|PROFILE_GRID_NOT_IMPLEMENTED|SIGN_NOT_REQUESTED|DRIVE_UNCHANGED|OWNER_DEX_QA_PENDING|PRODUCTION_UNCHANGED.
