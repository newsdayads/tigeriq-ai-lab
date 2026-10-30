# UltraCarHCM — APK build, release TEST, QA, backup (Owner-locked)

## 2026-10-30 — QUY TRÌNH KÝ TEST HIỆN HÀNH (ghi đè ví dụ cũ)

- PC01 đã sửa **hai script hiện có**, không tạo runner/task thứ hai: `D:\TigerIQ\Tools\sign_latest.ps1` và `sync_latest_ultracar_to_drive.ps1`. `sign_latest.cmd` vẫn là entrypoint cũ. Thay vì tự chọn APK mới nhất hoặc khóa V65, cả hai đọc `D:\TigerIQ\Tools\ultracar_test_release.json` với tên input, SHA-256 đã căn chỉnh, package, versionCode/versionName, tên signed và tên Drive chính xác.
- Runner phải **fail closed** khi manifest không hợp lệ, sai SHA-256/phiên bản, sai chữ ký v2/v3/chứng chỉ, thiếu biên nhận ký; từ chối ghi đè signed APK hoặc tệp Drive đã tồn tại. Task `TigerIQ_UltraCar_Sync_Drive` và identity tương tác giữ nguyên. Khi sang phiên bản kế tiếp, cập nhật **manifest** đã xác minh, không sửa tên phiên bản trong script.
- Kiểm thử PowerShell Parser 0 lỗi trên 2 script; SHA của manifest V68 khớp aligned APK; bản gốc được backup ngay tại PC01. **Đã chuẩn hóa và kiểm thử tĩnh, CHƯA thử chạy ký/đồng bộ**. V68 code309 aligned SHA256 `A92956A16133B234024C0C85680204CB35CD090B942332A235C01216E4F185E5`; **SIGN_BLOCKED bởi cổng host của lần ký trước, Drive chưa xuất V68**. Không gọi script để né hành động ký đã bị từ chối; chỉ ký khi hệ thống cho phép thực sự.
- Không truyền mật khẩu qua lệnh `apksigner` trực tiếp từ ChatGPT, không mở quyền Admin mặc định, không ghi đè Production/V65–V67. Hiện tại **V67 là bản TEST trên Drive, V68 chưa phát hành**. Việc build/ký/phát hành không thay thế nghiệm thu thực tế Z Fold 2.

