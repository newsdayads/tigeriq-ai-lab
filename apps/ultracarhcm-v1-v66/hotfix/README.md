# UltraCarHCM V1 — v66 native-card grip/reorder fix candidate (TEST only)

**Observed live baseline 2026-10-27:** PC01 has signed UltraCar v1.0.65 code306 (SHA256 `FA7FB76F9E9FF034E66FC134DEEE65690E2C9BCBB8D37C9E15C08BE8F1F7132B`). Source stage `Staged_v1_0_65_CockpitFullFix_306` is PRIVATE on PC01. Production unchanged.

## Confirmed root-cause mechanisms in v65 APK Smali
- `zc4.smali` **does** instantiate `CardPositioned(sessionId)` and pass it through `androidx.compose.ui.layout.a.d` (native onGloballyPositioned); `CardPositioned.smali` calls `V44UiBridge.onCardPosition`. Do not claim the native hook is absent.
- `V44UiBridge.repairMissingGrips()` silently guesses all six rectangles from 2.5%, 1.4%, 15.5%, 49.5%, 30.5% of the **overlay window**, not the actual DeX card frame. Guessed bounds are cached alongside real positions.
- `V44UiBridge.onGrip()` builds an ImageView ghost by cropping a screenshot of the full root and uses those potentially wrong bounds for grab offsets and target detection. `dragRevision` is assigned but not verified. `exactTarget` walks cached rectangles, which may be stale after `Manager.shift`.
- Actual `com.tigeriq.layout.Manager.shift(String,int)` exists and invokes `saveOrder()` and `redraw()`. The primary failure is the grip/coordinate/drag path, not missing persistent-order support.

## Candidate source patch
`patch-native-grips.mjs` is a **source-only** fail-closed transformer for the known `V44UiBridge.java` shape: remove arbitrary grid estimation, use native card measurements only, freeze a per-gesture ID/Rect snapshot, refuse ambiguous drops, replace screenshot ghost with deterministic placeholder, invalidate old bounds after shifting order. No PC01 writes or APK signing are performed by this file. Do not use `v57` source itself as a replacement for live v65: it is older and may regress existing fixes.

## Exact next gates
1. Authorized developer verifies source hash and patch preconditions on the **current live v65 Java bridge**, in a **new isolated v66 TEST stage**, preserving v65/Production.
2. Build Java with Android API34, D8, patch classes into Smali, Apktool compile; verify CardPositioned/native callsites, target Compose layout, binary Camera/USB invariants and Android ART startup. Runtime validation on available test device is not Z Fold2 acceptance.
3. Only via separately permitted signing/sync mechanism: versionCode307 / `TigerIQ_HCM_v1.0.66`, pinned signer, no overwrite, cloud hash/metadata verified.
4. Owner SM-F916N parked DeX QA: six visible dedicated grips attached to native cards (3x2), drag each ID to each distinct position with stable ghost, no unintended launch/swap, order persisted after restart, Camera unaffected. **No QA PASS without this test.**

**Status:** SOURCE_CANDIDATE — NOT BUILT, NOT SIGNED, NOT PUBLISHED, DEVICE_QA_PENDING. Previous host refusals for edits to the existing signing/Drive scripts remain binding; do not reroute around denials.
