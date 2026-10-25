# UltraCarHCM — Published APK → new TEST APK → Google Drive (verified lane)

**Canonical, verified 2026-10-25 06:07 Asia/Ho_Chi_Minh.** Owner Work Order: [#5129](https://github.com/newsdayads/tigeriq-ai-lab/issues/5129#issuecomment-6390694935). Parent [release runbook](WORKFLOW_APK_RELEASE.md). For any new UltraCar APK job, load this file **from GitHub main at the start**; old chats, snapshots, and the draft v44 PR do not supersede this real receipt.

## P0 UPDATE — 2026-10-25 07:24 OWNER DEVICE CRASH — SUPERSEDES v44 APP ACCEPTANCE

- **Confirmed:** SM-F916N Android 13 reported `java.lang.VerifyError` in `zc4.b`. The v44 TEST file listed below was signed/published but **CRASHES / NOT ACCEPTED ON DEVICE**. Do not recommend reinstalling it; revert to signed .43 while unverified.
- RCA: the v44 Compose callback injection overwrites `v11` formerly holding `Lha4;` with `String`, provoking Android ART verifier rejection. An earlier syntax-only Smali repair, successful Apktool build, signing and Drive sync **did not prove app runtime safety**.
- PC01 `SourceFromPublished43_TEST_285/smali/zc4.smali` is now in an **incomplete partially edited state**. Do not build from that stage without a fresh safe source and validation. Further PC01 source edit and new decoded stage requests were explicitly declined by the platform; do not retry the equivalent denied action with a different account/tool.
- Source-only fix and nine regression tests: `apps/ultracarhcm-v1-v44/hotfix/` (from approved GitHub branch). Detailed evidence: [#5129 07:24 report](https://github.com/newsdayads/tigeriq-ai-lab/issues/5129#issuecomment-6391429013). The repair must keep `v11` as `Lha4;` and use `v12` and `v13` for session ID and callback; only actual ART/SM-F916N launch acceptance clears the runtime blocker.
- Next signed TEST APK/version and Google Drive upload **not yet done**; no production change. Don't call the next release DONE until real new APK, correct signature, Drive readback and crash-free device check.

## 0. Do not confuse build/shipping with DeX product acceptance

- **Build, signing and TEST Drive publication succeeded for v1.0.44 (285).** Real Samsung Z Fold 2/DeX functional acceptance remains **PENDING**; `V44UiBridge`/5 shortcuts/reorder cannot be called QA PASS until observed working on target phone.
- The official Production is v1.0.17 (258), unchanged. Signed published v1.0.43 (284) is preserved as the **known-good source artifact**. Do not use the previously failed `prepare_v44.ps1` / cloned v44 stage as the entry point, or resume its obsolete "blocker" narrative.
- Owner authorized isolated TEST delivery. Do not silently ship Production, overwrite existing APKs or delete stage/backups, bypass security denials, leak signing material, or imply GitHub policy grants runtime host permissions.

## 1. Known-good baseline and PC01 toolchain

| Item | Verified value |
|---|---|
| RDC machine | `PC01`; check `docs/RDC_REMOTE_POOL.md` and current connector `who_am_i` / `list_devices` for usable live link/device ID; never hardcode a historical connector session |
| Workspace | `D:\TigerIQ\Apps\DeXCamPersonal` |
| Starting signed APK | `build\UltraCar_v1.0.43_284_signed_TEST.apk` |
| Baseline SHA-256 | `D34271ED42A6C89309A75C5CEC65E57BD3A613B9EC5B9A91A4A3E059E0EFA033` |
| Package | `com.tigeriq.dexsplit` |
| Signing certificate SHA-256 | `71617043eace89e5f220ea9168b0a9592808111b0f17eaa219f5e6eceb569558` |
| Apktool | `D:\TigerIQ\Tools\apktool.jar` (2.10.0 in verified build) |
| Build tools | `D:\TigerIQ\Tools\AndroidBuildTools35\unpacked\android-15` (`zipalign.exe`, `apksigner.bat`, `aapt2.exe`) |
| Existing known-good signing template | `sign_v43_curve_sensitivity_test.ps1` |
| Existing Drive task template | `stage_v43_curve_drive.ps1` |

**Preflight:** Hash baseline, check source/target paths, inspect existing task, signed candidate, Drive file and backups before mutating. Pick next versionCode/filename **based on actual latest state and approval**; never blindly reuse 285 or overwrite. Source policy is read from live GitHub main + Issue #5129; platform permission denials remain binding to the denied action.

## 2. Proven source path — decode the PUBLISHED signed APK directly

For v44 (build 285) the *successful* isolated stage was:
`D:\TigerIQ\Apps\DeXCamPersonal\SourceFromPublished43_TEST_285`.

Exact verified command structure (use new isolated destination for each later candidate):

```powershell
$ErrorActionPreference = 'Stop'
$r = 'D:\TigerIQ\Apps\DeXCamPersonal'
$source = Join-Path $r 'build\UltraCar_v1.0.43_284_signed_TEST.apk'
$expected = 'D34271ED42A6C89309A75C5CEC65E57BD3A613B9EC5B9A91A4A3E059E0EFA033'
if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne $expected) { throw 'BASELINE_HASH_MISMATCH' }
$stage = Join-Path $r 'SourceFromPublished43_TEST_285' # example from succeeded v44, use a NEW name next time
if (Test-Path $stage) { throw 'STAGE_ALREADY_EXISTS_DO_NOT_OVERWRITE' }
& java -jar 'D:\TigerIQ\Tools\apktool.jar' d $source -o $stage
if ($LASTEXITCODE -ne 0) { throw 'DECODE_FAILED' }
```

Observed PID **29536**, exit 0, `DECODED_PUBLISHED_V43_UNMODIFIED`. This entry does **not** require the earlier denied clone script. An actual independent security rejection on any new operation must still be respected; do not disguise/retry an equivalent denied operation.

## 3. Scoped code patch and proven Smali repair

- Copy/modify only the required files in isolated decoded stage. For Java UI additions: Android SDK API 34 `javac --release 8` → `jar` → D8 → minimal APK → Apktool decode to Smali → copy selected classes. For v44 the generated `V44UiBridge`, ID-grip `CardPositioned`, Compose `zc4.smali` and `MainActivity.smali` hook were staged under `patch_from_published43_285\`. Evidence: Java PID **47152**; Smali PID **23856**; patch PID **45180** produced **16** new Smali classes.
- **RCA of the old build failure:** In high-register Compose method `zc4.smali`, directly inserting `iget-object v11, p0, Lzc4;->b:Lta1;` is invalid because this short Smali instruction cannot encode the original high-numbered `p0` in the method's register layout.
- **Verified fix (once, in the isolated stage):**

```smali
move-object/from16 v11, p0
iget-object v11, v11, Lzc4;->b:Lta1;
invoke-virtual {v11}, Lta1;->getId()Ljava/lang/String;
```

- Do not blindly reapply this fix if already present. Check exact code/location and .registers/.locals before patching. Preserve old Camera v43, USB, the 3-column layout, remaining app logic and their checksums. Existing v44 result is **a QA candidate**, not proof gestures/shortcuts work.

## 4. Build, sign and verify (actual successful files and checks)

After patch and versionCode/versionName in `apktool.yml`:

```powershell
$r='D:\TigerIQ\Apps\DeXCamPersonal'
$stage=Join-Path $r 'SourceFromPublished43_TEST_285'
$unsigned=Join-Path $r 'build\UltraCar_v1.0.44_285_unsigned_TEST.apk'
if (Test-Path $unsigned) { throw 'OUTPUT_EXISTS_NO_OVERWRITE' }
& java -jar 'D:\TigerIQ\Tools\apktool.jar' b $stage -o $unsigned
if ($LASTEXITCODE -ne 0) { throw 'APK_BUILD_FAILED' }
```

- Actual **Apktool PID 45772**, exit **0**. Unsigned v44 size **34,927,748 bytes**.
- The successful *isolation-specific* signing script is **`patch_from_published43_285\sign_v44_from_published43_test.ps1`**, derived from the working `sign_v43_curve_sensitivity_test.ps1`. Use its verified `zipalign -p -f 4` / `zipalign -c -v 4` → `apksigner sign` v2/v3 → `apksigner verify --verbose --print-certs` → `aapt2 dump badging` pattern with the *existing PC01 key*; never copy keystore secrets into GitHub or chat. Use version-specific **new** filename, code and validation each future release.
- Actual **sign PID 28040**, exit **0**; file `build\UltraCar_v1.0.44_285_signed_TEST.apk`, package `com.tigeriq.dexsplit`, code 285, name `TigerIQ_HCM_v1.0.44`, certificate exactly as above, signature v2/v3 TRUE; size **35,154,333 bytes**; SHA-256 **`5A95F3B97715D9ACEDC075442FC37DCF95760BA9E54DF537674D12C030D368C2`**.

## 5. Publish TEST to mapped Google Drive through the INTERACTIVE Windows session

- **Not SYSTEM:** The RDC shell/service can write `D:`, but the user's mapped `G:` belongs to Windows session `PC01\wdragons12x`. Reuse a narrowly scoped, one-shot Scheduled Task with `Principal.UserId = wdragons12x`, `LogonType = Interactive`, `RunLevel = Limited`; verify task/user before execution. Never change drive or sign-in settings to make a shell impersonate the interactive user.
- For v44, verified task `TigerIQ UltraCar v44 FromPublished43 TEST Drive Stage` ran `patch_from_published43_285\stage_v44_from43_drive.ps1`. It verifies new signed **source SHA**, locates exactly one `TigerIQ UltraCar` folder under the authenticated `G:` drive, copies only `UltraCar_v1.0.44_TEST.apk`, refuses overwrite of a different file, hashes target, writes user-temp receipt.
- Task actually ran with **LastTaskResult=0**; receipt `C:\Users\wdragons12x\AppData\Local\Temp\tigeriq-v44-from43-drive-result.txt` reported `STAGED_VERIFIED_LOCAL` SHA-256 = above, bytes = 35154333. **This alone establishes local mapped-Drive staging, not yet cloud publication.**
- **Cloud acceptance:** Google Drive connector `list_folder` on folder **`1QTOWvtgrdGIml15J55LttcyKa7rLkdva`** and `get_file_metadata` confirmed exact uploaded file name, size and parent:
  - v44 cloud ID `1ARS27BKagjhD90EvxsU0QEgjelTlombW`;
  - [real TEST APK on Drive](https://drive.google.com/file/d/1ARS27BKagjhD90EvxsU0QEgjelTlombW/view?usp=drivesdk).
- For each *future* candidate, discover exact new file ID and verify size, name, folder, timestamp; never invent/reuse v44 URL for a new release. If cloud bytes can be downloaded, independently SHA-256 rehash; otherwise report **DRIVE_METADATA_VERIFIED** (not **CLOUD_BYTES_SHA_VERIFIED**).

## 6. New-chat start / acceptance contract

When anh Sơn says *“tiếp tục UltraCar / sửa app / xuất APK / đưa Drive”* in a new chat:

1. Fetch **GitHub main** `bootstrap/00_TIGERIQ_LOADER.md`, this playbook, `docs/apps/ultracar/WORKFLOW_APK_RELEASE.md`, current Issue [#5129](https://github.com/newsdayads/tigeriq-ai-lab/issues/5129) newest comments, Issue [#504](https://github.com/newsdayads/tigeriq-ai-lab/issues/504), and `docs/RDC_REMOTE_POOL.md`. GitHub source changes do not automatically make a native ChatGPT conversation load them; **fetch is required**.
2. Read current PC01 via a live selected RDC account. Inspect baseline SHA, known-good scripts, stage, candidate filename, existing signed artifacts, one active writer, the already-verified steps. **Resume from the last evidenced step; never redo completed steps unnecessarily.**
3. For an unaccepted iteration, continue in a **new isolated stage** from the known-good published v43 signed APK (unless Owner explicitly approves a later tested baseline), patch → assemble → sign → stage interactive Drive → cloud metadata readback.
4. Update **the same Issue #5129** with source path/sha, actual PID/exits, tool outputs, current signed APK hash/bytes/cert/version, scheduled-task result and receipt, Drive file ID/link and what is unverified. Don't open duplicate issue, treat PR #5309 draft as a release artifact, or write production.
5. Report **XONG** only for the specifically completed **build+sign+Drive TEST publication** after actual readback. If asked whether UI/DeX fully works or app is DONE, report **CHƯA XONG** until target device user-flow acceptance; never turn a signed APK into a fabricated UI QA PASS.

**Regression source:** Issue #5129 comment [#6390694935](https://github.com/newsdayads/tigeriq-ai-lab/issues/5129#issuecomment-6390694935). Re-check the live state rather than trusting this 2026-10-25 snapshot if newer verified evidence appears.
