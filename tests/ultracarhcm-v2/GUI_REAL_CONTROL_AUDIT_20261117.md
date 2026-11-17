# GH-5135 — 6 real Android V2 UI control tests (2026-11-17)

- Work Order: [#5135](https://github.com/newsdayads/tigeriq-ai-lab/issues/5135).
- Exact source before documentation: `a4958e038ddd9aa29f153b9543dedb2f3782e766`.
- QA package: `ai.tigeriq.ultracarhcm.v2.vqa`; device: authorized S10 `SM-G977N` Android 12. Existing installed V1 and user V2 packages not replaced.
- Android Gradle assembleDebug + assembleDebugAndroidTest + JVM suite: **PASS**, log SHA256 `6C4CEF18569C546AF871E561C86E7E9378C5B1CC9A442D757A906BA31FC4BBA3`.
- Six new functional Android UI tests **6/6 PASS**, verified directly from output without rerunning; log SHA256 `3B9D86B1057058AAD71D2872885DCA31199B360B89A369700D1AA6A2D3778D12`. Receipt SHA256 `2FA5EEC8739E29F0DF0CF94CC8FB56BBC8A4A1E99A6DE1B951B614F04EBD90D4`.
- Full Android suite including 15 screen captures and 6 functional tests: **52/52 PASS** on S10 with temporary `1920x1080/320` secondary display ID 26. QA APK SHA256 `84D6AFD7F8BA9406F2EE2EDA95FAA6200C96F2F00D5B8653AA769145B5746633`; AndroidTest APK SHA256 `2B1CF6127372BE8ED66B8E790D3AF0DB03FB11369635DAE98CB2408E0EF4075D`. Full log SHA256 `4AFD2A0610001DFCBE37DD9E37A821D8DD44A59E94AAB5BE8624BE60871AFDB0`, receipt SHA256 `D796741FCEE64238FDE55C774CD5ED25F1022C945D2E822115455AEBF38F3C03`. Android overlay display setting was restored exactly `null` → test → `null`.
- Tests: real F09 day/night Button click and persisted state then exact rollback; F15 local notice mark-read/clear buttons and exact snapshot rollback; F15 update download/install not enabled prior to verified metadata (no network request); F18 running package identity + license fail-closed with no activation button; F19 report summary/CSV button presence (SAF not invoked); F20 live permission status and OS Settings controls (no permission grant).
- These are **function-UI QA PASS**, not proof of full V1 functional parity, real Samsung DeX, physical UVC, Gear-R, OBD, live weather, license backend, signed release or complete media matching. F01–F22 acceptance statuses remain unchanged.

## Independent installed-V1 baseline validation
- Owner-designated Golden backup SHA256: `07FA280005D71C0D4E38C085C3077ED01B66497E1E3EB54B0C2ED4D7999F038E`. Release JSON labels it V1.2.23 Build369, but independent `aapt2` and binary manifest parsers find versionCode **362**, versionName **1.2.16**.
- **Further proven:** Installed S10 V1 APK SHA256 `D8B8DE0A454ACB88E911AD11331EFF91884714466EF8B4554807D8D3447F82FC`, 35,166,511 bytes; it **differs** from designated Golden backup. This was read-only `adb pull` + SHA-256, no decompilation, no modification; the temporary APK was deleted. Receipt SHA256 `C190DE2AD887A7C882814FB2C0EBC8684557C48EEFD4661D23550FD4DD01CF61`.
- Therefore S10 V1 behavior can only serve as an **auxiliary UI reference**, not exact binary Golden acceptance. Do not silently promote either V1 version or V2 parity from source or screenshot similarity.

**Source tests:** `apps/ultracarhcm-v2/app/src/androidTest/java/ai/tigeriq/ultracarhcm/v2/V2FunctionalScreenActionsDeviceTest.kt`.
