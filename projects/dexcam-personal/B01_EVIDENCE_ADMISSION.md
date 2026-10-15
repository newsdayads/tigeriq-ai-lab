# B01 — Cổng tiếp nhận chứng cứ thiết bị Android/DeX

Nguồn: [Work Order GH-4625](https://github.com/newsdayads/tigeriq-ai-lab/issues/4625). A06 đã được hợp nhất tại [commit 4706ea7](https://github.com/newsdayads/tigeriq-ai-lab/commit/4706ea7059ed0c4cc3d0931b84d9a784dfb2ceb6). **B01 chưa được nghiệm thu** vì không có dữ liệu đo thực tế.

Đây là công cụ kiểm tra dữ liệu ngoại tuyến: b01-evidence-admission.mjs. Nó không gọi USB, ADB, Android, mạng, file hệ thống, máy anh Sơn hay thay đổi cấu hình. Mọi dữ liệu thật được giữ riêng trên thiết bị; kho công khai chỉ chứa quy tắc và mẫu giả lập.

## Điều kiện nhận hồ sơ B01

- Android: hãng, **model máy thực tế sử dụng DeXCam**, phiên bản Android, API level, phiên bản One UI.
- DeX: đang hoạt động trên màn hình ngoài hay trên máy; phải có nguồn quan sát riêng.
- Display: mã màn hình logic, kích thước px, DPI, smallestWidthDp, xoay, bằng chứng đọc lại hệ thống. Không lấy độ phân giải quảng cáo làm dữ liệu đo.
- Chứng cứ: thời điểm quan sát dạng ISO 8601 có múi giờ, **ngày lịch thực sự tồn tại** (kể cả quy tắc năm nhuận), độ lệch UTC hợp lệ và không ở tương lai quá 5 phút so với đồng hồ máy đang chạy bộ kiểm tra; ba nhãn chứng cứ cục bộ dành cho màn hình cài đặt, DeX và display. Nếu đồng hồ máy sai, sửa nguồn thời gian đáng tin cậy; không thay ngày giả để qua cổng.
- Khi tự khai `REAL_DEVICE_OBSERVATION`, các nhãn thiết bị kiểu `SM-TEST`, `UNKNOWN`, `NOT_MEASURED`, `MOCK`, `DEMO`, `SAMPLE` bị từ chối. Giá trị khác chỉ là **đầu vào cần xem xét**; không chứng minh thiết bị thật và không tự chuyển B01 thành đạt.
- Tham chiếu ba loại chứng cứ phải là **ba mã `LOCAL_ONLY:` khác nhau**; không được dùng cùng một mã cho ảnh cài đặt Android, trạng thái DeX và kết quả display readback. Đây chỉ là kiểm tra cú pháp để ngăn lặp tham chiếu, **không chứng minh ba tệp thực sự khác nhau, dữ liệu thiết bị là thật hay B01 đã được nghiệm thu**.
- Bảo mật: loại bỏ IMEI, serial, biển số, VIN, tọa độ, nội dung màn hình riêng tư, video/log gốc và khóa. Không tải dữ liệu đó lên GitHub công khai. Không dùng máy từ chat cũ làm chứng cứ thiết bị đang kết nối.

## Mẫu tổng hợp — KHÔNG PHẢI MÁY THẬT

~~~json
{
  "schema": "dexcam-b01-v1",
  "capture_kind": "SYNTHETIC_FIXTURE",
  "observed_at": "2026-10-15T12:00:00+07:00",
  "android": {"manufacturer": "Samsung", "model": "SM-TEST", "android_version": "16", "api_level": 36, "one_ui_version": "8.0"},
  "dex": {"mode": "EXTERNAL_DISPLAY", "source": "LOCAL_ONLY:dex-screenshot-01"},
  "display": {"display_id": 1, "logical_width_px": 1920, "logical_height_px": 1080, "density_dpi": 240, "smallest_width_dp": 800, "rotation_deg": 0, "source": "LOCAL_ONLY:display-readback-01"},
  "evidence": {"android_settings": "LOCAL_ONLY:settings-01", "dex_observation": "LOCAL_ONLY:dex-01", "display_readback": "LOCAL_ONLY:display-01"},
  "redaction_confirmed": true
}
~~~

Trạng thái kiểm tra: INCOMPLETE = thiếu/chưa hợp lệ; SYNTHETIC_FIXTURE_ONLY = giả lập; CANDIDATE_NEEDS_DEVICE_REVIEW = đúng cấu trúc nhưng **chưa xác thực thông số**. Hàm inspectB01 **luôn** trả b01_accepted=false. Việc đánh dấu B01 đòi kiểm tra nguồn thiết bị thật và ghi bằng chứng đã loại thông tin riêng tư vào chính checklist Issue.

Chạy kiểm thử nguồn, không đụng thiết bị: node --test tests/dexcam-personal/b01-evidence-admission.test.mjs. Các ca chỉ chứng minh bộ kiểm tra dữ liệu hoạt động, không nghiệm thu APK/USB/R/camera.

B02–B05 yêu cầu quan sát thiết bị, USB và số R riêng; không thể suy từ B01 đã đủ. Không yêu cầu thao tác trong lúc lái xe hoặc thử dây điện.
