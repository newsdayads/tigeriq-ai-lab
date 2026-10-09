# TIGERIQ WORKFLOW LAB V1 — MẪU ĐỘC LẬP

**Phạm vi:** Một màn hình = một công việc. Dữ liệu hoàn toàn mô phỏng, không có kết nối mạng hay ghi vào Core, GitHub, PC01, App Chrome.

## Hai nguồn tham chiếu hình ảnh
- Video 1 (Claude): mô hình công việc / phiên làm việc, chia nhánh nhiệm vụ, kết quả và ghi chú bàn giao. Video không cung cấp chứng cứ về giao tiếp tự động thực tế giữa mọi chat.
- Video 2 (OpenAI Dots): sơ đồ luồng 6 giai đoạn, các nhánh song song, màu trạng thái, thanh tiến trình và nhật ký phía dưới. Video hiển thị nhãn mô phỏng.

## Đã xây trong V1
- Một công việc `DEMO-WF-001`, 9 nút trong 6 giai đoạn và 3 nhánh xử lý song song.
- Đồ thị ưu tiên đọc được trên điện thoại, trạng thái chờ / đang làm / hoàn tất / bị chặn.
- Bấm khối mở ngăn chi tiết: mục tiêu, người thực hiện, đầu vào, đầu ra dự kiến và biên nhận bàn giao minh họa.
- Chạy tự động mô phỏng / tiến từng bước / tạm dừng / đặt lại.
- Giả lập lỗi mất phản hồi và khôi phục bằng bàn giao lại, không nhảy cóc sang trạng thái hoàn tất.
- Nhật ký mô phỏng có bộ lọc và xuất JSON; không có truy cập máy chủ.

## Kịch bản nghiệm thu trực tiếp
1. Mở file `TigerIQ_Workflow_Lab_V1.html` bằng trình duyệt.
2. Bấm **TỰ CHẠY MÔ PHỎNG**: sơ đồ đi đến 9/9 và dừng.
3. Bấm **ĐẶT LẠI**, **BƯỚC TIẾP** hai lần: ba nhánh cùng báo đang làm.
4. Bấm **THỬ LỖI**: nhánh lập trình bị chặn, các bước phía dưới không chuyển sang hoàn tất.
5. Bấm **KHÔI PHỤC & BÀN GIAO LẠI**: có sự kiện chuyển lại việc, gói dữ liệu được giữ trong mô phỏng.
6. Bấm một khối: mở ngăn chi tiết; đóng bằng nút × hoặc phím Esc.
7. Lọc **BÀN GIAO**; bấm **XUẤT NHẬT KÝ JSON**.
8. Kiểm tra iPhone/desktop: không cuộn ngang toàn trang.

## Kiểm thử tự động đã chạy
- Playwright / Chromium ở 1440×1050 và 390×844: PASS.
- Thử nút, trạng thái, ngăn chi tiết, nhật ký lọc, xuất JSON: PASS.
- Ba nhánh cùng chạy: PASS.
- Nhánh lỗi và khôi phục: PASS.
- Tự chạy đến trạng thái 9/9: PASS.
- Không có lỗi JavaScript hay yêu cầu mạng bên ngoài trong các kịch bản kiểm thử: PASS.

## Điểm chưa thực hiện
- Chưa có bộ chuyển tiếp giao việc thật hoặc xác thực danh tính chat/AI.
- Chưa có kết nối chỉ đọc Core, thời gian thực, biên nhận bền vững và xác minh chéo nguồn.
- Chưa thử phát hành ứng dụng trên Vercel, chưa nghiệm thu với người sử dụng trên thiết bị thật.
- Không dùng V1 để xác nhận Core hay nhân sự AI đang hoạt động.

## Lộ trình tích hợp sau nghiệm thu giao diện
1. Đóng băng giao diện V1 sau khi Owner duyệt bằng mắt.
2. Thiết kế ánh xạ trạng thái từ các WorkItem/Job/Event và bằng chứng Core hiện có: `jobId`, `scope`, `parentId`, `stage`, `assignedWorker`, `evidence`, `handoffReceipt`, `updatedAt`.
3. Bộ chuyển đổi **chỉ đọc**, dữ liệu giả lập tách hoàn toàn dữ liệu thật; trạng thái thiếu chứng cứ = chưa xác minh.
4. Kiểm thử ẩn thông tin riêng, giới hạn tốc độ, dữ liệu cũ, mất kết nối, quyền xem.
5. Chỉ sau khi có phê duyệt và cổng kiểm thử đầy đủ mới cho phép các hành động giao việc qua Core; không tạo hàng đợi điều phối thứ hai; có cơ chế quay lui.

**Quy tắc an toàn:** Không sửa App Chrome; không ghi main trực tiếp; không cấp quyền nhạy cảm; không có chi phí; không ảnh hưởng lịch trình thực thi Core.

## Đường triển khai an toàn 2026-10-10
- Công việc GitHub: https://github.com/newsdayads/tigeriq-ai-lab/issues/4627
- Mã nguồn thử nghiệm trong `labs/workflow-lab-v1/index.html`; không ghi `public/**`, `apps/**`, `api/**`, `vercel.json` hay `index.html` hiện có.
- Vercel: dự án riêng `tigeriq-workflow-lab-v1`, môi trường preview, không chạm `tigeriq-ai-lab` hiện tại.
- Bản demo hoàn toàn mô phỏng, không được báo đang thực thi Core thật.
- Chỉ sau khi Owner duyệt giao diện và hoàn tất cổng kiểm thử mới đề nghị tích hợp từng bước.
