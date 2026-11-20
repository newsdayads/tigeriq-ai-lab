# Bambu Lab P1S — Quy trình in từ ChatGPT qua PC01

## Căn cứ đã kiểm tra 20/11/2026
- PC01 có `C:\Program Files\Bambu Studio\bambu-studio.exe` (file version 02.09.01.70), profile tại `%APPDATA%\BambuStudio`; có cấu hình máy trong `printers`.
- Có pipeline cắt lớp thật: `D:\TigerIQ\Artifacts\bambu_v39_20261118\TIGERIQ_V39_P1S_PETG_DEN_012_DA_SLICE.gcode.3mf`, `plate_1.gcode`, `machine.json`, `filament.json`, `process.json`, `result.json`, `VERIFICATION.json`. Tồn tại artifact **không tự chứng minh** job in được gửi thành công hoặc mẫu in đạt.
- Owner xác nhận PC01 từng in được trên P1S. Đây là thông tin từ Owner; chưa có biên nhận kết nối/in trực tiếp trong phiên kiểm tra này.
- `text-to-cad` chỉ dựng hình CAD; điều khiển P1S phải dùng Bambu Studio/đường truyền máy in hiện hữu và cổng phê duyệt riêng.

## Trình tự bắt buộc
1. Nhận lệnh từ điện thoại: `Vẽ 3D ... và chuẩn bị in P1S`. Lấy ảnh/kích thước, vật liệu, màu, số lượng, kích thước bàn in; không đoán chi tiết ảnh hưởng lắp ghép.
2. Trên PC01 qua MCP OAuth, kiểm tra `cad`, Bambu Studio, profile P1S và các preset máy/filament/process đã được nghiệm thu. Không cài thêm driver, plugin, mở cổng hoặc sửa quyền.
3. Dựng CAD tham số; xuất STEP/STL/3MF từ cùng hình học. Kiểm tra manifold, mm, độ dày, dung sai, kích thước bàn in.
4. Dùng **Bambu Studio đã cài** và preset P1S đúng loại nhựa; cắt lớp ra `.gcode.3mf`. Kiểm tra log, chiều in, support, va chạm, thời gian/khối lượng; giữ `result.json`, `plate_1.gcode`, file nguồn và biên nhận. Không tái sử dụng file gcode của mẫu khác.
5. Báo Owner bản xem trước và thông số: tên mẫu, phiên bản/hash file, P1S đích, vật liệu/màu, số lượng, thời gian và khối lượng dự kiến. Trạng thái `AWAITING_PRINT_APPROVAL`. **Không gửi lệnh in trước khi có xác nhận rõ cho job cụ thể.**
6. Sau khi được duyệt, kiểm tra trạng thái P1S hiện thời (online, không lỗi, không có job đang chạy, đúng nhựa/khay, đủ điều kiện an toàn). Dùng **chính cơ chế gửi in đã được kiểm chứng trên PC01**, không tự sáng tạo endpoint/MQTT/token; gửi một lần, dùng idempotency key và ghi receipt. Không thử lại khi kết quả gửi chưa rõ; truy vấn job trước.
7. Chỉ báo `PRINT_SUBMITTED` khi có phản hồi nhận job của P1S; `PRINTING` khi có trạng thái chạy; `PRINT_COMPLETED` khi máy báo hoàn tất; `PRINT_TESTED` khi đã kiểm tra mẫu vật lý. Nếu mất kết nối báo `PRINTER_UNVERIFIED`, nếu thiếu cổng duyệt báo `AWAITING_PRINT_APPROVAL`.
8. Lưu bản thiết kế và chứng cứ lên Drive TigerIQ 3D; kiểm tra lại `parent_ids`. Không đăng token, IP nội bộ, access code máy lên GitHub/Drive.

## Giới hạn
- Chưa kiểm chứng từ xa phương thức gửi job, serial/địa chỉ máy và trạng thái online trong phiên 20/11; không được giả `DIRECT_PRINT_READY`.
- Không tự in hàng loạt, không tự khởi động lại máy, không thay filament hoặc đổi cấu hình an toàn.
- Phân biệt `MODEL_READY`, `SLICED_VERIFIED`, `PRINT_SUBMITTED`, `PRINT_COMPLETED`, `PRINT_TESTED`.
