# TigerIQ Owner Cockpit — UI Rework Plan
Date: 2026-09-04
Target runtime: PC01 Command Center / artifact updater V3
Target branch: wo250/command-center-artifact-updater-v3

## Mục tiêu
Đưa Owner Cockpit về đúng vai trò bảng quản trị tiếng Việt, dễ đọc trong một màn hình, bám bộ mockup TigerIQ đã thống nhất, không làm mất dữ liệu runtime thật.

## P0 — Sửa ngay
1. Thuần Việt toàn bộ lớp trình bày:
   - Work Order -> Công việc
   - Evidence -> Bằng chứng
   - AI Workforce -> Đội AI
   - Model Registry -> Mô hình AI
   - Owner Cockpit / Mockup Implementation -> Bảng điều hành TigerIQ
   - Native Worker -> Bộ thực thi PC01
   - Controller -> Bộ điều phối
   - Telemetry -> Trạng thái hệ thống
   - Online/Offline -> Hoạt động/Ngắt kết nối
   - Không đổi tên kỹ thuật ở dữ liệu nội bộ/API, chỉ đổi label UI.

2. Bỏ bố cục top-nav hiện tại, khôi phục cấu trúc quản trị theo mockup:
   - Sidebar trái cố định.
   - Tổng quan
   - Công việc
   - Đội AI
   - Mô hình AI
   - Bằng chứng
   - Báo cáo
   - Hệ thống
   - Cài đặt
   - Desktop ưu tiên 1366–2048px, mobile responsive riêng.

3. Chuẩn icon:
   - Một hệ line-icon thống nhất, 16–18px, stroke đồng nhất, không trộn emoji/ký tự Unicode rời rạc.
   - Icon theo chức năng: Home/Tổng quan, Clipboard/Công việc, Users/Đội AI, Brain/Mô hình AI, ShieldCheck/Bằng chứng, Chart/Báo cáo, Server/Hệ thống, Settings/Cài đặt.
   - Tiger logo chỉ dùng cho brand, không dùng thay icon chức năng.

4. Font và typography:
   - Một font stack duy nhất: Segoe UI Variable, Segoe UI, Arial, sans-serif.
   - Body 14px; nội dung chính 14–15px; card title 14–16px; H1 tối đa 28px desktop.
   - Line-height 1.45–1.55.
   - Không dùng chữ quá nhỏ 9–10px cho thông tin cần đọc thường xuyên.
   - Chỉ dùng uppercase cho nhãn ngắn, không dùng cho câu dài.

5. Bố cục dữ liệu:
   - Không đổ nguyên instruction tiếng Anh dài vào card chính.
   - Card công việc chỉ hiển thị: mã, tên ngắn, trạng thái, người/AI phụ trách, tiến độ, thời gian cập nhật.
   - Mở chi tiết mới hiện mô tả đầy đủ, log, technical evidence.
   - Khu 'Cần anh Sơn' chỉ hiển thị quyết định thực sự cần Owner, không lặp toàn bộ nội dung công việc.

6. Responsive/CSS:
   - Loại bỏ cảm giác trang bị co nhỏ giữa màn hình.
   - Desktop content dùng toàn chiều rộng khả dụng sau sidebar; không max-width 1560 + centered theo cách làm UI bị nhỏ khi zoom/layout thay đổi.
   - 1366, 1440, 1920, 2048px phải giữ mật độ đọc ổn định.
   - Không có panel cao quá mức; danh sách dài dùng table/list với row compact, không card văn bản khổng lồ.

## Cấu trúc màn hình đề xuất
### Header
- TigerIQ AI Lab
- Trạng thái PC01
- Tìm kiếm
- Nút Giao việc

### Dashboard chính
- Hàng KPI: Đang làm / Chờ quyết định / Hoàn thành / Lỗi
- Công việc đang chạy: bảng compact
- Cần anh Sơn: panel nhỏ bên phải
- Đội AI: bảng trạng thái
- Hệ thống: collapsed by default

## Màu
Giữ dark theme và accent của TigerIQ:
- Nền: #071019 / #0d1824
- Viền: #203246
- Cam TigerIQ: #ff9b21
- Xanh hoạt động: #35d990
- Xanh tiến độ: #55aaff
- Vàng chờ: #ffc45e
- Đỏ lỗi: #ff6375

## DONE criteria
- 100% label điều hành hiển thị tiếng Việt, ngoại trừ tên sản phẩm/model/protocol bắt buộc.
- Không còn emoji/ký tự icon hỗn hợp trong UI chính.
- Một font stack thống nhất.
- Không còn instruction dài chiếm toàn card ở trang Tổng quan.
- Sidebar/icon đúng hệ TigerIQ mockup.
- Visual smoke ở 1366x768, 1920x1080 và mobile.
- Unit/typecheck/build/CI PASS.
- Artifact V3 tự cập nhật PC01 và health PASS.
- Không MAIN/Production/Vercel deploy.