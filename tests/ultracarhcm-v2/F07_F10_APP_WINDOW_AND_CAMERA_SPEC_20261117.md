# GH-5135 F07/F10 — launch an assigned app in a requested DeX window

## Observed gap
In `HomeActivity.launchQuickSlot`, an external assigned app was launched with `startActivity(launch)` and **no explicit external-display affinity or bounds request**. In contrast, `UsbCameraActivity.toggleFromShortcut` already uses `ActivityOptions.launchDisplayId/launchBounds`. The requested behaviour is to open the assigned app in its allocated external-screen region rather than blindly open full-screen on the phone.

## Contract
1. Preserve V1-derived editable 9 QuickBar slots (tap launches, long-press edits) and CAMERA special target.
2. For an actual **verified native DeX desktop + valid active external display only**, use ActivityOptions: target DeX display ID and bounded app window request leaving a narrow HOME panel on the left and the app on the right. Treat launch bounds as **Android/OEM requests**, never claim freeform is guaranteed by this code. Use physical DeX metrics/density, not phone density.
3. When native DeX is absent, keep the existing unbounded Android launch. If the explicit DeX launch fails, fail visibly without silently falling back to a wrong screen.
4. Android package visibility: the existing arbitrary "Tên | com.example.app" picker must be able to query installed launchable apps on Android 11+ using an intent-filter `<queries><intent><action MAIN/><category LAUNCHER/></intent></queries>`. Do **not** request QUERY_ALL_PACKAGES, background-launch bypass, accessibility or a new runtime permission.
5. Add unit bounds tests (1280×720, 1600×900, 1920×1080 and invalid metrics), and Android instrumentation tests on isolated `.vqa` for `ActivityOptions` display/bounds content, real package visibility and camera UI safe no-permission state. Confirm 15 existing V2 screens and 53 tests remain unaffected.
6. Simulated secondary-display acceptance must verify task-display identity and screenshot non-flat before PASS. Actual Samsung DeX placement / UVC video / Gear-R remain separate hardware acceptance.

## No unauthorized changes
No V1 APK/assets read/write during changes; no app signing, Production, OTA, user V2 replacement, preference reset or granting permissions. `main` through PR+CI only.

## Camera entry-point defect discovered during real S10 QA
Actual Android secondary display #31 was created and HOME launched; ADB tapped the lower-right CAMERA button. `dumpsys activity activities` showed `UsbCameraActivity` **on the intended secondary display** and Android `GrantPermissionsActivity` as the resumed overlay; 1920×1080 screenshot was dark (19 sampled colors) because CAMERA permission had not been granted. No UVC frame was captured, and this is **not visual parity**. The shell cannot directly launch unexported camera Activity (correct Android security boundary); navigation through exported HOME is the valid approach.

**Required repair:** All four HOME Camera entry points (nine-slot `@camera`, narrow DeX panel camera, bottom Camera action, settings Camera) must use the existing `UsbCameraActivity.toggleFromShortcut(this, requestedCameraDisplayId())`, not raw `startActivity(Intent(...))` which loses explicit camera frame bounds. `requestedCameraDisplayId()` prefers verified native DeX external display but preserves the actual HOME Activity display ID for authorized Android virtual-secondary QA; no fake native DeX assertion. Native Samsung multiwindow dimensions are still OEM controlled.

## Camera auto-permission modal regression (S10 evidence)
- In a bounded 55-test S10 run with zero CAMERA grant on the isolated QA package, launching Camera Activity from HOME caused an Android `GrantPermissionsActivity` to remain resumed, stalling the instrumentation runner. The temporary Android external display `1920x1080/320` was explicitly restored to `null`, and owner V1/production V2 were not altered. This **is not an UVC test pass**.
- Require fail-visible first-entry behavior: if CAMERA permission already exists, the Camera Activity may autostart genuine USB UVC, as before. If permission is absent, show a visible `Chạm CAM để cấp quyền CAMERA` status, **do not automatically open an OS permission dialog merely by displaying the camera window**. Tapping the actual `CAM` control must still request Android permission; denial must remain visible; never use `pm grant`.
- Add a new isolated S10 real Android UI test ensuring a permission-denied QA Camera Activity opens without auto-starting an external permission UI. No user permission state changed. Physical USB feed still requires separate actual hardware acceptance.
