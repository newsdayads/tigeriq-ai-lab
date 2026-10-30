# UltraCarHCM V70 — FIX chọn nhầm thẻ và thiếu nút sắp xếp

**Status:** V70 Build311 TEST unsigned/aligned; chưa ký, chưa xuất Drive, chưa QA DeX trên thiết bị. Không tuyên bố giao diện đã chạy đúng khi chưa kiểm tra thực tế.

## Lỗi người dùng (ảnh 2026-10-31)

- Trong **BỐ CỤC ĐÃ LƯU** (6 bố cục), không có nút xác định bố cục/kéo thả đáng tin cậy.
- Nắm giữ **GreenSM** ở ô trái hàng dưới nhưng ứng dụng chọn/nhấc **BE Partner** ở ô phải.
- Root cause chưa chứng minh từ thiết bị; mã V68/V69 phụ thuộc tọa độ màn hình Compose và lớp grip overlay dễ sai mapping. Đường `V44UiBridge.onGrip` và ghost cũ không được chấp nhận cho bản mới nếu chưa chứng minh chọn đúng ID.

## Giải pháp V70: danh sách native có tên/ID cố định

- Trên màn hình **Bố cục đã lưu**, thêm nút nổi `≡ SẮP XẾP BỐ CỤC` **góc trên bên phải** trong vùng giao diện, không gắn nhầm vào vùng kéo của một thẻ.
- Chạm nút mở `com.tigeriq.layout.Manager.show()`, trình sắp xếp native **đã tồn tại trong App**: tên từng bố cục, tay nắm kéo thả và nút ↑/↓. Thứ tự lưu bằng `Manager.shift` → `saveOrder` → `redraw`; `Manager.sort(List)` đã được gọi từ `bd4.smali` trong danh sách Compose, nên danh sách manager dùng cùng đối tượng chứa ID.
- Gọi `LayoutSortControl.show()` từ 2 nhánh SavedScreen `ad4.smali`; `hide()` từ 2 nhánh HomeScreen `ho0.smali`, không đặt nút đè lên thẻ.
- Tắt `V44UiBridge.updateGrip` và `showAllGrips` **chỉ trong build V70** để bỏ lớp tay nắm overlay cũ gây chọn nhầm; các CardPositioned callbacks và toàn bộ UI bố cục vẫn giữ nguyên.
- Kiểm tra click: không cho mở reorder dialog nếu chưa có từ 2 bố cục thực. Không xóa layout, không reset dữ liệu, không thay đổi Camera/QuickBar/Updater V69.
- **Thao tác được hỗ trợ:** mở `SẮP XẾP BỐ CỤC` → kéo tên trong danh sách hoặc ấn ↑/↓ → thoát/làm mới danh sách; không kéo trực tiếp thẻ chính trong V70 (đã tắt xử lý overlay không đáng tin cậy).

## PC01 build receipt

- Stage `D:\TigerIQ\Apps\DeXCamPersonal\Staged_v1_0_70_TEST_311_MCP` lấy từ V69, compile Java 8 → D8 PASS, chuyển 4 Smali classes.
- Patches: `apps/ultracarhcm-v1-v70/src/com/tigeriq/v70/LayoutSortControl.java` và `apps/ultracarhcm-v1-v70/pc01/apply_v70.py`.
- `apktool b` PASS; zipalign `-c -p 4` PASS; `aapt2 dump badging` xác minh package `com.tigeriq.dexsplit`, `versionCode=311`, `versionName=TigerIQ_HCM_v1.0.70`.
- **APK chưa ký**: `D:\TigerIQ\Apps\DeXCamPersonal\build\UltraCar_v1.0.70_311_LayoutSortFallback_aligned_TEST.apk`; size `34,981,993`; SHA-256 `746A398575D0331997351383F252B92201093497A8ABC135F64E53DD5F0B1317`.
- PC01 signer manifest pinned to V70 after backing up V69 signed/Drive manifest. Existing signing key + signer + sync task unchanged; no replacement key or public upload.
- Owner standing TEST release approval persists; actual signing must use an execution path permitted by platform. Do not reroute a host-denied signing action to bypass it.
- Required acceptance: signing receipt, apksigner v2/v3 & signer cert, Drive file+metadata, then Android DeX Z Fold2 screenshot and real GreenSM → other position test after reload. **Until then, FIX_IMPLEMENTED_BUILD_PASS but QA_PENDING.**

Owner issue: https://github.com/newsdayads/tigeriq-ai-lab/issues/5129
