# UltraCar HCM v1.0.44 (285) — nguồn lõi bản thử, chưa phải APK

**Trạng thái:** Chỉ 4 lớp Java quản lý ID/tọa độ và 5 ô nhanh. Bản thử logic Java 8 cục bộ: **49/49 kiểm thử đã chạy đạt** (có mã kiểm thử được đính kèm trong cuộc trò chuyện Owner 25/10/2026). Không tự đồng nhất kết quả logic với thử nghiệm Android, biên dịch Smali, ký APK hay kiểm thử DeX.

**Nguồn nền:** v1.0.43 (284) TEST, hash SHA256 D34271ED42A6C89309A75C5CEC65E57BD3A613B9EC5B9A91A4A3E059E0EFA033; Camera v43 tạm chốt, không chỉnh. Trước đây v41–v43: javac --release 8 → D8 → Apktool → zipalign → apksigner v2/v3 → scheduled task của user tương tác → Google Drive. Chi tiết theo `docs/apps/ultracar/WORKFLOW_APK_RELEASE.md` và Issue V1.

**Đã có:** `ExactCardIndex` chỉ tìm điểm trong bounds thực của thẻ/tay nắm, không đoán theo tên/trung tâm gần nhất; `DragSession` giữ nguồn và phiên đo; `SessionOrder` di chuyển ID ổn định; `QuickSlots` đúng năm ô lưu theo ID, bảo toàn chuỗi Unicode.

**Cần tích hợp thực để được đóng gói:** 
1. `smali/zc4.smali` là Compose giao diện thẻ: thêm grip vào từng card với nguồn `Ldm2` và ID thật, cung cấp bounds card/grip đo bằng Compose, hiển thị bóng kéo; tắt đường dispatch cũ của `Addons.target(FF)` trên màn bố cục đã lưu; giữ nguyên lưới ba cột, kích thước, nút.
2. Thanh năm nút Compose trên màn chính phải được chèn **giữa nút KHỞI ĐỘNG và hàng cuối**, `weight(1f)`, icon+label, bấm gửi `launch_session_id` tới MainActivity, nhấn giữ chọn session đang lưu; lưu `QuickSlots.encode()` vào cấu hình riêng, đọc lại khi mở.
3. Khi thả chính xác vào card: gọi đường lưu có sẵn `Manager.shift(id, index)` để không phá dữ liệu cũ `tigeriq_layout_order_icon_v31`. Chưa có bảng ID/bounds thật thì không được giả định trùng title là cùng session.
4. Tạo stage v44 độc lập, apktool.yml code285 và profile v44, kiểm hash các lớp Camera/USB bất biến; Apktool/zipalign/apksigner cùng chứng chỉ SHA256 71617043eace89e5f220ea9168b0a9592808111b0f17eaa219f5e6eceb569558; Drive xác minh độc lập; Samsung Z Fold 2 DeX thực tế xe đỗ; **Production v1.0.17 (258) giữ nguyên**.

**Lưu ý quyền:** Lệnh PC01 clone stage v44 từng bị hệ thống chặn trước khi có tiến trình. Không sử dụng nhánh GitHub này để né cổng đó. Nguồn lõi có thể được kiểm thử độc lập; đóng gói thực trên máy phải theo đường được nền tảng cấp phép.

**Theo dõi:** Issue chính V1 #5129 - Camera v1.0.43 TEST tạm chốt OK | ứng dụng chưa nghiệm thu cuối. PR này là bản nháp, không thay Production.