> Canonical task tracking: [Issue #5129](https://github.com/newsdayads/tigeriq-ai-lab/issues/5129). Owner interface/policy: [Issue #504](https://github.com/newsdayads/tigeriq-ai-lab/issues/504). This file is an operational runbook, **not** an automatic task scheduler, elevated permission or release approval. Last verified: 2026-10-25 (Asia/Ho_Chi_Minh).

<!-- ULTRACARHCM_PUBLISHED_APK_RELEASE_SUCCESS_20261025 -->
## ƯU TIÊN CAO NHẤT — ĐÃ XUẤT THÀNH CÔNG v44 (285) TỪ APK .43 ĐÃ PHÁT HÀNH — 25/10/2026

**Quy trình đã nghiệm thu build/ký/Drive (không còn là kế hoạch):** [PUBLISHED_APK_TO_DRIVE_PLAYBOOK.md](PUBLISHED_APK_TO_DRIVE_PLAYBOOK.md), [Issue #5129 biên nhận](https://github.com/newsdayads/tigeriq-ai-lab/issues/5129#issuecomment-6390694935).

- **Bắt đầu bản mới bằng cách giải mã trực tiếp APK signed .43 đã phát hành**, SHA256 `D34271ED42A6C89309A75C5CEC65E57BD3A613B9EC5B9A91A4A3E059E0EFA033`, vào source TEST mới. **KHÔNG khởi động lại lệnh clone stage v44 cũ `prepare_v44.ps1`.**
- Lỗi `Could not smali file: zc4.smali` **ĐÃ FIX**: thay `iget-object v11,p0,...` bằng `move-object/from16 v11,p0` rồi `iget-object v11,v11,...`. Build PID 45772 exit 0; ký PID 28040 exit 0; APK code 285, v2/v3, cert khớp; SHA256 `5A95F3B97715D9ACEDC075442FC37DCF95760BA9E54DF537674D12C030D368C2`.
- Tác vụ Drive phiên `wdragons12x` exit 0; Google Drive API xác minh file **`UltraCar_v1.0.44_TEST.apk`** trong folder chuẩn: [bản TEST trên Drive](https://drive.google.com/file/d/1ARS27BKagjhD90EvxsU0QEgjelTlombW/view?usp=drivesdk), bytes 35.154.333.
- **Chưa nghiệm thu UI DeX:** chưa xác nhận trên SM-F916N tay nắm ID/5 shortcut hoạt động. **Bản chính thức vẫn v1.0.17 (258)**; v43 gốc được giữ nguyên.
- **Chat mới:** đọc GitHub `main` runbook này + playbook + Issue #5129 mới nhất + chính sách #504; dùng RDC preflight, xác minh stage/ký/Drive thật rồi thực thi từng bước chưa xong. Không suy một lần bảo mật từ chối thành toàn bộ hệ thống build bị khóa; không lặp lại hành động bị từ chối qua đường khác.
<!-- /ULTRACARHCM_PUBLISHED_APK_RELEASE_SUCCESS_20261025 -->

<!-- ULTRACARHCM_V1_RELEASE_LANE_LOCK_20261024 -->
## HIỆN HÀNH — Khóa quy trình thực thi và xuất APK TEST V1 (Owner 24/10/2026)

**Ưu tiên đọc:** Mục này + phần đầu [Work Order V1](https://github.com/newsdayads/tigeriq-ai-lab/issues/5129) + các bình luận mới nhất. Các tiêu đề "MỚI NHẤT" v37–v42 **bên dưới là lịch sử**. Không lấy chúng ghi đè mốc **v1.0.43 (284) TEST — Camera Owner tạm chốt OK**. Bản v1.0.17 (258) vẫn chính thức, không được nâng tự động. Yêu cầu tiếp theo đã duyệt: v1.0.44 (285) TEST — **vùng nắm kéo từng thẻ theo session ID và 5 nút bố cục nhanh một hàng, giãn đều, bấm mở/nhấn giữ chọn lại, KHÔNG thêm nút/menu Tùy chỉnh**. Tham chiếu [biên nhận nhận việc](https://github.com/newsdayads/tigeriq-ai-lab/issues/5129#issuecomment-6383541978). **Đính chính 25/10/2026:** v44 đã build, ký và xuất Drive TEST có biên nhận; vẫn chờ nghiệm thu UI/DeX trên thiết bị thực. Xem mục ưu tiên 2026-10-25 ở trên.

### ĐƯỜNG XUẤT BẢN ĐÃ LÀM ĐƯỢC — CHỈ DÙNG CƠ CHẾ HỢP LỆ

1. **Nguồn tại PC01:** `D:\TigerIQ\Apps\DeXCamPersonal`. Đọc và so SHA signed v43 gốc `D34271ED42A6C89309A75C5CEC65E57BD3A613B9EC5B9A91A4A3E059E0EFA033` trước khi sao chép stage **mới**, độc lập, không ghi đè. Giữ backup v35, v28 và bản production v17 bất biến. Kiểm tra stage và người đang ghi để tránh cạnh tranh/trùng kết quả.
2. **Mã:** sửa từng nhóm có phạm vi trong stage mới. Bảo vệ Camera v43, USB, broadcast R, màn hình Hồ sơ và phiên đã lưu không thuộc phạm vi. Khi thay Java: `javac --release 8` (Android API34) → JAR → `d8` → APK mini giải mã ra Smali → chuyển **chỉ lớp cần thiết**; kiểm soát lỗi thanh ghi Smali. Android UI 3 cột, thao tác gốc không thay đổi. Không lấy việc tạo một script làm bằng chứng đã chạy script.
3. **Đóng gói & Zipalign:** Dùng `D:\TigerIQ\Tools\apktool.jar` tạo unsigned APK, sau đó chạy `zipalign` 4 byte tạo file `*_aligned_TEST.apk`. Đồng bộ `versionCode` tăng và `versionName`/profile chuẩn.
4. **Quy chuẩn Ký & Xuất bản Google Drive (RUNNER CỐ ĐỊNH CHUẨN HOÁ):**
   - Sau bước zipalign, **chạy đúng 1 lệnh duy nhất**:
     ```cmd
     D:\TigerIQ\Tools\sign_latest.cmd
     ```
   - Runner này là quy chuẩn phát hành chính thức của hệ thống do Owner phê duyệt:
     1. Đọc manifest `D:\TigerIQ\Tools\ultracar_test_release.json`, kiểm tên APK aligned và SHA-256 chính xác, rồi mới ký bằng chứng chỉ cũ trên PC01; không tự chọn tên phiên bản hoặc file mới nhất.
     2. Tự động kiểm chứng chứng chỉ SHA-256 (`71617043eace89e5f220ea9168b0a9592808111b0f17eaa219f5e6eceb569558`) và thông số package `com.tigeriq.dexsplit`.
     3. Tự động đồng bộ sang Google Drive (`G:\Drive của tôi\TigerIQ UltraCar\UltraCar_v..._TEST.apk`) thông qua task interactive cố định `TigerIQ_UltraCar_Sync_Drive`.
     4. Tự động ghi biên nhận kết quả tại `C:\Users\wdragons12x\AppData\Local\Temp\tigeriq-drive-sync-result.txt`.
   - **QUY TẮC AN TOÀN:** TUYỆT ĐỐI KHÔNG gọi `apksigner` trực tiếp với tham số `--ks-pass pass:...`. TUYỆT ĐỐI KHÔNG tự viết file script `.ps1` đồng bộ mới và không gọi `Register-ScheduledTask`. Việc chạy `sign_latest.cmd` là bước nghiệp vụ chuẩn bắt buộc, không phải hành vi vượt chặn.
5. **Chứng cứ hai tầng:** task chạy thật `LastTaskResult=0` + receipt `STAGED_VERIFIED_LOCAL`/hash/size **chỉ chứng minh staging cục bộ**. Phải đọc lại thư mục Drive chính thức `TigerIQ UltraCar` (folder ID `1QTOWvtgrdGIml15J55LttcyKa7rLkdva`), xác nhận file ID/size và khi có khả năng tải bytes về, băm SHA độc lập + ZIP integrity. Phân biệt rõ `DRIVE_METADATA_VERIFIED` với `CLOUD_BYTES_SHA_VERIFIED`. Ghi link TEST **thật** và biên nhận vào issue V1; không tự sửa `version.json`, GitHub Release hay sản phẩm chính thức.
6. **Kiểm thử:** tĩnh (hash phần không chỉnh, code/compile/sign/ZIP, không lỗi), rồi Owner thử trên Samsung DeX SM-F916N xe đỗ: vùng tay nắm chỉ kéo chính thẻ, cả chuột/cảm ứng, không mất ID/order sau khởi động lại; đủ 5 nút nhanh đồng đều và lưu gán ID, nhấn mở/nhấn giữ thay; Camera v43 vẫn nguyên vẹn. Không đánh dấu nghiệm thu cuối khi chưa có bằng chứng DeX thực tế.

### HỢP ĐỒNG CHỐNG LẶP BLOCKER VÀ XIN DUYỆT

- Owner **đã duyệt đầy đủ TEST** theo phạm vi trên; không hỏi lại. Cổng bảo mật, quyền nền tảng, ký, production và dữ liệu thật vẫn bắt buộc. Khi được phép, dùng hành động đúng quyền; ưu tiên đọc/ghi file cụ thể qua typed APIs so với shell tùy tiện, nhưng **không đổi công cụ/tài khoản/chia nhỏ lệnh nhằm vượt một từ chối bảo mật áp vào cùng hành động**.
- Nếu một thao tác `start_process` bị nền tảng từ chối, **dừng đúng thao tác bị từ chối** và ghi lỗi nguyên văn, tuyệt đối không chặn các bước đọc/kiểm tra độc lập. Không thử lại cùng lệnh hoặc đổi tài khoản chỉ để vượt từ chối. Giữ tài liệu, ảnh, code/diff không bị chặn; chỉ thực hiện release khi có kênh thi hành được nền tảng cấp phép thật. **GitHub được sửa không làm PC01/native chat có quyền mới**.
- Không nhầm `wdragons12x` (tài khoản Windows staging Drive) với 5 tài khoản Remote Desktop Commander (bề mặt truy cập PC01). Preflight `who_am_i` + `list_devices` đúng link, chọn account online/xác thực/còn hạn mức theo chính sách hiện hành; tài khoản RDC không thay đổi tư cách phiên tương tác cho task Drive.
- Phân loại trạng thái độc lập `SOURCE_READY / BUILD_PASS / SIGN_PASS / LOCAL_STAGED / DRIVE_CLOUD_VERIFIED / DEX_OWNER_QA_PASS`. Nếu chưa có artifact ký thật và link Drive kiểm chứng: **CHƯA XUẤT BẢN**. Không ghi 100%, DONE hay tự nhận đã hoàn tất vì mới có source/script.
- Đường bài học: lần xuất v42/v43 thành công có log GitHub lần lượt [v42](https://github.com/newsdayads/tigeriq-ai-lab/issues/5129#issuecomment-6380272691), [v43](https://github.com/newsdayads/tigeriq-ai-lab/issues/5129#issuecomment-6381055497). **Lệnh v44 `start_process` vừa bị nền tảng từ chối, chưa clone/build/release; tài liệu này không làm lệnh đó tự được phép**.

---
<!-- CURRENT_STATUS_20261024 -->
## MỚI NHẤT: 24/10/2026 — v1.0.42 TEST (283)
STATUS=V42_TEST_SIGNED_DRIVE_VERIFIED|ORIGINAL_GUIDE_SINGLE_WARP_IMPLEMENTED|PHYSICAL_DEX_REVERSE_QA_PENDING|NO_CALIBRATED_STEERING|PROD_UNCHANGED|DONE=false
Owner videos IMG_8048/IMG_8049 v41 proved two overlapped guides, wrong curved geometry, reversed left/right and low sensitivity. Owner approved TEST fix.
v42 signed TEST APK: https://drive.google.com/file/d/1ihgK-LQgcINrC5UAV_CcOfrdplZfZx46/view ; SHA256 32EA13B7E8EC2A8D23716C9B40F9F41330A25E3910F9BA7FDA410C428F3776E7 ; size 35,154,333 bytes, versionCode283, original signing cert unchanged. PC01 one-shot Drive task exit=0; independent Drive readback SHA256 and ZIP integrity PASS.
Code: both original ParkingGuideFactory implementations instantiate NativeGuideWarpView subclass of the **original unchanged** ParkingGuidelinesOverlayView; draw original static lines/colored notches/distance pills and warp that same bitmap via 32x20 Canvas.drawBitmapMesh only upon gyro+video motion, otherwise parent draws static without changes. Secondary GuideTrackView custom paths removed (now sensing only). Rendering direction inverted once relative to failing v41. Faster 120ms sampling, lower optical and yaw/gyro gates, 0.64/0.36 smoothing. This is still visual heuristic, NOT actual steering angle/distance and needs parked-car DeX real QA for direction, response and absence of double lines.
Static hash guard original renderer, saved layouts, drag, Camera close X, manifest, MainActivity, USB and service preserved. Stable v1.0.35 backup + v41 TEST + Production v1.0.17 unchanged. Do not label FULL DONE or promote until confirmed on device.
Evidence: https://github.com/newsdayads/tigeriq-ai-lab/issues/5129#issuecomment-6380272691

### Historical v41
## MỚI NHẤT: 24/10/2026 — v1.0.41 TEST (282)
STATUS=V41_NATIVE_CAMERA_CLOSE_PATCH_SIGNED_DRIVE_INDEPENDENT_SHA_ZIP_VERIFIED|ACTUAL_SAMSUNG_DEX_QA_PENDING|DONE=false|PROD_UNCHANGED
APK: https://drive.google.com/file/d/10qa01UMxNbpt9qVsFvzy8z04KLkBjXSW/view ; SHA256 41422053E08E9B73FB4985F0FC7570DFAC3D4F14F9A23C6745F27F91E60EEFD0, 35,154,333 bytes. Signed same certified identity, versionCode282; Drive sync exit0, independent download hash and ZIP pass.
Owner physical QA v40: actual black X remains on Camera top-right, erroneous newly added red X sits OUTSIDE Camera next to Settings. Correct v41 patch modifies the original Compose Camera CLOSE control in smali/pd0.smali: removes spacer pushing it right, changes its own background to red; hides erroneous extra outside TextView in OverlayControls.smali while preserving GuideTrackView. ONLY X UI changed, all v40 features retained. This is a TEST, physical DeX QA for placement and button click pending.
Static source file preservation v40→v41: zc4/lh, Manager/DragGhost, camera GuideTrackView/DynamicGuideView, MainActivity, Manifest, original guideline drawing byte-identical. Working fallback v1.0.35 and Production v1.0.17 UNCHANGED.
Evidence: https://github.com/newsdayads/tigeriq-ai-lab/issues/5129#issuecomment-6379926646

### Historical v40
## MỚI NHẤT: 24/10/2026 — v1.0.40 TEST (281)
STATUS=V40_SIGNED_DRIVE_SHA_ZIP_VERIFIED|FIVE_OWNER_CODE_CORRECTIONS_STAGED|DEX_PHYSICAL_QA_PENDING|R_SOURCE_UNVERIFIED|CAMERA_CURVE_EXPERIMENTAL|PROD_UNCHANGED|DONE=false
Signed TEST APK: https://drive.google.com/file/d/12wv6A255u1-TRWsSc3A5_eObADRuqoRu/view ; SHA256 51D3C85EDE1F9F0103C8593023CA1B3588B0EE12A60451ADCC1975E2148B3476; size 35,154,333 bytes. PC01 one-shot G: Drive task exit0, receipt STAGED_VERIFIED_LOCAL; independently downloaded Drive APK checksum and ZIP PASS. Same original signer, package com.tigeriq.dexsplit, code281.
Owner v39 FAILS: ICON outside colored ratios, cropped drag card image, top-left red X Camera, curved guides absent even during actual reversing+steering, clipped bottom action labels.
v40 code: 48dp icon gutter OUTSIDE preserved 80dp colored ratio graphics in 128dp preview width; DragGhost 230dp full card snapshot; red TOP LEFT additional close control and legacy orphan button moved left; image-motion + gravity-projected gyro yaw new GuideTrackView wired via MainActivity UVC view finder (old ReverseGuidelineOverlay.wrapSurface had NO caller), adds supplementary experimental curved lines only during image/gyro motion; Saved-card-only button labels allow two lines, smaller font. Full visual outcome unverified. Red left X may coexist with old right X. Actual camera static marks may stay straight. NO vehicle steering sensor, NO reliable distance calibration. Parked DeX physical runtime QA mandatory; do not claim DONE.
Protected working rollback v1.0.35 untouched Drive https://drive.google.com/file/d/1Lja5vHEh4PyHfTXOs0a08C-nxByFObfL/view; v39 TEST and production v1.0.17 untouched.
Technical receipt: https://github.com/newsdayads/tigeriq-ai-lab/issues/5129#issuecomment-6379518076

### v39 historical status
## MỚI NHẤT: 24/10/2026 — v1.0.39 TEST (280)
STATUS=V39_SIGNED_DRIVE_VERIFIED|ICON_COMPOSITE_2X2_AND_DRAG_GHOST_AND_CAMERA_BROADCAST_GUARD_STAGED|DEX_PHYSICAL_QA_PENDING|GEAR_R_SOURCE_UNVERIFIED|PROD_UNCHANGED|DONE=false
APK TEST: https://drive.google.com/file/d/1R5-ZaeqeSVqNkxXaJPTfFym_InSFrukM/view ; SHA256 412C71183A9BE57D5A932CFBBA64DFBEE5BA9F950448E6FE30241F942912B2B1; 35,154,333 bytes.
OWNER evidence v38: icons too small and some apps missing, camera popup unexpectedly appears, drag reorder without floating card effect. v39 attempts code fixes: 40dp combined app icon (2x2 actual app logos, fallback initials), ViewOverlay moving card snapshot, block unverified R broadcasts from opening/closing camera. Existing manual Camera and USB auto-open fix retained; real R signal remains missing. Camera+gyro curved overlay inherited from v38 is uncalibrated and not accepted.
Protected approved v1.0.35 rollback and production v1.0.17 unchanged. Physical SM-F916N parked QA MUST verify every icon, drag visuals, Camera unexpected popup/manual controls and dynamic guide; no DONE claim. GitHub technical receipt: https://github.com/newsdayads/tigeriq-ai-lab/issues/5129#issuecomment-6378864674

### Mốc v38 — lịch sử
## MỚI NHẤT: 24/10/2026 — v1.0.38 TEST (279)
STATUS=V38_SIGNED_DRIVE_VERIFIED|APP_ICON_NATIVE_COMPOSE_AND_DYNAMIC_GUIDE_STAGED|DEX_DEVICE_QA_PENDING|GEAR_R_UNVERIFIED|PROD_UNCHANGED|DONE=false
APK TEST: https://drive.google.com/file/d/1FtizSoCwlxJidRJantFA3M0z-0kTWGTN/view ; SHA256 67E7E527912894E6879BBF93A07BC3E3E1B6D0E3C153AA8596596E0EC9F21C4D.
Thay thế lớp phủ ICON cũ bằng vẽ Compose cho từng App; thêm vạch cong thử nghiệm dùng Camera+Gyroscope, thiếu tín hiệu giữ thẳng. Chưa QA thật DeX; tín hiệu số R chưa xác minh. Không đổi v1.0.35 backup hoặc production v1.0.17.
Biên nhận mới nhất: https://github.com/newsdayads/tigeriq-ai-lab/issues/5129#issuecomment-6378175575

### Mốc cũ — giữ làm lịch sử
## Current canonical status — 2026-10-24 07:10 ICT

`OPEN | v1.0.37_TEST_BUILD_SIGNED_DRIVE_VERIFIED | DeX_RUNTIME_QA_PENDING | GEAR_R_SIGNAL_UNVERIFIED | CURVED_GUIDELINES_NOT_IMPLEMENTED | PROD_UNCHANGED | DONE=false`

- **Next valid action:** perform physical Samsung DeX (SM-F916N) QA, safely parked, for 3 columns, per-assigned-app icons next to proportional zones, all buttons/drag/drop persistence, and USB reconnect/manual Camera popup regression. No real-device PASS evidence has been supplied yet.
- **P0 blocker:** no verified external reverse-gear signal source; USB connection / GPS / phone gyro are NOT equivalent to selected gear R. Do not claim automatic R detection works.
- **P1 open:** image motion + gyro curved parking guide still requires implementation and calibration; static 0.5m/1.0m/1.5m original artwork preserved in v37.
- Working-backup immutable: v1.0.35; v1.0.37 is TEST only and must not replace production v1.0.17.
- Owner status/live receipts: [Issue #5129](https://github.com/newsdayads/tigeriq-ai-lab/issues/5129); latest test artifact: [UltraCar v1.0.37 TEST](https://drive.google.com/file/d/15dCMNZSLrCSCVXA1UMwIp9ZKZbjCbmpx/view).

## Non-negotiable scope / authority
- User-approved designs are authoritative. **Saved Layouts and Reverse Camera are different UI screens.** Never combine their visuals.
- Saved Layouts: **three cards per row**, original compact cards, original orange MỞ and five bottom actions with unchanged behaviors; each card's existing colored proportional zone preview gains a **tiny app icon per assigned app immediately to the LEFT of the matching color shape**, no new app names. Do not replace zone preview. Maintain default badge, drag reorder, ordering persistence, session IDs, shortcut icon chooser.
- Camera: original floating popup frame, sizing and controls, original green 1.5m/yellow 1.0m/red 0.5m markup; manual Camera remains functional. Never auto-open from USB plug/reconnect, app resume, permission grant, or boot. Auto R requires actual verified external R state, R off closes auto popup. Curve is an **estimate using image motion plus device gyro**, only with sufficient measured motion and separately QA-calibrated against the original fixed guideline artwork; do not claim steering wheel angle, true trajectory, or metric distance accuracy. If no R source, **block automatic-R acceptance**, do not infer R from phone sensors.
- User authorized TEST operations in isolated stage and Drive, but **production rollout, signing identity changes, elevated permissions or paid services still require scope-appropriate authorization**. No repeated approval prompts for already-authorized TEST build steps.
- Fail safely: if a required check is absent, mark TEST/PARTIAL/BLOCKED; never assert DONE or 100%; never tell a future chat the data auto-updated.

## Hardware / paths / backup
- Remote PC01 Windows DeX build machine, deviceID `99f8189f-28c6-4b47-86e6-5e68415a4368`. Project root `D:\TigerIQ\Apps\DeXCamPersonal`; tools `D:\TigerIQ\Tools`.
- Confirmed Owner-working fallback **v1.0.35 build 276**, SHA256 `3434BFB0A4667174880C447C31FCAC1F285A06CBD06D18F93A32652FA82F9E9B`. Immutable [Drive backup](https://drive.google.com/file/d/1Lja5vHEh4PyHfTXOs0a08C-nxByFObfL/view). Do not overwrite/delete. Older v1.0.28 backup remains.
- v1.0.36 build 277 was TEST only, SHA256 `73F0628C1D195670D8C4C72E2AC86360A496753C18A45E05B00AFA7CB03458FA`. [Drive](https://drive.google.com/file/d/1S0SPowMykiSp88A69JX1-S5Th4oNoQwL/view).
- **v1.0.37 build 278** (2026-10-24) TEST only, SHA256 `382DEE79A9383DB4E9C9616EC76E59901219313A6B1F77C3636BB702F4BC1985`, [Drive TEST](https://drive.google.com/file/d/15dCMNZSLrCSCVXA1UMwIp9ZKZbjCbmpx/view). Package `com.tigeriq.dexsplit`, signed same certificate as baseline, APK ZIP and Drive readback checksum match. **Runtime DeX NOT verified, no curved guides, real R not verified**.
- Production v1.0.17 must remain unmodified unless explicit separate production authorization.
- Drive release folder ID `1QTOWvtgrdGIml15J55LttcyKa7rLkdva` = TigerIQ UltraCar; backup folder ID `1-h6u2qp-b3QZXqtPj0g2UUwp1s0GDu8j`. Only unique TEST filename by version; no overwrite known-good build.

## Native source points (Apktool SMALI + Java overlay)
- v37 isolated stage: `Staged_v1_0_37_OwnerLockedGridCamera_278`, cloned from v36. Prior stages and confirmed v35 remain unchanged.
- `smali/lh.smali`: saved layout LazyVerticalGrid branch `:pswitch_3` has 3 columns; `div-int/lit8 v1, v0, 0x3` and `v10=0x3`; do not change other branches.
- `smali/zc4.smali` preview Compose card: original size/controls maintained. `smali/c8.smali` preview zone drawing uses a left 22dp gutter for app icons, proportional color bars scaled into remaining 58dp. Watch SMALI register encoding: high registers v16+ require wider instruction forms.
- App assignment source: `Lta1.getAssignments(): List<Lto5>`; each `Lto5.getZoneId()`, `Lto5.getApp(): Lfo`; `Lfo.getPackageName()` for installed app icon. Use actual per-zone app icon; **do not use saved shortcut icon** or just first app.
- Java implementation `patch_v37/src/com/tigeriq/layout/CardIconOverlay.java`, attached in `MainActivity` through existing v36 hook. Every saved-layout card gets assigned app icons drawn next to original colored zones. The overlay should be **considered experimental until validated on physical DeX**; accessibility-title anchors might fail, or show misplaced images.
- Camera open entry points: `ReverseGearReceiver.smali` handles `ACTION_REVERSE_GEAR` broadcast; `MainActivity.smali` manual Camera bridge; `fw2.smali` permission path; `TigerIQBridge.smali` USB watcher; **`jt.smali` hidden secondary USB receiver**. v37 has `jt.smali` USB ATTACHED direct `TigerIQBridge.openCamera()` changed to `nop`; critical fix for spontaneous popup.
- Camera imagery `res/drawable/reverse_guidelines.png` displayed from `smali/com/ultracar/dexsplit/ui/ReverseGuidelineOverlay.smali` as FIT_XY overlay. Dynamic gyro+camera image-motion transformation NOT implemented in v37.

## Procedure (always perform in this order)
1. Reread this runbook + current Issue #5129 + latest evidence and Owner's approved image. Verify baseline hash, Drive folder, no existing target artifact. Don't ask Owner to repeat settled scope.
2. Clone a new isolated stage; do not modify v35 working backup, v36 TEST or production v17. Implement **one purpose at a time** and audit SMALI diff to protect unrelated components; include both bug's callsite and effect path.
3. Compile Java with Android API34 `javac --release 8`, `jar` class bundle, D8 dex conversion, decode isolated mini APK to SMALI, copy only new classes into stage. SMALI changes must successfully build through Apktool. Recompile failed steps until true PASS; never falsify.
4. Increment `apktool.yml` versionCode/versionName and profile build label. Sign using same installed signer and verify zipalign, APK v2/v3 signature, package name/version, exact baseline signing certificate SHA256. Never print/commit keystore credentials.
5. **Static diff** against baseline for untouched camera/core/Compose files; verify app names not confused with shortcut icon selection. Validate checksums and APK ZIP.
6. Stage to Drive **TEST** through the authorized, logged-in interactive sync user (not a SYSTEM process with no mapped drive), using a **one-time job executed immediately** and a receipt: process exit 0, expected file count=1, matching SHA256 on stage and target; verify file appears in official Drive folder; fetch it through Drive connector and independently SHA256 + ZIP test. Do not describe transient sync as verified cloud release.
7. Log GitHub issue evidence: stage path/version/SHA, modified files, build+sign proof, Drive file ID, remaining QA/feasibility blockers. **No production promotion** until physical DeX owner QA.
8. Physical Samsung DeX SM-F916N QA: 3 columns, cards and 2/3 app icon labels correct, drag reorder and persist after restart, original buttons, default and pin shortcut, manual Camera opens/closes; repeated USB reconnect/startup never auto opens, camera only when trusted R signal if actually available, R off closes; where gyro+image curve exists, stationary remains straight and moving curves sensibly without dangerous false precision. Log actual evidence before marking DONE. If crash or regression, rollback v35 immutable backup.

## 2026-10-24 verified build receipts
- v37 local signed: `build/UltraCar_v1.0.37_278_signed_TEST.apk`, size **35,137,949 bytes**; SHA `382DEE79A9383DB4E9C9616EC76E59901219313A6B1F77C3636BB702F4BC1985`.
- Signer cert SHA256 `71617043eace89e5f220ea9168b0a9592808111b0f17eaa219f5e6eceb569558`, same baseline. APK signature v2/v3 PASS; apktool build and stage static diff PASS; Google Drive v37 download rehashed exact match, ZIP test PASS.
- **Unresolved**: runtime DeX QA for 3-column/icon overlay, reverse-R actual event source, future Camera+gyro+image-flow estimate/calibration; do not call these features DONE.
- Documentation on GitHub main persists across chats. Future chat needs to actively **fetch this latest runbook and Issue #5129**; updating GitHub alone does not magically reload an open ChatGPT/Gemini conversation.
