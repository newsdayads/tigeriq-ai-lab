# UltraCarHCM V2 — Baseline Parity Contract, P0
Revision: 2026-10-22 / owner order in this chat. This is a **verified static inventory plus photographed UI reference**, NOT a declaration of completed feature parity.

## Authority and frozen reference
- Ground-truth APK: PC01 `D:\TigerIQ\Apps\DeXCamPersonal\build\UltraCar_TigerIQ_HCM_v1.0.17_258_signed.apk` (size **35,084,701 bytes**, SHA-256 **E912E8B14503F55405A2F5A0F304DBE0B64E9F7BE5EBBC0C8C4D9ED147C87F33**). Package `com.tigeriq.dexsplit`. GitHub production manifest remains v1.0.17 / code258.
- Decoded resources/source: `D:\TigerIQ\Apps\DeXCamPersonal\Staged_v1_0_17_Reliability_258`. Counted **10,869** `.smali` files, **789** recursive resource files, **1,493** string resources.
- JADX 1.5.6 read-only decompilation: `D:\TigerIQ\Apps\UltraCarHCM_V2\reference_decompiled_v117\sources`, **9,171 Java files** produced, **166 decompilation errors**. NOT a compilable/complete restored source tree.
- Owner photographs (2026-10-22, current conversation), authoritative UI observations: actual Home is UltraCar illustrated cockpit/road dashboard with car selector/vehicle card on edge, shortcut dock; USB Camera appears as a separate overlay/window over cockpit; on another state the camera shows live-looking **noisy green video** and parking guide markers 1.5m/1.0m/0.5m. The photo alone does NOT prove video decoding correctness.
- Previous mistakenly released `UltraCarHCM V2 Preview 1`, 618,980 bytes, independent `ai.tigeriq.ultracarhcm.v2` was **owner REJECTED**: used Java/XML DeXCam Personal mock dashboard. DO NOT USE as V2 parity baseline or present as replacement; test installed on SM-G977N, not owner's Fold/DeX.

## Functional parity matrix — initial sourced coverage
Labels = evidence origin: `PHOTO` visible in owner screen / `RES` original string resource keys / `CLASS` decoded manifest/Smali or Java class / `NATIVE` binary library. "STATIC EVIDENCE" only means the original APK contains the cited features, **not that V2 implements them**.

| ID | Scope / expected V2 parity | Source evidence | V2 implementation status |
|---|---|---|---|
| F01 | UltraCar cockpit/home illustrated dashboard, same proportions, backgrounds, sidebar and shortcuts in DeX | PHOTO; RES `home_*`, `road_bg_*`; images `road_city_*.jpg`, `road_hcm_*.webp` | NOT IMPLEMENTED |
| F02 | Branded vehicle card, model/color selection, parked/moving images and license plate | PHOTO; RES `car_*`, `car_limo_do_*.webp`, `logo_ultracar.png` | NOT IMPLEMENTED |
| F03 | Real USB-Host UVC camera streaming, image controls and USB permission lifecycle | NATIVE `libusb1.0.so`, `libuvc.so`, `libUVCCamera.so`; CLASS `com.herohan.uvcapp.CameraHelper`, `CameraConnectionService`; RES `cam_*` | NOT IMPLEMENTED (Preview1 only Camera2 external, not equivalent) |
| F04 | Separate camera window, manually open/close; preserve real camera video | PHOTO; CLASS `MainActivity`, `TigerIQBridge`; RES `camw_*`, `home_camera`, `dialog_camera.xml` | NOT IMPLEMENTED |
| F05 | Reverse signal, guideline overlay positions 0.5m / 1.0m / 1.5m, activation modes | PHOTO; CLASS `ReverseGearReceiver`, `ParkingGuidelinesOverlayView`, `ReverseGuidelineOverlay`; RES `cam_mode_*` | NOT IMPLEMENTED |
| F06 | Exactly ONE draggable DeX Camera floating shortcut; no black square/3 red buttons; identical action to in-app Camera | OWNER requirement; CLASS `FloatingCameraService` and `TigerIQBridge`; RES `ic_floating_camera_btn.png` | NOT ACCEPTED |
| F07 | DeX auto-launch, multiple displays, freeform app windows, zone overlays and layout persistence | CLASS `DexDockReceiver`, `ZoneOverlayService`, `CascadePrimerActivity`; RES `zone_*`, `vm_*`, `panel_*` | NOT IMPLEMENTED |
| F08 | Multi-zone/slot dashboard management incl. saved layouts, default layout, restart/relaunch | RES `home_saved_layouts`, `home_new_layout`, `vm_preset_*`, `vm_saved_as_default`, `panel_*` | NOT IMPLEMENTED |
| F09 | Home backgrounds: road/city/theme/day/night/video/custom images | RES `road_bg_*`, `home_bg_image`, `home_bg_video`, bitmap files in `res/drawable` | NOT IMPLEMENTED |
| F10 | Shortcut bar/map applications and bottom area actions/image/music | PHOTO; RES `bottom_zone_*`, `zone_music_*` | NOT IMPLEMENTED |
| F11 | GPS, battery/weather/telemetry, diagnostics in zone | RES `zone_gps_*`, `zone_batt_*`, `zone_no_obd_data` | NOT IMPLEMENTED |
| F12 | OBD/Bluetooth pairing, speed/rpm/battery and diagnostics | RES `obd_*`; Manifest BT/location permissions | NOT IMPLEMENTED |
| F13 | Taxi meter, trip distance/time/rates, history and revenue | RES `taxi_*` (46 keys) | NOT IMPLEMENTED |
| F14 | Profile, identity/license, display/greeting, registration/extension | RES `prof_*` (58), `auth_*` (45), `gate_*` | NOT IMPLEMENTED |
| F15 | User/notification tabs, update check independent of notifications | RES `notif_*`, `adm_tab_notifications`, `update_*`; Issue #5129 | NOT IMPLEMENTED |
| F16 | Backup/export/import/restore ALL user settings, images, layout, shortcuts, sound and vehicle (protect security-bound keys) | RES `bk_*` (53) incl. category manifests; photos NOT proof | NOT IMPLEMENTED |
| F17 | Language/theme/appearance/color palettes | RES `appearance_*` | NOT IMPLEMENTED |
| F18 | Administrative/licensing/customer activation and device registration where legitimately available | RES `adm_*` (260), `dash_*` (118), `auth_*` | NOT IMPLEMENTED |
| F19 | Data export/reporting sheets where existing feature supports it | RES `xls_*` (52), `dash_export_*` | NOT IMPLEMENTED |
| F20 | User permissions, camera/USB/geolocation, overlay, update APK package, privacy and error/recovery | Manifest permissions; RES `permission_*`, `camw_*`; Issue #5129 | NOT IMPLEMENTED |
| F21 | Responsive portrait/phone/landscape/DeX two/three-column profile cards without clipping | PHOTO; Issue #5129 requirement; DeX screen ratio | NOT ACCEPTED |
| F22 | Native crash/restart, offline/backups, migration, install coexistence, signing and rollback | Manifest component map; Issue #5135 | NOT ACCEPTED |

