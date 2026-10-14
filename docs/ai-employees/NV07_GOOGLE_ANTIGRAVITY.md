# NV07 — Google Antigravity: nhân sự AI đề xuất kỹ thuật

**Quản trị:** Registry #335 v57, Owner 2026-10-15; NV07 ngừng RETIRED theo quyết định Owner. **Hiện trạng:** ADMIN_ENABLED / PROVISIONING / NOT_YET_ROUTABLE; không được tự xưng ACTIVE.
**Mục tiêu:** nhận nhiệm vụ kỹ thuật P1–P5 có giới hạn, phối hợp GitHub, trả bằng chứng sau nghiệm thu.

## Ranh giới triển khai bắt buộc
- `docs/EXECUTION_BOUNDARY.md` trên GitHub `main` yêu cầu PC01 chỉ dành cho runtime/thiết bị; không tạo/sửa commit hoặc chạy build/tests mã nguồn thường bằng lệnh trên PC01.
- NV07/Antigravity trên PC01 chỉ được dùng để **đọc metadata cho phép và sinh đề xuất** có cấu trúc; mọi sửa code, branch/PR, CI thuộc executor GitHub riêng được cấp quyền.
- App Chrome LOCAL-only giữ quyền Owner/Vy. NV07 không có P0, quyền OS-admin vô hạn, mua dịch vụ, truy cập bí mật, cấp/sửa credentials, vượt bảo vệ release hay tự duyệt PR.

## Nguồn và môi trường
- Windows PC01 đã thấy Google Antigravity và Antigravity IDE; phiên `wdragons12x` có workspace `D:\TigerIQ\Workspace\tigeriq-ai-lab` và Git origin đúng.
- Cần xác minh nguồn bộ cài/chữ ký, CLI chính thức `agy`, user-session auth, gói quota/cost. RDC shell `SYSTEM` không chứng minh Antigravity trong phiên user đã đăng nhập.
- Thư mục `D:\TigerIQ\DriverRepo-Antigravity` thuộc repo `newsdayads/drivetrack`, không được dùng làm workspace cho NV07 TigerIQ.
- CLI documentation: https://www.antigravity.google/docs/cli/install/ and https://www.antigravity.google/docs/cli/headless/.

## Chuỗi giao việc dự kiến
Owner → Vy → Core queue (#280) với lease và scope → adapter NV07 trên PC01 (read-only proposal JSON, không source write) → GitHub executor độc lập → branch/PR/test → reviewer/CI → Core receipt, thời gian và trạng thái.
Pure source preflight/CLI parser/routing checker không đồng nghĩa OS/CLI được bảo vệ thật; cần adapter host có authenticated session, provenance, live lease, permission allow/deny, timeout/cancellation, idempotency và heartbeat.

## Cổng nghiệm thu
1. Registry và lệnh `7` phân biệt NV07 hiện tại với lịch sử ChatGPT Go (#548); NV03 vẫn ChatGPT Go, NV05 vẫn RETIRED.
2. CLI cài chính thức và đăng nhập đúng phiên; chạy một lệnh chỉ đọc trả status=SUCCESS JSON với bằng chứng xác thực.
3. Core thực sự giao đúng job với lease, deadline, idempotency, receipt và heartbeat mới.
4. NV07 trả JSON proposal đúng scope. GitHub executor riêng áp dụng một thay đổi vô hại qua PR, CI và review bắt buộc.
5. Phát hành PC01 đúng SHA thông qua cơ chế ký riêng theo #504 nếu áp dụng; canary âm và rollback đạt.
6. Chỉ khi hoàn tất các cổng trên mới chuyển NV07 ACTIVE và đóng #4783.

**Theo dõi:** kế hoạch #4783, các nhiệm vụ #4785–#4790; không mặc định DONE chỉ vì PR source đã merge.
