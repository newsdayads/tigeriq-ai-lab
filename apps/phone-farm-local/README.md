# TigerIQ Phone Farm — bản điều khiển Android cục bộ (DEV)

Mã nguồn độc lập, không dùng thư viện hoặc máy chủ xác thực LAIXI. **Chưa nghiệm thu FULL.** Không giới hạn số thiết bị bằng giấy phép; giới hạn thực tế phụ thuộc phần cứng và mạng ADB.

## Cấu hình PC01

- Windows + Node.js 20 trở lên, ADB `D:\TigerIQ\Tools\platform-tools\adb.exe`, scrcpy `D:\TigerIQ\Tools\scrcpy\scrcpy-win64-v4.1\scrcpy.exe`.
- Điện thoại đã cấp quyền gỡ lỗi Android cho PC01.
- Chạy tại `apps/phone-farm-local`: `node --test test.mjs` và `node app.mjs`.
- Truy cập **trên PC01**: `http://127.0.0.1:8765/`. Ứng dụng chỉ bind `127.0.0.1`, không mở cổng LAN.
- Nếu cần đổi đường dẫn: biến môi trường `TIGERIQ_ADB`, `TIGERIQ_SCRCPY`, `TIGERIQ_PHONE_FARM_PORT`.

## Chức năng có mã nguồn

- Tìm/đổi tên thiết bị USB/WiFi ADB; ảnh màn hình PNG; chạm, vuốt, phím và nhập liệu ASCII; đồng bộ theo nhóm. Mở scrcpy riêng.
- Đọc ứng dụng bên thứ ba: `GET /api/packages?serial=...`.
- Các hành động nhóm: `POST /api/batch` với `install` (APK), `upload` (tệp tới `/sdcard/Download/TigerIQ/`), `launch`, `forceStop`.
- Chỉ cho phép các tên tệp an toàn trong thư mục `drop/` bên cạnh `app.mjs`. Sao chép APK/tệp từ Windows vào thư mục này **trước** khi yêu cầu ứng dụng gửi/cài.
- Kịch bản JSON giới hạn 50 bước, chỉ cho phép `tap`, `swipe`, `key`, `text`, `wait`; có chạy nhóm, theo dõi tiến độ và hủy. API `/api/macro/start`, `/api/macro/status`, `/api/macro/stop`. Không chấp nhận lệnh shell tự do.
- Lịch chạy cục bộ lưu `schedules.json`: chạy một lần hoặc lặp mỗi 1–1440 phút, nhận diện lịch trễ trên 1 giờ để không tự chạy bù. API `/api/schedules` GET/POST và `/api/schedules/delete` POST. Yêu cầu ứng dụng Node luôn đang chạy khi đến thời điểm hẹn.

Ví dụ kịch bản an toàn trong giao diện:

```json
[{"action":"key","key":"HOME"},{"action":"wait","ms":500}]
```

## Bằng chứng PC01 24/10/2026

- Kiểm thử Node.js **12/12 PASS**. Bộ lịch lưu sau khởi động và skip lịch quá hạn đã kiểm thử unit; tạo→đọc→xóa lịch bằng API đạt.
- 1 Samsung thật: liệt kê thiết bị, 49 gói ứng dụng bên thứ ba, hiển thị màn hình; API HOME thành công.
- Tệp `tigeriq-smoke.txt` được upload tới Android, hash SHA-256 khớp hai đầu: `773f22f660572e85148c3ece4b51113de2a2e58f9584fb44bc21c7492edae6ce`; đã xóa tệp sau kiểm thử.
- Macro nhóm thử trên 1 máy: HOME → đợi 500ms → HOME, 3/3 bước, trạng thái `completed`, không lỗi.
- Chưa chứng minh APK được cài thật. Quy trình tạo thử APK bị chặn ở bước ký; không can thiệp thêm.

## Hạn chế / kiểm thử còn thiếu

- Native upstream ADB Device Farm v3.0.0 đã hiển thị 1 điện thoại và chụp ảnh thành công; tham khảo `NATIVE_AUDIT_20261024.md`. Chưa được đóng gói dưới thương hiệu TigerIQ.
- Bản Node này chưa có phát trực tiếp video trong lưới, script Auto.js, quay phim, chuyển nhiều PC, ghi màn hình hàng loạt hay bản EXE. Lịch lưu cục bộ đã qua unit/API nhưng chưa nghiệm thu tác vụ kích hoạt đúng giờ trên thiết bị thực và phục hồi sau lỗi runtime.
- Chưa kiểm thử 2+ điện thoại thật và chế độ mất Internet hoàn toàn. **Không được ghi nhận bản FULL hoặc không giới hạn vật lý.**
- Trước khi chạy, người dùng phải chọn thiết bị; các lệnh ADB bị giới hạn và đầu vào có kiểm tra. Không tắt Play Protect, không sửa quyền root, không vá bản quyền.
- Dừng `node app.mjs` để ngắt dịch vụ; xóa thư mục DEV nếu cần gỡ. Không sửa dữ liệu LAIXI.

Theo dõi: [GH-5291](https://github.com/newsdayads/tigeriq-ai-lab/issues/5291), [PR-5292](https://github.com/newsdayads/tigeriq-ai-lab/pull/5292).
