# TigerIQ Web Control — Functional Gap Audit
Date: 2026-09-04
Runtime: PC01 Command Center

## Kết luận
Giao diện hiện tại đã đọc dữ liệu runtime thật và có một số write path thật, nhưng chưa phải Control Center hoàn chỉnh. Nhiều thành phần vẫn chỉ là trình bày/anchor/read-only.

## Đang hoạt động thật
1. Đăng nhập bằng mã điều khiển nội bộ (`POST /login`).
2. Giao mục tiêu (`POST /jobs`) sau đăng nhập, có CSRF + idempotency; backend tạo GitHub Issue `TIGERIQ_JOB_V1` thật.
3. Đọc Work Order từ backend/GitHub projection.
4. Đọc telemetry PC01: Worker, Controller, Ollama, Tailscale, PostgreSQL, GPU khi probe trả dữ liệu.
5. Lọc Đội AI theo tên/trạng thái bằng query GET.
6. Xem chi tiết kỹ thuật bằng `<details>`.

## Chưa hoạt động / chỉ trình bày
1. Search box trên header không có form/action/JS -> không tìm gì.
2. Sidebar chỉ là anchor cuộn cùng trang; không phải module/page độc lập.
3. `Báo cáo` và `Cài đặt` đang là section hidden rỗng.
4. `Cần xem` không có action phê duyệt/từ chối/ủy quyền.
5. `Bằng chứng` chỉ hiển thị tổng số, không mở được evidence cụ thể.
6. Mô hình AI chỉ xem danh sách, chưa có thao tác gán/bật/tắt/kiểm tra model.
7. Đội AI chỉ xem/lọc, chưa giao/reassign/pause/resume AI từ UI.
8. Công việc chưa có cancel/retry/reassign/priority/edit từ UI.
9. Progress hiện là mapping suy diễn theo trạng thái (`12/18/30/38/45/68/100`), không phải phần trăm thực từ runtime.
10. Chevron ở hàng công việc chỉ nhảy tới anchor detail, không tự mở detail.
11. Chưa có refresh realtime/SSE/WebSocket; V4 phụ thuộc reload trình duyệt.
12. Chưa có action quản trị hệ thống từ UI (restart task, health recheck, updater status, logs).

## P0 phải hoàn thiện để gọi là Web Control thật
- Search thật.
- Work Order detail drawer/page thật: timeline, evidence, logs, AI, trạng thái, retry/cancel/reassign trong authority cho phép.
- Owner decision queue có Approve / Reject / Defer với audit + CSRF + idempotency + explicit authority gate.
- Evidence viewer thật.
- Đội AI: drill-down employee/model/current task + bounded operational actions.
- Hệ thống: health + updater version + last deploy + bounded restart/recheck actions.
- Báo cáo: dashboard 6 phần theo TigerIQ runtime contract.
- Cài đặt: read-only first; chỉ cho thay đổi non-sensitive options được ủy quyền.
- Progress phải lấy runtime truth hoặc ghi rõ `ước lượng`; tuyệt đối không trình bày số giả như số thực.
- Auto-refresh nhẹ 10–30s hoặc SSE; không spam.
- Toàn bộ thao tác có loading/success/error rõ ràng, tiếng Việt.

## Gate trước khi gọi HOÀN THÀNH
1. Unit/typecheck/build/Playwright PASS.
2. E2E thật trên PC01: login -> giao việc -> xuất hiện queue -> worker claim -> evidence -> terminal state -> UI phản chiếu.
3. Owner decision test: action thật + audit + idempotency.
4. Evidence drilldown đọc được record thật.
5. Search/filter thật.
6. Restart/reload browser không mất state server-side.
7. Không MAIN/Production/Vercel; deploy qua Artifact Updater V3 sau CI PASS.
