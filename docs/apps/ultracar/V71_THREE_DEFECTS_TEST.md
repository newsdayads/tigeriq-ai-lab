# UltraCar V71 TEST — Bố cục / Hồ sơ / Camera (2026-10-31)

## Nhận lỗi thực tế từ Owner (ảnh DeX)
1. V70 vẫn không hiện nút **Sắp xếp bố cục**.
2. Hồ sơ người lái hiển thị bản V66 dù APK V70.
3. Cửa sổ Camera thỉnh thoảng bật khi chưa về số R. Đúng yêu cầu: chỉ hiển thị trạng thái **đang chờ tín hiệu Camera**, không tự mở cửa sổ khi chưa có R.

## V71 sửa trong STAGE PC01 (không chỉnh bản đã phát hành)
- Root cause hồ sơ **đã xác minh mã nguồn:** `res/values/strings.xml` chứa `prof_subtitle=TIGERIQ HCM v1.0.66 (BUILD 307)`. Đồng bộ nhãn thành `v1.0.71 (BUILD 312)`. Lần build sau phải kiểm `prof_subtitle` trùng `apktool.yml` để tránh tái diễn.
- Root cause nút sắp xếp **giả thuyết có căn cứ:** V70 gọi `LayoutSortControl.show()` ở cả hai nhánh Saved `ad4`, nhưng `ho0` đồng thời gọi `hide()` ở hai nhánh Home có thể ẩn nút khi Compose tái dựng. V71 chỉ bỏ **hai** lời gọi hide; giữ cả hai lệnh show và bản `LayoutSortControl` đã tạo trong V70. **Tradeoff:** nếu luồng Home không gọi đúng điều kiện, nút có thể còn hiển thị ngoài Saved screen. Chưa xác minh UI thực; cần test và hoàn thiện routing theo màn hình thực.
- Root cause Camera **đã xác minh mã nguồn:** `TigerIQBridge.init` và `onResume` cùng tự khởi động `FloatingCameraService.start` và `startWatcher` mà không cần R; `DexDockReceiver$1` tự start service; trong `av1.smali` sự kiện `camera_auto_open_edge` khi gắn USB kích hoạt camera. V71 tắt **hai start service**, **hai start watcher**, **một Dock auto-start**, **một VM USB auto-open**. Vẫn giữ thông báo trạng thái hiện hành.
- **Cổng R vật lý:** `ReverseGearReceiver` hiện cố tình từ chối R broadcast chưa xác thực (physical gear signal unverified). V71 **không** tự nhận R automation DONE, không giả nguồn gear bằng USB / DeX / intent. Tự mở khi về R cần xác minh nguồn/cáp/adapter tín hiệu R thực tế và kiểm thử trên xe; không được bỏ cổng này.
- Không thay đổi chức năng manual Camera, quyền key ký, Production, dữ liệu bố cục, hoặc app package.

## PC01 build evidence
- Stage `D:\TigerIQ\Apps\DeXCamPersonal\Staged_v1_0_71_TEST_312_MCP`, từ bản V70.
- Patches `apps/ultracarhcm-v1-v71/pc01/apply_v71.py` + `postrender_sort_hook.py`. Reassert native sort button after Compose's saved-layout content in both routes (four calls total) so it cannot be drawn behind the content. Static guards verified: subtitle 1, saved show2, home hide removed2, bridge service2, watcher2, dock1, VM USB edge1, ReverseGearReceiver stays closed.
- Apktool build PASS (signed input not touched), zipalign check PASS; `aapt2 dump badging` PASS for package `com.tigeriq.dexsplit`, code312, name `TigerIQ_HCM_v1.0.71`.
- Unsigned `UltraCar_v1.0.71_312_HeaderCameraFix_unsigned_TEST.apk` SHA256 `EA27CAB2227DD546A45C83AD32F4DC76743B5CA49543DA7D5D2614B50024A977`, bytes 34,938,561.
- **Aligned but not signed** `D:\TigerIQ\Apps\DeXCamPersonal\build\UltraCar_v1.0.71_312_HeaderCameraFix_aligned_TEST.apk`: bytes **34,981,993**, SHA256 **183D62E34BCC4EE65E2BD5E06127B2A6CF665F3EF5B69592D2748E7D6D55ECF8**.
- PC01 canonical `ultracar_test_release.json` pinned code312 and this SHA; V70 signed/Drive manifest backed up as `ultracar_test_release.v70_311_signed_drive_verified.json`. Do not overwrite previous signed APK or publish this unsigned file.

## Acceptance status
**BUILD_PASS / STATIC_PATCH_PASS / SIGN_PENDING / DRIVE_PENDING / REAL_DEX_QA_PENDING / R_INPUT_UNVERIFIED / PRODUCTION_UNCHANGED.**
- After legitimate signing: independently verify APK v2/v3 and old signing cert, receipt, and Drive metadata; then on actual Fold2+DeX verify button visible, reorder GreenSM by arrow and reload (BE Partner unchanged), profile label V71, no unwanted Camera popups during use without R.
- Physical R-to-auto-camera activation remains separate hardware-signal integration gate until the trusted physical feed is proven. Do not conflate with suppressing false auto-opens.

[Issue #5129](https://github.com/newsdayads/tigeriq-ai-lab/issues/5129)
