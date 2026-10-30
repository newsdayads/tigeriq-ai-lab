# UltraCarHCM V69 TEST — In-app APK update button

Owner standing scope: FULL_AUTO_TEST_RELEASE=APPROVED, Production unchanged. Source of truth: GitHub main, Issue #5129.

## Implementation (PC01 2026-10-31)
- Input: `D:\TigerIQ\Apps\DeXCamPersonal\Staged_v1_0_68_TEST_309_MCP`.
- Stage: `D:\TigerIQ\Apps\DeXCamPersonal\Staged_v1_0_69_TEST_310_MCP`.
- Source class: `patch_v69_mcp/src/com/tigeriq/v69/UpdateController.java` also preserved in `apps/ultracarhcm-v1-v69/src/com/tigeriq/v69/UpdateController.java`.
- The existing settings callback `TigerIQProfileUpdateClick.invoke()` was replaced to call `com.tigeriq.v69.UpdateController.start(Activity)`. It **no longer opens a Drive folder**. V69 will use `https://raw.githubusercontent.com/newsdayads/tigeriq-ai-lab/main/version.json`.
- Java 8 `javac` and Android D8 compiled; 8 generated Smali classes inserted into stage. Apktool 2.10.0 build PASS; zipalign check PASS; aapt2 identifies `com.tigeriq.dexsplit` code310/name `TigerIQ_HCM_v1.0.69`.
- Unsigned artifact: `D:\TigerIQ\Apps\DeXCamPersonal\build\UltraCar_v1.0.69_310_DirectUpdater_unsigned_TEST.apk`, SHA256 `1469C11421B7975BCF3349CA16369E3A460744F6E061A1D5E7FEA0746F1573D0`.
- Aligned artifact: `D:\TigerIQ\Apps\DeXCamPersonal\build\UltraCar_v1.0.69_310_DirectUpdater_aligned_TEST.apk`, bytes `34981993`, SHA256 `5A1C7CB7E518BB269DB1DD9450D41FE62A7E61D9D9B2D55EBEFB64AE04B9DACC`.
- PC01 `D:\TigerIQ\Tools\ultracar_test_release.json` now pins V69 after V68 backup `ultracar_test_release.v68_309_signed_drive_verified.json`. Same existing signer/sync scripts and signing cert SHA256 `71617043EACE89E5F220EA9168B0A9592808111B0F17EAA219F5E6ECEB569558`, no new key material.

## Runtime flow
- On Update press: asynchronous HTTPS version check; if newer, direct download to app-owned Download directory with progress; verify SHA-256, ZIP, package/version, and signer certificate of **both** downloaded and installed app. Then open Android's standard APK install confirmation via existing FileProvider.
- Android may require “Allow app installs from this source” and user confirmation. No silent-install claim.
- If source is unavailable, wrong version, hash, signer, HTML/login page or redirect to unsupported host, **fail closed** with error. Does not install anything unverified.
- This **does not update an existing V68 binary in place**; V69 must first be installed through normal signed release.

## Hard delivery gate / not DONE
- Existing GitHub `version.json` reports code306 and points to a Drive **folder**, not downloadable APK. Anonymous HTTP requests for V68 Drive file ID `1XgXJc1X3ZF1r26ASNnNYcj9HGU6wPt3z` redirect to Google sign-in and return HTML, not APK. Android HttpURLConnection cannot use the user's Drive web cookies.
- Need explicitly authorized **HTTPS direct APK delivery endpoint** (either appropriately approved asset distribution with access controls or a signed/authorized download gateway), plus live `version.json` version/hash matching that signed artifact.
- V69 is **unsigned**, not published to Drive; therefore real-device DeX install/update QA is not passed. No CI job or account should bypass a host-denied signing action. Owner's allowed local signing route is the existing `D:\TigerIQ\Tools\sign_latest.cmd`, followed by independently verified task/Drive receipts.
- Do not update production, make restricted Drive APK public, or claim FULL DONE without signed V69 APK + provider metadata + Android device acceptance.
