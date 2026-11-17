# GH-5135 — V2 15-screen Android QA inventory (17 Nov 2026)

Work Order: [#5135](https://github.com/newsdayads/tigeriq-ai-lab/issues/5135). Source commit: `43a26c4c9a268c9ef0acf48540c8514a3471f705`. Test applicationId: **`ai.tigeriq.ultracarhcm.v2.vqa`** (isolated development application, not user V2 and not V1).

## Scope and results

- Android build + JVM test + AndroidTest APK assembly: **PASS**, PC01 native Gradle log SHA256 `98BCD376292EE5A8C69C0F35D0B4963133879EAE7C51A22CE79785F795E7F47E`.
- Newly added **15/15 Android screen-render tests PASS** on authorized Samsung S10 SM-G977N (Android 12), log SHA256 `1817E43B2EE7EECE1BB785F00EC7627290CEC68A658B7DA8E1BFF12818ECE956`. Captures from the isolated app were pulled into PC01 private evidence; 15 screenshots and their SHA256 values are indexed by receipt `D:\TigerIQ\Evidence\gh5135-v2-all15-real-s10-screen-capture-20261117.json`, SHA256 `123737C7033036CBFEF015ADA51F4B9FD339408DEA64F0A87E87F459DE2FF5FB`.
- **46/46** complete Android instrumentation tests PASS in simulated external display 1920×1080/320. Receipt `D:\TigerIQ\Evidence\gh5135-v2-46-tests-real-S10-virtual-20261117.json` SHA256 `4E742A332A487F079C47AAB393EE32976C2F21A0BD4E23F6E900AAE67A63433A`. Detailed log SHA256 `719CDD419038995FD37C2C845144B7DB1B93ED419BE6B661575BCD11ED146F39`. Developer virtual-display setting was restored from `null` back to `null` on test completion.
- Both existing installed user packages, V1 `com.tigeriq.dexsplit` and V2 `ai.tigeriq.ultracarhcm.v2`, were not replaced. QA package `.vqa` alone was updated. No Android runtime permission was auto-granted.

## Screens exercised

| Name | Android Activity | Nonflat view + capture on S10 |
|---|---|---|
| HOME | HomeActivity | PASS |
| Car model | VehicleActivity | PASS |
| Appearance | AppearanceActivity | PASS |
| UVC camera without physical device | UsbCameraActivity | PASS, **does not prove UVC** |
| Battery/GPS diagnostics | TelemetryActivity | PASS, **does not prove GPS accuracy** |
| OBD connection screen | ObdActivity | PASS, **does not prove OBD hardware** |
| Taxi Meter | TaxiMeterActivity | PASS, **does not prove journey fare accuracy** |
| Reports | ReportActivity | PASS |
| Driver Profile | ProfileActivity | PASS |
| License status | AdminLicenseActivity | PASS, **backend absent** |
| Privacy | PrivacyActivity | PASS |
| Notifications | NotificationActivity | PASS |
| Recovery | RecoveryActivity | PASS |
| Updates | UpdateActivity | PASS, **release disabled** |
| Steering remote settings | RemoteKeyConfigActivity | PASS, **does not prove BT controller** |

## Comparison with genuine V1: evidence and limitations

- V1 installed on S10 is **Android Build362 / v1.2.16**, an auxiliary baseline, not verified V1 Golden Build369. Device screenshot/UIAutomator evidence includes 49 Home nodes and the physical Driver Profile view with 49 nodes (private PC01 only). Do not extract private V1 assets/API or infer invisible touch flows from a screenshot.
- The exact Owner-accepted V1 backup SHA `07FA280005D71C0D4E38C085C3077ED01B66497E1E3EB54B0C2ED4D7999F038E` matches the canonical release JSON but two independent Android parsers read **embedded manifest Build362**, not record label Build369. PR #5736 merged a fail-closed V2 release provenance gate. The V1 original was not modified.
- This test proves all current **V2-declared Activity screens can start and draw**, and the 46 existing Android smoke cases pass. It does **not** prove complete V1 parity, exact UI media, in-screen button interactions, UVC camera capture, native DeX, physical Bluetooth steering controls, live Gear-R, license backend, or Owner final acceptance.
- F01–F22 status remains **PARTIAL_SOURCE / DEVICE_REQUIRED**, not ACCEPTED. No signed V2 public release nor Drive upload.

## Deterministic repro

`./gradlew :app:assembleDebug :app:assembleDebugAndroidTest :app:testDebugUnitTest` on isolated QA source. Android test class `V2AllScreenAuditDeviceTest.kt` uses only the `.vqa` package, writes 15 QA-only PNGs to its Android external app-specific directory, and never opens V1 private APK media.
