# 04 — Đặc tả kỹ thuật quản lý cửa sổ Samsung DeX

## 1. Mục tiêu
Quản lý **các cửa sổ ứng dụng thật**, không dựng hình giả các app trong một màn hình. Owner tùy biến tên ứng dụng, X/Y/W/H, kích thước tương đối hoặc tuyệt đối, preset bố cục và khoảng hở. Khi camera lùi xuất hiện, trạng thái bố cục phải còn nguyên khi khôi phục.

## 2. Bối cảnh nền tảng
- Samsung DeX triển khai đa cửa sổ tùy phiên bản One UI, phần cứng và màn hình ngoài.
- `ActivityOptions.setLaunchBounds` có thể **đề nghị** hình chữ nhật cửa sổ khi khởi chạy Activity; Android có thể bỏ qua.
- Việc chỉnh cửa sổ của **ứng dụng khác đã chạy** thường cần quyền hệ thống/quyền gỡ lỗi thích hợp; app thường không được phép tùy tiện resize mọi task.
- Trong APK tham khảo thấy chuỗi `am task resize`, nhưng **không có chứng cứ rằng bản cá nhân có thể chạy lệnh đó chỉ nhờ cài APK**.
- Phân biệt: hiển thị cửa sổ **của chính app camera** (trong quyền app) và điều khiển task **của app thứ ba** (phụ thuộc quyền ngoài ứng dụng).

## 3. Các cấp độ thực thi theo quyền
| Cấp | Công cụ | Khả năng dự kiến | Hạn chế |
|---|---|---|---|
| L0 | Intent / ActivityOptions | Mở app đích, đề nghị bounds | DeX/app đích có thể từ chối |
| L1 | DeX/freeform UI, người dùng | Cấu hình thủ công để khớp bố cục | Không tự cưỡng chế hoàn toàn |
| L2 | Cầu ADB hoặc Shizuku do chính chủ cấu hình | Có thể điều khiển task resize trong giới hạn hệ thống | Yêu cầu quyền thực, không mặc định tương thích |
| L3 | Root/system privilege | Có thể rộng hơn | **Ngoài phạm vi mặc định**, rủi ro cao, không tự triển khai |

**Nguyên tắc:** Luôn phát hiện capability thật; không hiện nút "đã áp dụng" nếu OS bỏ qua lệnh.

## 4. Hệ tọa độ / quy đổi
Mô hình đề xuất:
- `display_width_px, display_height_px, density, rotation`: đọc từ Android Display API.
- `usable_rect = display_bounds - insets (taskbar/system UI)` nếu phù hợp với version và kiểu cửa sổ.
- `bounds_abs = (left, top, width, height)` trên vùng gốc tham chiếu.
- `bounds_normalized = (xRatio, yRatio, wRatio, hRatio)` trong [0,1] so với vùng khả dụng.
- `pixel_rect = normalized_rect * usable_rect` khi áp dụng theo tỉ lệ.
- `applied_rect = readback task/window bounds` nếu có quyền; độ lệch `delta = applied_rect - requested_rect`.

### Vấn đề kiểm thử
- Tọa độ taskbar và thanh tiêu đề cửa sổ có thể được hệ thống cộng vào bounds; phải phân biệt **frame**, **content area** và **screen coordinates**.
- Kích thước tối thiểu của ứng dụng đích có thể ép lớn hơn cấu hình.
- Khi thay độ phân giải/HDMI/hub, không được tái áp tọa độ cũ mà chưa kiểm tra vùng hiển thị còn hợp lệ.
- Trường hợp màn hình 4K/DPI được ép logic xuống độ phân giải thấp hơn: phải theo giá trị Android báo, không suy ra chỉ từ thông số HDMI.

## 5. Profile & preset
```text
Profile
  profile_id
  display_fingerprint = vendor? + logical size + density + rotation + DeX mode
  launcher_policy = manual / after_dex_connect (owner-select)
  gaps_px
  elements:
    - package_name
    - activity_component (optional if OS resolves)
    - slot_id
    - relative_rect
    - absolute_rect
    - minimum_size_constraint
    - launch_order
    - allowed_fallback
  camera_slot:
    area
    behavior = overlay_app_region / floating_window
    return_policy = restore_snapshot
```
Gợi ý preset **chỉ là ví dụ để người dùng chọn**, không là cấu hình đã xác nhận:
- Hai ô 50/50.
- Hai ô 65/35.
- Ba ô (1 rộng + 2 hẹp).
- Bố cục tùy chỉnh kéo thay đổi ranh giới, sau đó xem/sửa trực tiếp X/Y/W/H.

