# UltraCar V72 TEST — sửa nút sắp xếp và popup Camera nhanh

## Phạm vi và lỗi đã xác minh

- Owner báo V71 không hiện nút **SẮP XẾP BỐ CỤC** và bị mất **popup phím tắt Camera**.
- Nguồn V71 cho thấy:
  - `LayoutSortControl` là `TextView` chèn vào `android.R.id.content` với 4 lời gọi từ `ad4`, nhưng không có bằng chứng hiển thị đúng trên Fold2/DeX. Trước đó lớp grip nhận nhầm GreenSM thành BE Partner; **không tái sử dụng grip cũ**.
  - V71 cố tránh Camera tự bật bằng cách **vô hiệu luôn** hai lời gọi `FloatingCameraService.start` trong `TigerIQBridge.init/onResume`; điều này đồng thời tắt nút Camera nổi.
  - Không có đầu vào R vật lý được xác thực: `ReverseGearReceiver` đang chặn broadcast R chưa xác minh.

## V72 thiết kế tách luồng

1. **Bố cục:** Thay lời gọi V70 `LayoutSortControl.show()` bằng `SortPopup.show()` trong đúng 4 điểm `ad4.smali`. `SortPopup` tạo `PopupWindow` **không lấy focus** trên `Activity.getWindow().getDecorView()`, nằm phía trên Compose, có nút **≡ SẮP XẾP BỐ CỤC**. Nhấn nút mở `com.tigeriq.layout.Manager.show()` đã có, dùng danh sách định danh và các phím ↑/↓ để chuyển vị trí; không xử lý giữ kéo trên thẻ sai hit-test. `PopupWindow` không đòi quyền SYSTEM_ALERT_WINDOW. Logs `TigerIQ-V72-Sort` gồm `NATIVE_SORT_BUTTON_SHOWN`, `NATIVE_REORDER_EDITOR_OPENED` hoặc lỗi cụ thể.
2. **Camera popup:** Chỉ khôi phục **dịch vụ nút nổi** `FloatingCameraService.start` khi mở/quay lại App (2 điểm). `FloatingCameraService.updateFloatingView` dựng nút và `onTouch` gọi `TigerIQBridge.toggleCamera` khi người dùng chủ động nhấn. Không khôi phục USB auto-open.
3. **Chống bật Camera sai:** Tiếp tục tắt 2 lần `startWatcher` từ Activity, auto-start từ DeX dock và dispatch VM USB edge. R vẫn chưa được coi là hợp lệ khi thiếu tín hiệu vật lý. Chỉ mở Camera thủ công khi người dùng nhấn nút; không giả đã tự mở khi về R.
4. Nhãn hồ sơ theo build: `TIGERIQ HCM v1.0.72 (BUILD 313)`. Bảo toàn package, dữ liệu bố cục, nút QuickBar, tính năng tải APK V69, Android signatures và Production.

## Biên nhận PC01

- Source `patch_v72_mcp/src/com/tigeriq/v72/SortPopup.java`; patch `patch_v72_mcp/apply_v72.py`. Java8 + D8 PASS, 4 Smali classes.
- Staged: `D:\TigerIQ\Apps\DeXCamPersonal\Staged_v1_0_72_TEST_313_MCP`.
- Apktool BUILD PASS; zipalign `-c -p 4` PASS; `aapt2 dump badging` PASS package `com.tigeriq.dexsplit` code313 name `TigerIQ_HCM_v1.0.72`.
- Unsigned `UltraCar_v1.0.72_313_LayoutQuickCamera_unsigned_TEST.apk`, SHA256 `C2992BD262E2C594534AD325DB6FAA481B1BE0CCDF63F7E3557BD2A8C135DB62`.
- Aligned **NOT SIGNED** `D:\TigerIQ\Apps\DeXCamPersonal\build\UltraCar_v1.0.72_313_LayoutQuickCamera_aligned_TEST.apk`, **34.981.993 bytes**, SHA256 `CD68C3C45F240B11EBE4A867ABBC8EA54A6F1C298A8BBB41BA14AC7C8FA91E27`. 12/12 static safeguards PASS.
- Canonical PC01 manifest updated/pinned to version313, previous V71 signed manifest safely backed up; original key and sign/sync runners untouched.
- Test Android S10 connected PC01: installed signed V71 (code312) PASS; device in unusual multiwindow state with YouTube/Maps and not matching user's Fold2/DeX view, **therefore no valid UI acceptance**. V72 **not installed** (unsigned).

## Release gates / acceptance

**NOT DONE:** V72 sign/Drive/owner Fold2 DeX QA pending. Signing must follow authorized allowed route with same verified cert and Drive readback; do not reroute earlier host-denied action. Real QA:
- Button sort must physically appear on Saved Layouts; click must open native Manager. Move GreenSM with ↑↓; reopen; BE Partner must remain correctly identified.
- Floating Camera shortcut visible; click manually opens Camera; without touch/physical R Camera window stays closed during normal App/USB/DeX events.
- Profile displays V72.
- The **physical R detector** remains unverified; camera autostart on R requires verified hardware signal.
- **OTA blocker separate:** GitHub `main/version.json` still code306 and Drive signed APK is Owner-only; cannot claim in-app updater FULL AUTO or publish private APK publicly without secure direct endpoint and rights.

**Status:** BUILD_PASS, STATIC_PASS, MANIFEST_PINNED, SIGN_PENDING, DRIVE_PENDING, DE X_QA_PENDING, PHYSICAL_R_UNVERIFIED, OTA_DIRECT_ENDPOINT_PENDING. Production untouched.

Issue: https://github.com/newsdayads/tigeriq-ai-lab/issues/5129
