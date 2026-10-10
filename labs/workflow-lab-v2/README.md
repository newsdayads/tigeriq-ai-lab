# Workflow Lab V2 — dự án → công việc → một sơ đồ

Nguồn thử nghiệm từ hai video Owner gửi, kế thừa Lab V1 tại Issue #4627. Issue V2: #4629.

## Mục tiêu thiết kế
- Cấp 1: Danh mục **5 dự án mẫu**.
- Cấp 2: Danh sách **17 việc mẫu**, có tìm kiếm và lọc theo trạng thái.
- Cấp 3: **mỗi lần chỉ một sơ đồ 9 bước**, chọn node xem bàn giao, ghi chú và nhật ký.
- Các trạng thái chạy, bị chặn, chờ, xong đều là **SIMULATION ONLY**.
- Chuyển qua lại giữa hai việc phải giữ tiến độ mô phỏng riêng trong phiên trình duyệt; không bịa trạng thái Core.

## Tách biệt
- Chỉ tệp `labs/workflow-lab-v2/**` của PR nháp trên branch riêng.
- Không sửa các trang `public/**`, `apps/**`, `api/**`, `index.html`, `vercel.json`, `public/sw.js`.
- Dự án Vercel riêng `tigeriq-workflow-lab-v2`, không dùng domain/alias dự án `tigeriq-ai-lab` hoặc `tigeriq-workflow-lab-v1`.
- Không fetch API/GitHub/Core, không dùng token, không ghi bảng điều phối, không thuê dịch vụ mới.
- Không hợp nhất main hay thay đổi hệ thống cũ trước khi Owner chấp nhận.

## Kiểm thử Chromium thực hiện trong môi trường cục bộ
- Desktop 1440×950 và mobile 390×844: hiển thị 5 dự án, không tràn ngang, không lỗi JavaScript.
- Vào TigerIQ Core (4 việc mẫu), mở DEMO-CORE-01, sơ đồ đúng 9 node, bấm bước tiếp.
- Quay lại danh sách và mở lại DEMO-CORE-01: tiến độ khôi phục trong phiên.
- Gây lỗi mô phỏng, phục hồi. Mở DEMO-CORE-02: nhận trạng thái blocked riêng.
- Tìm kiếm dự án theo “news” chỉ trả một thẻ.
- Kết quả cục bộ: các kịch bản trên PASS, **không thay thế nghiệm thu trên URL Vercel thật**.

## Ranh giới nghiệm thu
- Vercel READY đúng project riêng và file HTML source readback.
- Không đổi deployment và alias production TigerIQ, không đổi V1.
- Có thể cần đăng nhập Vercel do SSO; không nới cổng bảo vệ.
- Chưa đưa dữ liệu thật vào trang; nếu Owner đồng ý sẽ mở riêng giai đoạn API chỉ đọc.
