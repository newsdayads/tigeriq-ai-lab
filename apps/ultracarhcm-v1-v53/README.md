# UltraCarHCM v1.0.53 / versionCode 294 — TEST-only source fix

**Status:** Code prepared and compiled in GitHub Actions against Android API 34; NOT an installable APK, NOT applied to PC01 stage, NOT verified on owner's DeX. No override of the earlier platform refusals for Smali writes or APK signing.

**Authoritative source:** live PC01 version `Staged_v1_0_52_ProductionCandidate_293`, `build/UltraCar_v1.0.52_293_signed_TEST.apk`. `V44UiBridge.java` copied from PC01 and revised in `src/com/tigeriq/v44/V44UiBridge.java`.

**Changes:**
- Home 5 equal slots: icons plus their saved-layout names; empty slots show +01 ... +05, tap to open by session ID, hold to reassign and persist.
- Fail closed without a real `__START_BUTTON__` and separate `__BOTTOM_BAR__` geometry; do not draw an arbitrary fixed-size bar covering the Samsung DeX dock. Java UI remains an overlay attached to the activity, however, so genuine native Compose layout embedding still requires further UI integration and device proof.
- Saved Layouts: only the named grip starts a drag; render a true card ghost with content/overlay offsets, follow the exact pointer grab offset, drop on the measured target by immutable session ID, persist via Manager.shift.
- Pure transformation in `hotfix/patch-v52-smali.mjs`: remove erroneous `__BOTTOM_BAR__` marker from the Start button's same Compose modifier and preserve the sole marker on the actual bottom row. For saved-layout screen, dispatch touches to grip child instead of invoking both legacy Addons and legacy DragGhost handlers. **Requires actual isolated TEST stage and runtime verification.**

**Integration for an authorized local executor (not run by this PR):**
1. Confirm target v52 source/hash, lock one writer and preserve all v52/v43/production files.
2. Create a NEW isolated v53 code294 TEST stage via a permitted action, never modifying v52, production, signer, or user preferences.
3. Compile the complete Java source here against Android API 34, `--release 8`; D8 and only the `com/tigeriq/v44/V44UiBridge*.smali` output replaces matching code in NEW stage.
4. Run the exported pure `patchV52Smali(uu2Text, mainActivityText)` **only on new isolated TEST source**, verify exact marker counts/expected original hashes. Do not apply to original v52. Preserve `android:extractNativeLibs`, APK compression rules and all unknown original resources.
5. Set versionCode294/name1.0.53; Apktool build, zipalign, signer must match original SHA-256 cert `71617043eace89e5f220ea9168b0a9592808111b0f17eaa219f5e6eceb569558`, verify v2/v3 and Android package before any upload.
6. Publish only after successful signed candidate through authorized PC01 interactive user Drive mapping, confirm actual cloud file ID and metadata, then Z Fold2 SM-F916N testing with app in parked vehicle. Test all six cards/5 slots, name+icon, no overlap, restart persistence, Camera unchanged; if any fail, do not mark DONE.
7. Do not use alternate accounts, wrappers, or syntax changes to evade an upstream-denied action.

**Regression QA:** `node --test tests/ultracar-v53-ui.test.mjs` (see CI workflow). Note the tests do not substitute for signed APK or real ART/DeX.

**Latest known release:** v1.0.52 TEST code293 on Drive. **No v53 signed release is claimed here.**
