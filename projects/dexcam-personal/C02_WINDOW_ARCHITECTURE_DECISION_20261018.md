# C02 — Kiến trúc cửa sổ, tọa độ và fallback an toàn (nguồn)

**Work Order:** https://github.com/newsdayads/tigeriq-ai-lab/issues/4625
**RESOURCE_SCOPE:** DEXCAM_PERSONAL_GH4625_SOURCE_AND_BUILD
**Giới hạn:** Kiến trúc và kiểm thử nguồn; KHÔNG phải chứng cứ Android/DeX trên máy thật, APK build, P01 REA, C01 hoặc nghiệm thu G1/G2.

## 1. Quyết định kiến trúc

- **L0 — mặc định:** dùng public Android Intent / ActivityOptions để ĐỀ NGHỊ launch bounds lúc mở Activity nếu adapter xác minh multi-window/freeform, display và trạng thái Activity foreground. Phân biệt requested_bounds với applied_bounds; đầu ra planning luôn NOT_MEASURED.
- **L1 — fallback:** nếu thiếu capability, app ở background, fingerprint/display ID đổi, cấu hình sai, Android không hỗ trợ hoặc OS bỏ qua bounds, giữ profile, cảnh báo rõ và cho người dùng điều chỉnh thủ công trong điều kiện an toàn.
- **L2 — khóa quyền:** không tự resize task của ứng dụng bên thứ ba, không tự bật ADB/Shizuku; thêm adapter đặc quyền cần bằng chứng quyền thiết bị và phê duyệt hành động riêng. Root/hidden API/Accessibility bypass ngoài phạm vi.
- **Snapshot/R:** lưu bố cục trước khi camera xuất hiện; chỉ đề nghị khôi phục nếu R=OFF từ nguồn độc lập có evidence reference hoặc người dùng đóng thủ công khi xác nhận xe đứng yên. Mất USB/frame hoặc R ON/UNKNOWN giữ snapshot và cảnh báo CAMERA_UNAVAILABLE, không phát frame cũ như hình sống.

## 2. Quy tắc tọa độ / dữ liệu

Profile lưu display_id, display_fingerprint và bounds_normalized (x,y,width,height) với tỷ lệ hữu hạn trong [0,1]. Android adapter tương lai cung cấp logical pixels, measured insets (system bars/caption/cutout), capability và activity state. Không mặc định 1920x1080 (chỉ fixture).

usable_rect = screen_bounds - measured_insets. Chỉ khi đủ dữ liệu màn hình mới quy đổi tọa độ tỉ lệ thành pixel trong vùng an toàn. Nếu invalid/stale display → MANUAL_FALLBACK, không ghi đè cấu hình. Nếu OS thay đổi bounds do caption/minimum size, cần observed_bounds cùng evidence reference thật trước khi so sánh. Chưa đo thiết bị thì không chốt ngưỡng pixel/deviation.

**Nguồn Android công khai, KHÔNG phải kiểm thử Samsung DeX của Owner:**
- [ActivityOptions.setLaunchBounds](https://developer.android.com/reference/android/app/ActivityOptions#setLaunchBounds(android.graphics.Rect)): screen-space pixel Rect; hệ thống có thể bỏ qua nếu freeform/PiP không hỗ trợ.
- [Multi-window mode](https://developer.android.com/develop/ui/views/layout/support-multi-window-mode): phụ thuộc Android/OEM, không trao quyền resize mọi task đã chạy.
- [Window Insets](https://developer.android.com/develop/ui/views/layout/insets): xác định vùng hệ thống cần tránh theo màn hình thực.

## 3. Logic nguồn và kiểm thử

**Nguồn C02 độc lập:** projects/dexcam-personal/c02-window-contract.mjs (pure functions Node >=20, không gọi Android/PC01/USB/Internet/chi phí).
- planWindowRequest: REQUEST_L0_LAUNCH_BOUNDS hoặc MANUAL_FALLBACK; không tự nhận applied bounds.
- checkAppliedBounds: không có readback evidence → NOT_MEASURED, không giả OS PASS.
- planLayoutRestore: chỉ restore với R_OFF độc lập hoặc manual close khi xe đứng yên.

**Bộ kiểm thử:** tests/dexcam-personal/c02-window-contract.test.mjs (Node) và c02-window-contract.test.ts (Vitest). Test các ca capability thiếu, background launch, đổi display, bounds vượt vùng, insets, không có readback, R ON/UNKNOWN + mất frame, verified OFF/manual close. Exact-head CI + GitHub PR merge + main readback mới chứng minh source contract, không chứng minh Android app vận hành.

## 4. Phần chưa thể nghiệm thu qua nguồn thuần

- **P01/C01/G1:** native REA trên APK v240 ở PC01 có cổng quyền; thiết bị thực USB/DeX và R_OFF độc lập.
- **G2:** đo và xác nhận phiên Android/One UI/DeX thật, ứng dụng khi chạy nền và khả năng đọc lại applied bounds; thiết kế C02 không thay thế phê duyệt G2.
- **D01–F05:** chưa có Kotlin/Gradle APK thật, quyền cài, thử 5/50 lượt R hoặc release.

**ADR C02:** chốt kiến trúc nguồn theo capability-gated L0 request → L1 manual fallback; L2 qua cổng quyền riêng; tọa độ normalized + insets + actual readback, chỉ khôi phục bố cục sau OFF đáng tin cậy. Khả năng tương thích thiết bị vẫn UNVERIFIED. Toàn dự án DONE=false.
