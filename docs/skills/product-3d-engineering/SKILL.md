# TIGERIQ — THIẾT KẾ CAD 3D (ACTIVE)

## Identity
- ID: product-3d-engineering
- Version: 0.4.0
- State: ACTIVE
- Target: physical-product-cad
- Source: GitHub main, `docs/skills/registry.yaml`. Công cụ PC01: `earthtojake/text-to-cad` (MIT), `cad==0.11.13`, cài cách ly; không đồng nghĩa mọi ứng dụng đều đã nạp.

## Trigger
- Chủ động áp dụng khi Owner yêu cầu **vẽ 3D, thiết kế 3D vật thể thực, giá đỡ, phụ kiện xe, in 3D, CAD, STL, STEP, 3MF, mô hình cơ khí, chỉnh file CAD**.
- Chỉ tạo ảnh minh họa 3D/hoạt hình: dùng công cụ tạo ảnh; **không** gọi ảnh AI là mô hình CAD/in được.
- Nạp theo mục tiêu; không nạp toàn bộ Skill và không chiếm quyền người viết khác.

## Input
- Ảnh, phác thảo, STL/STEP/3MF có sẵn, kích thước (mm), mục đích lắp, máy in, vật liệu, dung sai và hướng gá.
- Khôi phục số đo/nguồn đã có trước khi hỏi. Phân biệt kích thước lọt lòng/phủ bì; xung đột hình học phải làm rõ trước khi xuất sản xuất.
- Thiếu thông số thiết yếu thì đưa giả định rõ ràng cho bản nháp, không nhận là bản sẵn sàng chế tạo.

## Steps
1. Đọc `docs/3d/GOOGLE_DRIVE_DESTINATION.md` từ GitHub main để biết đích lưu mặc định.
2. Trên PC01 kiểm tra kết nối MCP OAuth, quyền và writer; dùng `cad --version` hoặc đường dẫn cài đặt đã xác minh. Dùng RDC chỉ khi MCP không hỗ trợ và đúng quyền.
3. Dựng hình có tham số bằng Python `build123d` qua `cad run`; nguồn hình học duy nhất cho file 3D, bản vẽ 2D và ảnh xem trước.
4. Kiểm tra mặt cắt, va chạm, dung sai, bề dày, số đo mm và điều kiện gắn/in. Giữ nguồn `.py` để sửa về sau.
5. Xuất STEP (CAD chỉnh sửa), STL (lưới) và 3MF (mô hình); không suy 3MF đã cắt lớp. Nếu cần bản vẽ kỹ thuật, xuất hình chiếu trước/trên/cạnh, mặt cắt từ **cùng mô hình**.
6. Kiểm tra STL đóng kín, mặt suy biến, kích thước; ảnh xem trước 4–6 góc lấy từ mô hình thật (không ảnh minh họa tráo đổi).
7. Với Bambu Lab P1S: dùng Bambu Studio PC01 và preset máy/vật liệu đã kiểm chứng; cắt lớp thực, kiểm tra khay, kích thước, hướng đặt, support, vật liệu, thời gian/khối lượng, log lỗi và file `.gcode.3mf` trước khi báo `SLICED_VERIFIED`. Xem `references/bambu-p1s-print-workflow.md`. Không dùng 3MF mô hình làm 3MF đã slice.
8. Sau khi Owner duyệt **đúng mẫu in** (máy, file/hash, vật liệu, màu, số lượng), xác minh P1S đang online/sẵn sàng, đường truyền hợp lệ và không có job đang in; chỉ sau đó gửi một lệnh in có khóa chống trùng, kiểm tra phản hồi và mã job. Không tự in khi chưa duyệt; không lặp lệnh nếu phản hồi không rõ.\n9. Upload tệp đã nghiệm thu vào Drive TigerIQ 3D; đọc lại mã tệp và `parent_ids` trước khi nói đã lưu.

## Tools / Output
- PC01 `D:\TigerIQ\Tools\text-to-cad-v0.11.13\Scripts\cad.exe`; Python 3.12; không cài lại nếu đã có.
- Trước mọi lệnh: `DO_NOT_TRACK=1`, `CAD_TELEMETRY=0`, `CAD_UPDATE_CHECK=0`; chỉ chạy server `127.0.0.1`, không phơi Internet, không chia sẻ token.
- Đầu ra: bảng số đo/giả định, mã nguồn `.py`, STEP/STL/3MF, ảnh xem trước, kiểm tra lưới; nếu P1S thì thêm preset, file `.gcode.3mf`, bằng chứng slice, trạng thái duyệt/gửi in, kết quả lưu Drive.
- Tài liệu chuyên sâu, xử lý hộc cửa gió/biên dạng/giải pháp chống trượt: `references/design-method.md` (đọc khi cần).

## Acceptance
- Công cụ CAD PC01 đã kiểm thử dựng bracket 40×20×6 mm, xuất STEP/STL/3MF; STL 124 tam giác, 186 cạnh khép kín, 0 mặt suy biến.
- Mọi thiết kế mới phải kiểm tra kích thước thực, tính kín, khả năng chế tạo và có bằng chứng file thực trước khi báo đạt.
- Chỉ báo `PRINT_SUBMITTED` khi P1S xác nhận nhận job, `PRINT_TESTED` sau khi có nghiệm thu mẫu in vật lý; `SLICED_VERIFIED` sau khi kiểm tra thực tế file `.gcode.3mf` trong Bambu Studio.

## Evidence
- `evidence/2026-11-20-pc01-cad-canary.md`.
- PC01: `JOB-TIGERIQ-CAD-INSTALL-20261120`, `JOB-TIGERIQ-CAD-SMOKE-RERUN-20261120`, `JOB-TIGERIQ-CAD-MESH-CHECK-20261120`.
- Skill được phép tự nạp ở TigerIQ Core **chỉ khi** registry main ACTIVE, đã hợp nhất và bề mặt đang chạy nạp đúng bản mới.

## Fallback
- PC01 offline/chưa được phép: hướng dẫn/thiết kế tham số từ nguồn đủ dữ liệu, ghi rõ chưa chạy kiểm chứng trên PC01.
- Không có trình cắt lớp: dừng ở `MODEL_UNSLICED`, không nói đã in.
- Không tải được lên Drive: báo `DRIVE_UPLOAD_PENDING`; không giả link.

## Safety
- Công cụ trên PC01 là gói ngoài, đã khóa `cad==0.11.13`; không cài phiên bản trôi, không chạy script cài tự động.
- Không sửa quyền, cấu hình bảo mật, tự phát hành dịch vụ, thanh toán hoặc thay đổi hệ thống ngoài phạm vi đã duyệt. Lệnh in P1S là tác vụ tác động vật lý: bắt buộc phê duyệt cụ thể, kiểm tra an toàn và chống gửi trùng.
- Tài liệu GitHub không thể ép tất cả phiên ChatGPT/Gemini tự cập nhật; mỗi bề mặt cần nạp và có chứng cứ riêng.

## Non-goals
- Không tạo Skill thứ hai hoặc hệ thống điều phối mới; không coi hình minh họa 3D là file CAD; không tự gọi `ACTIVE` trước khi hợp nhất/kiểm thử trên từng bề mặt.
