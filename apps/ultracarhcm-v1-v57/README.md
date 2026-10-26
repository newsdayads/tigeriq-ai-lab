# UltraCarHCM V1 — v1.0.57 TEST source candidate

**Owner visual requirement (26/10/2026):** 5 quick-layout icons visually centered in UltraCar Home between **KHỞI ĐỘNG** and the existing 3 buttons **Bố cục đã lưu / Bố cục mới / Camera**. Equal left/right margins. No opaque/dark group strip. No spillover into the adjacent DeX video window. Keep tap-to-open, hold-to-reassign; preserve Camera and saved data.

## Implementation
- `V44UiBridge.java`: anchor horizontal bounds to **actual Compose bottom action row** (`bottomBarRect`, via existing `CardPositioned("__BOTTOM_BAR__")`), use safe 37% viewport cap for split-screen if bounds unavailable/invalid; calculate vertical midpoint between measured `startBtnRect.bottom` and `bottomBarRect.top` when available. Equal side margin based on action-bar width.
- Remove opaque bar and dark cell fills; retain accessible labels and five weighted interactive cells, persistent session IDs.
- **Technical limitation:** This is *visually bounded overlay*, not genuine Compose subtree reparenting. Owner's newer photographic instruction prioritizes placement and transparent appearance, but live DeX acceptance remains mandatory. Do not claim fully native/merged layout.
- Six saved-layout drag grips unchanged from v56 and not newly accepted.

## Execution evidence
- PC01 RDC03 online, isolated `D:\TigerIQ\Apps\DeXCamPersonal\Staged_v1_0_57_CockpitAlignedQuickbar_298` plus `patch_v57` created without touching v56/Production. Revised V44UiBridge.java written successfully (793 lines); source readback verified. A `V44UiBridge.class` output exists in `patch_v57\classes_v57`; process returned timeout, so no reliable javac process exit code was observed.
- **BLOCKED:** exact operation updating isolated stage `apktool.yml` from code297 to 298 and original Profile string was rejected by platform safety. It was not retried under another account, tool or wrapper. Stage still reads `versionCode 297`/`v1.0.56`, so NO new safe versioned v57 APK was built, signed or published. Google Drive latest approved TEST remains v56.
- **State:** SOURCE_PATCHED_PC01 | GITHUB_REVIEW_PENDING | V57_VERSION_UPDATE_DENIED | V57_APK_NOT_BUILT | SM-F916N_REAL_DEVICE_QA_NOT_DONE. Production remains v1.0.17 and Camera v43 reference unchanged.
