# WO-261 — WEB CONTROL FUNCTIONAL V1

## Mục tiêu
Biến Owner Cockpit hiện tại từ dashboard phần lớn read-only thành Web Control vận hành thật, giữ giao diện đã chốt và không yêu cầu anh Sơn thao tác PC.

## P0 phạm vi
1. Tìm kiếm thật cho Công việc + AI + mô hình.
2. Chi tiết Công việc thật: mục tiêu, lifecycle, người phụ trách, bằng chứng, gate, log tóm tắt.
3. Hàng chờ `Cần anh Sơn`: hành động Duyệt / Từ chối / Để sau, có CSRF + idempotency + audit + authority fail-closed.
4. Evidence viewer thật theo Work Order.
5. Đội AI: drilldown trạng thái/model/current task; chỉ bounded action đã được phép.
6. Hệ thống: updater version, installed SHA, health, last deploy/result; bounded recheck/restart nếu action đã allowlist.
7. Báo cáo: dashboard 6 phần tiếng Việt từ state thật.
8. Cài đặt: read-only trước; không security-sensitive/credential changes.
9. Progress: runtime truth hoặc nhãn `ước lượng`; không giả phần trăm.
10. Auto-refresh nhẹ hoặc SSE, không spam.

## Không làm
- Không MAIN/Production/Vercel.
- Không mở public network.
- Không raw shell/PowerShell từ Web.
- Không sửa credential/firewall/security policy.
- Không paid service.

## DONE
- CI + Playwright PASS.
- Artifact Updater V3 tự deploy PC01.
- Physical E2E: login -> giao việc -> PC01 nhận -> evidence -> trạng thái cuối -> UI phản chiếu.
- Owner decision action có evidence/audit thật.
- Search/evidence/system/report routes hoạt động thật.
- Không còn nút/section chính giả chức năng; mục chưa triển khai phải ghi rõ `Chưa khả dụng` thay vì giả clickable.
