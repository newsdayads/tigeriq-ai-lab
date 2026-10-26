# UltraCarHCM V1 v1.0.56 TEST (297) — two missing controls

**Scope approved by Owner:** restore 5 saved-layout shortcuts above native Home action row; display six dedicated `☰` grips in Saved Layouts 3×2, drag/reorder with stable session ID and persistence, preserve Camera and existing UI.

## Corrected integration

- New `V44UiBridge.java` seeds first five existing sessions only once; tap launch and long-press reassign persist through SharedPreferences. Makes accessibility labels explicit.
- Source/Smali router fix: non-home `ho0` *lambda* must not clear Saved Layouts state. `ad4` has two composable variants; both call `onEnterSavedScreen`. Pure guarded transformer in `hotfix/patch-v55-smali.mjs`.
- 6 grips are anchored by the native card rectangles where available; legacy fallback uses measured 3×2 viewport. Never drag by touching the whole card.
- Java source compiles on Java 8/Android API34; D8 outputs 22 V44UiBridge Smali classes. Patch only an isolated decoded v55 stage. Update `apktool.yml` to code297/name `TigerIQ_HCM_v1.0.56`, `prof_subtitle` to v56 build297. Preserve all Camera/native manifests/other code.

## Actual PC01 release receipts — 2026-10-26

- Isolated stage: `D:\TigerIQ\Apps\DeXCamPersonal\Staged_v1_0_56_ScreenStateGripQuick_297`; APK `build\UltraCar_v1.0.56_297_signed_TEST.apk`.
- javac PASS, D8 PASS (22 bridge Smali classes), Apktool 2.10.0 PASS, Zipalign 4-byte PASS; AAPT2 `com.tigeriq.dexsplit`, code 297.
- Signed v2/v3 PASS; same original signer certificate SHA256 `71617043eace89e5f220ea9168b0a9592808111b0f17eaa219f5e6eceb569558`. Signed file **35,170,717 bytes**, SHA256 `8789884E28EA241E5413D0421461E2467301843BBCA3EF324307643D020F40DF`.
- Existing PC01 interactive task `TigerIQ_UltraCar_Sync_Drive` reported a current `SYNC_PASS` with matching file/bytes/SHA; Google Drive provider confirmed ID `1EStr8wPbt-OmcmNTIpuHCXVwWLgvjMXu`, same bytes in approved folder `1QTOWvtgrdGIml15J55LttcyKa7rLkdva`.
- Download: https://drive.google.com/file/d/1EStr8wPbt-OmcmNTIpuHCXVwWLgvjMXu/view?usp=drivesdk

**NOT PRODUCT DONE:** No Samsung SM-F916N / physical DeX connected to PC01 ADB during this release. Five live visible icons, six live visible grips, successful drag/persistence and Camera regression **NOT ACCEPTED**; static compilation and signed cloud APK are not functional QA. Production v1.0.17, Camera v43 reference and backups remain untouched. No automatic production update.
