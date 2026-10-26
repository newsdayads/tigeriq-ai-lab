# UltraCarHCM — Published APK → new TEST APK → Google Drive (verified lane)

**Canonical, verified 2026-10-25 06:07 Asia/Ho_Chi_Minh.** Owner Work Order: [#5129](https://github.com/newsdayads/tigeriq-ai-lab/issues/5129#issuecomment-6390694935). Parent [release runbook](WORKFLOW_APK_RELEASE.md). For any new UltraCar APK job, load this file **from GitHub main at the start**; old chats, snapshots, and the draft v44 PR do not supersede this real receipt.

<!-- ULTRACAR_STANDING_OWNER_TEST_RELEASE_20261025 -->
## P0 — OWNER STANDING TEST RELEASE AUTHORIZATION / KHÔNG HỎI LẠI (25/10/2026)

**OWNER DECISION:** Anh Sơn đã cấp `FULL_AUTO_TEST_RELEASE=APPROVED` cho việc tiếp tục sửa, build, ký, kiểm tra và **đưa bản UltraCar TEST mới** lên Google Drive; nhắc lại trong chat: “Vậy làm đi. Rồi fix cứng đường làm sau này ko được hỏi lại nữa.” Áp dụng riêng phiên bản TEST phát sinh từ Work Order #5129 cho đến khi Owner thu hồi/đổi phạm vi. **Không yêu cầu Owner bấm duyệt lần nữa hoặc chọn RDC account** cho các bước TEST đã được cấp quyền. **Không tự nâng thành quyền Production**.

**KHỞI ĐỘNG CHAT MỚI / LÀM LIỀN, KHÔNG LÒNG VÒNG:**
1. Đọc GitHub **main mới nhất**: Loader, file này, release runbook, Issue #5129 newest receipts, Issue #504, `docs/RDC_REMOTE_POOL.md`. Giữ Owner authorization đã xác lập; không hỏi lại yêu cầu, phiên bản, đường dẫn, khóa ký, thông tin đã có. Nếu GitHub source không truy cập được thì `SOURCE_UNAVAILABLE`; không giả source cũ là mới.
2. Kiểm tra PC01 qua RDC preflight; tự chọn **account đang Online/còn quota cao nhất** có quyền theo routing; quyền thao tác và one-writer phải có thật. Kiểm tra **đúng bước đã hoàn thành** (file/hash/task/Drive ID) rồi làm tiếp bước còn thiếu, không rebuild hoặc upload trùng.
3. **Theo nhánh thành công**: baseline signed .43 có SHA xác minh → stage TEST mới **cô lập** → áp dụng vá ART register-safe từ `apps/ultracarhcm-v1-v44/hotfix/fix-zc4-verifier.mjs`, `v11` vẫn là `Lha4` → test Smali/tĩnh + Android verifier thật nếu môi trường có → Apktool → zipalign → apksigner v2/v3 cert hiện hữu → aapt2 versionCode mới/khác 285 → Windows **interactive** Scheduled Task `PC01\wdragons12x` copy bản có tên riêng lên Drive đã ánh xạ → đọc **Google Drive API** xác minh file ID/size/parent; khi đọc bytes được thì kiểm SHA độc lập. Tái dùng các template có biên nhận tại PC01; không chép lại hash/version/tên .44 cho APK mới.
4. Mỗi bước có **receipt thực**, không giả PASS: `SOURCE_READY | ART_STATIC_VERIFIED | BUILD_PASS | SIGN_PASS | LOCAL_STAGED | DRIVE_CLOUD_VERIFIED | DEX_SM-F916N_QA_PASS`. Chỉ khi cloud metadata verified mới cho link TEST mới; chỉ khi app chạy không `VerifyError` và Owner nghiệm thu 5 nút/kéo thẻ trên SM-F916N mới kết luận APP DONE. **Không phát hành bản đang lỗi .44**.
5. Khi một **hành động cụ thể** bị lớp an toàn/quyền host từ chối: **không đổi tài khoản, route, lệnh, mã hóa hoặc công cụ nhằm lách chính hành động đó**. Ghi nguyên văn `DENIED_ACTION | TOOL | PC01_STATE | NEXT_ALLOWED_STEP`, tiếp tục **bước độc lập** được phép (đọc, kiểm thử mã riêng trên GitHub, ghi evidence). Không dùng blocker của một bước để khai báo toàn bộ máy/build/Drive chết; không xin lại Full Auto đã cấp. Nếu mọi đường ghi được phép đều bị chặn, kết luận `CHƯA XONG` + cổng thật, không báo đang chạy nền.
6. Không có bảo đảm host ChatGPT/Gemini native tự tải GitHub hay tự mở quyền. **Chính lần chat mới phải gọi công cụ để nạp nguồn này**. “Fix cứng” có nghĩa nguồn, QA gates, quyết định Owner được lưu vào GitHub main và thực thi khi kết nối cho phép; không phải bypass cơ chế an toàn hoặc âm thầm chạy background.

**LIVE CHECKPOINT 25/10/2026:** PC01 RDC02 ONLINE, v43 signed tồn tại đúng hash, v44 signed (285) có trên Drive nhưng **Owner đã báo `VerifyError`**; stage `SourceFromPublished43_TEST_285` chứa **Smali sửa dở, không được build**; **chưa có APK TEST 286** hoặc link Drive 286; `SM-F916N` không hiện trong ADB PC01. Bản vá `zc4` nguồn đã merge GitHub main PR #5315, 9/9 source regression PASS; chưa chạy Android runtime QA. Các thao tác tạo stage/ghi sửa tương ứng từng bị từ chối: **không né qua đường khác**. Hãy đối chiếu live state trước khi dùng checkpoint này.

<!-- /ULTRACAR_STANDING_OWNER_TEST_RELEASE_20261025 -->

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

<!-- ULTRACAR_FIXED_DRIVE_SYNC_TASK_20261026 -->
## Owner update 2026-10-26 — Fixed Drive sync task (no new scripts)

Owner supplied the established sync route. After a TEST APK is built, signed and verified, **do not create a new `.ps1` file and do not invoke `Register-ScheduledTask`**. Verify that the pre-existing scheduled task is present, is the intended authorized task and targets the verified signed APK; then invoke exactly:

```cmd
schtasks /run /tn "TigerIQ_UltraCar_Sync_Drive"
```

Wait approximately 3 seconds and read the existing receipt at:

```text
C:\Users\wdragons12x\AppData\Local\Temp\tigeriq-drive-sync-result.txt
```

Treat the receipt as evidence only for what it actually says. Independently verify the uploaded file's Drive ID, parent, size, and SHA when possible. **Task presence, current APK selection, execution success, and cloud sync have not yet been verified by this documentation change.** This route never overrides an upstream tool refusal or authorizes bypassing security controls.

<!-- ULTRACAR_V54_SIGN_AND_DRIVE_VERIFIED_20261026 -->
## 2026-10-26 — VERIFIED v1.0.54 TEST SIGNED AND CLOUD RELEASE

**As-of live readback:** PC01 signed artifact `D:\TigerIQ\Apps\DeXCamPersonal\build\UltraCar_v1.0.54_295_signed_TEST.apk`, size **35,170,717**, SHA256 **F0E2A418E047386DC1E03B590AD4FBA05CCA918E9C0D9CD0D3C14DA9A9B8B314**. `apksigner verify` reports v2=true and v3=true, cert SHA256 **71617043eace89e5f220ea9168b0a9592808111b0f17eaa219f5e6eceb569558**. `aapt2 dump badging`: `com.tigeriq.dexsplit`, versionCode **295**, versionName `TigerIQ_HCM_v1.0.54`. PC01 existing sync receipt: `SYNC_PASS|FILE=UltraCar_v1.0.54_TEST.apk|SHA256=F0E2A418E047386DC1E03B590AD4FBA05CCA918E9C0D9CD0D3C14DA9A9B8B314|BYTES=35170717|UTC=2026-10-26T00:51:44.0598295Z`.

**Independent Google Drive cloud API confirmed:** file ID `1lvmkp3Y57liY0XkbqZr_7M55TtGhf0JB`, name `UltraCar_v1.0.54_TEST.apk`, size **35,170,717**, parent folder `1QTOWvtgrdGIml15J55LttcyKa7rLkdva`, [published v54 TEST](https://drive.google.com/file/d/1lvmkp3Y57liY0XkbqZr_7M55TtGhf0JB/view?usp=drivesdk). Independent **cloud byte-by-byte SHA not yet established**; matched local hash and PC01 sync receipt. Release/Drive stage **DONE**; real SM-F916N DeX UI behavior/owner approval **NOT DONE**.

**Antigravity existing helper found (read-only):** `D:\TigerIQ\Tools\sign_latest.cmd` invokes existing `sign_latest.ps1`, which chooses newest `*_aligned_TEST.apk`, signs via original `debug.keystore`, checks signer/badging and directly calls existing Drive sync. **Do not create extra signer scripts or scheduled tasks.** This current implementation **deletes a same-named existing signed candidate before recreating it**, so do **not** run it against an already published version, and it contains a hardcoded keystore credential in its PS1 source (requiring local credential hygiene). Always verify intended candidate identity, absence of existing signed output, authorized interactive Drive context, and exact task scope. **Never use the wrapper to work around an action already explicitly denied by upstream platform security.** Subsequent releases may reuse it only if independently permitted; require local signature/hash and Drive provider readback each release.

**Exact continuation point:** v54 (295) signed/published, **do not rebuild/re-sign/reupload v54**; inspect owner Samsung DeX acceptance of quick-slot and saved-card grip and red version label; if defects remain, implement next isolated TEST stage with code >295 and QA. Previous failed/rejected signing instructions were stale checkpoints superseded by independently verified existing signed .54 in this readback.
