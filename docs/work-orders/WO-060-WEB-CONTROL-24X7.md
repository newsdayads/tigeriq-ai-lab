# WO-060 — TigerIQ Web Control 24/7

Status: ACTIVE
Priority: P1
Owner: Vy / GitHub engineering lane
Started: 2026-09-12

## Mục tiêu
Tạo Web Control điều hành TigerIQ Core 24/7 theo layout Owner đã chốt, dùng dữ liệu thật, chạy ổn định và chỉ tích hợp sau khi kiểm thử đạt.

## Hard boundary
- KHÔNG thay thế hoặc sửa hành vi TigerIQ API Health hiện tại ở `/`.
- KHÔNG đổi `/health` hoặc `/api/status` ngoài phần mở rộng tương thích ngược đã được test.
- KHÔNG dùng PC01 để code/build/deploy.
- KHÔNG thay credential/provider, paid service, reboot, destructive action.
- Web Control giai đoạn đầu chỉ đọc.

## Phân rã
1. AUDIT — đối chiếu ảnh thiết kế, dữ liệu `snapshot()` và route Core.
2. BUILD ISOLATED — tạo `web-control.html` riêng, chưa route vào runtime.
3. VERIFY — unit/CI + rà dữ liệu thật, responsive, lỗi mất kết nối, không fake trạng thái.
4. INTEGRATE — chỉ khi gate 3 đạt: thêm route `/web-control`, giữ nguyên `/`, `/health`, `/api/status`.
5. RETEST — chạy toàn CI và regression API Health/Web Control.
6. RELEASE GATE — chỉ gộp main khi checks/review hợp lệ; sau cập nhật runtime phải xác minh API Health vẫn hoạt động và Web Control hoạt động.
7. EVIDENCE — lưu PR/check/result và cập nhật CURRENT_STATE/CENTRAL khi hoàn tất.

## Acceptance
- Web Control có: Tổng quan, Nhân sự AI, Công việc, Mục tiêu, Lịch sử, Giám sát hệ thống, Cài đặt.
- Tổng quan có status cards, sơ đồ nhân sự/hệ thống, Job Pipeline, Objective, Workforce Board, cảnh báo/sự kiện.
- Mọi số liệu vận hành lấy từ `/api/status`; mất kết nối hiển thị rõ.
- Responsive desktop/tablet/mobile, không overflow/chồng/cắt nghiêm trọng.
- API Health root vẫn đúng sản phẩm cũ và không regression.
- CI đạt trước integration và sau integration.

## Evidence
- Branch: `vy/web-control-24x7-20260912`
- PR: #602