## Original Android architecture / actual binary evidence
- Manifest app components: `com.ultracar.dexsplit.ui.MainActivity`, `CascadePrimerActivity`, `ZoneOverlayService`, `FloatingCameraService`, `ReverseGearReceiver`, `BootReceiver`, `DexDockReceiver`; plus Firebase/Google sign-in/captcha services.
- Original supports native `arm64-v8a` and `armeabi-v7a` libraries. Need check native library provenance/build/license, ABI compatibility before distributing new native code.
- Because decompilation has **166 errors**, recovered code cannot be claimed identical/recompilable or legally redistributable by default. A high-confidence 1:1 rebuild demands original source/dependencies or validated reimplementation of *each* path.
- Explicit security review before parity release: exported reverse receiver input validation, sensitive permissions, production signing, token/license/billing handling. Preserve security boundaries rather than blindly copying every behavior.

## Acceptance gates — fail closed
- [ ] M0.1 Create exhaustive screen-by-screen reference inventory from the original app (not only 3 owner photos) with screenshot/video/DPI for **all** tabs, dialogs and states.
- [ ] M0.2 Produce actionable map of each original navigation/action → data/permissions → expected result; cross-check 1,493 strings and obfuscated Compose callbacks; identify unsupported/unowned SDKs.
- [ ] M0.3 Baseline real Samsung Z Fold + actual DeX monitor + USB camera logs/screenshots; log reproduction of original controls including reverse signal.
- [ ] M1 Create clean-clone reproducible Kotlin/Gradle source using approved original images and feature architecture; no mock DeXCam UI.
- [ ] M2 All F01–F22 features migrated or explicitly documented as non-transferable, with user approval for changes; verify automated tests and binary ABI support.
- [ ] M3 Screenshot comparison per UI size and end-to-end UVC/DeX/overlay/USB hardware tests; no regression for existing working behavior.
- [ ] M4 Signed, independently installable test APK with full release manifest / SHA256 / rollback and **owner acceptance**, then production cutover. No release from a static build PASS alone.

## Decision
**Do not ship another V2 APK until a real cockpit parity gate and real USB-host Camera pipeline exist.** Retain production v1.0.17. Real V2 production parity **CHƯA XONG**. The rejected Preview1 is not progress against F01–F22. GitHub Issue #5135 is the single parent work order; Issue #5129 carries legacy camera regression evidence.