## 6. Quy trình áp bố cục (đề xuất)
1. Kiểm tra phiên DeX, display, app đã cài, quyền điều khiển task.
2. Chuẩn hóa `desired_layout`, loại vùng âm/vượt màn hình và cảnh báo va chạm nếu preset cấm.
3. Chụp snapshot các cửa sổ đang ở DeX trước khi tác động (chỉ mức được phép).
4. Mở từng app theo đúng thứ tự và launch bounds; đợi task xuất hiện, không suy đoán sau 1 cú tap.
5. Nếu có quyền L2, resize theo `task_id` thật, xác nhận result code / readback.
6. Nếu thiếu quyền hoặc hệ thống bỏ qua, báo giới hạn; lưu `requested_bounds` và `actual_bounds` khác nhau.
7. Khi camera mở: đánh dấu snapshot `pre_camera_layout`; giữ task app trong nền.
8. Chỉ khôi phục khi có tín hiệu **R=OFF đã kiểm chứng**, hoặc người dùng chủ động thoát chế độ camera trong điều kiện an toàn. Nếu chỉ mất USB, luồng hình hoặc khung hình mà R còn ON/chưa xác định, giữ ảnh chụp bố cục và hiển thị cảnh báo `CAMERA_UNAVAILABLE`; không được tự coi đó là lệnh khôi phục. Khi đủ điều kiện, chỉ đảo các thay đổi do coordinator gây ra và không đóng ứng dụng khác.

## 7. Ràng buộc quyền & an toàn
- Không dùng Accessibility để giành quyền vượt giới hạn hoặc tự click vào UI nhạy cảm; mọi quyền đều có thông báo rõ.
- ADB/Shizuku nếu cần phải do Owner phê duyệt và thao tác hợp lệ trên thiết bị cá nhân; không bao giờ giả `WRITE_SECURE_SETTINGS` đã được cấp.
- Không tự đổi quyền thiết bị, USB debugging, bảo mật hoặc lệnh root.
- Không lấy nội dung màn hình các ứng dụng gọi xe/bản đồ nếu không phải yêu cầu chức năng và có quyền rõ ràng.

## 8. Các hành vi cần nghiệm thu
| Mã | Kịch bản | Kết quả |
|---|---|---|
| W-01 | Mở 2 app lần đầu | Các app đúng vùng nếu OS cho phép; nếu không phải nêu sai khác |
| W-02 | Áp 50/50, 65/35 | Tỉ lệ/tọa độ được lưu, dùng lại được |
| W-03 | Đổi kích thước màn hình | Điều chỉnh theo profile hoặc cảnh báo, không rơi mất cửa sổ |
| W-04 | App có kích thước tối thiểu | Không treo/lặp resize; báo giới hạn |
| W-05 | Chuyển R → camera → D | Chỉ trả bố cục sau khi R=OFF được chứng minh hoặc thao tác đóng có chủ ý trong điều kiện an toàn; không đóng ứng dụng khác |
| W-06 | Nhiều lần R nhanh | Không phát lại thao tác đóng/mở khiến cửa sổ bị đảo |
| W-07 | Android kill app | Có chiến lược phục hồi dựa vào state/dữ liệu cục bộ |
| W-08 | Thiếu quyền ADB | Có chế độ giảm tính năng, không báo thành công giả |
| W-09 | Camera không có frame khi R còn ON/UNKNOWN | Cảnh báo `CAMERA_UNAVAILABLE`, không hiện hình cũ, không tự trả bố cục |
| W-10 | Nhiều màn hình/HDMI thay đổi | Xác định đúng display ID trước khi đặt bounds |

## 9. Phần còn cần kiểm tra
Samsung model/One UI/DeX, quyền hiện tại, app đích, độ phân giải logic/DPI thực tế, task IDs, khả năng đọc lại bounds và lựa chọn phương thức điều khiển cửa sổ. Chưa chốt thư viện hay lệnh cụ thể trước nghiên cứu thiết bị.
