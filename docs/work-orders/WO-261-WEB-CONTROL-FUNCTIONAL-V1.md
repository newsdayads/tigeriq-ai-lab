# WO-261 — WEB CONTROL FUNCTIONAL V1

## Mục tiêu
Biến Owner Cockpit hiện tại từ dashboard phần lớn read-only thành Web Control vận hành thật, giữ giao diện đã chốt và không yêu cầu anh Sơn thao tác PC.

## Kiến trúc chốt
`Trình duyệt anh Sơn -> Owner Cockpit V5 (PC01 private/Tailscale) -> Command Center backend -> GitHub queue/evidence -> Secure Worker V3 -> PC01/AI -> lifecycle/evidence -> Owner Cockpit`.

Nguyên tắc:
- UI chỉ hiển thị dữ liệu thật; phần không có dữ liệu thật phải ghi `Chưa khả dụng`.
- Mọi write action cần session + CSRF + idempotency và chỉ đi qua action allowlist.
- Không raw shell/PowerShell từ Web.
- GitHub issue/comment là audit trail cho quyết định Owner và command queue; local event journal vẫn giữ state runtime.
- Artifact Updater V3 là kênh phát hành duy nhất của PC01 Command Center; không dùng Git workspace để deploy.

## Kế hoạch thực hiện một lần
### Giai đoạn A — Data contract và điều hướng thật
1. Search server-side cho Công việc + AI + model.
2. Mỗi Công việc mở được detail thật từ GitHub issue/lifecycle comments.
3. Evidence viewer hiển thị marker, timestamp, kết quả, issue URL; không chỉ đếm số.
4. Sidebar trỏ tới section có nội dung thật; bỏ section rỗng/hidden.

### Giai đoạn B — Quyết định Owner có audit
1. `Cần anh Sơn` chỉ chứa việc thực sự cần quyết định.
2. `Duyệt`: ghi `TIGERIQ_OWNER_DECISION_V1` vào issue nguồn và tạo continuation Work Order mới để PC01 tiếp tục.
3. `Từ chối`: ghi audit marker rồi đóng issue nguồn.
4. `Để sau`: ghi audit marker, không thay đổi execution state.
5. Chống bấm lặp bằng idempotency key; fail-closed nếu không xác định được issue nguồn.

### Giai đoạn C — Hệ thống và bounded actions
1. Hiển thị PC01/Worker/Ollama/Tailscale/Controller/PostgreSQL thật.
2. Đọc `updater-v3-state.json` + `current-release.txt`: installed SHA, kết quả deploy cuối, thời gian cập nhật.
3. `Kiểm tra lại hệ thống`: tạo deterministic `system.status` command qua Secure Worker V3.
4. Chỉ expose restart khi action nằm trong allowlist hiện hành; không thêm shell/registry/firewall/credential action.

### Giai đoạn D — Đội AI / Mô hình AI
1. Drilldown AI: role, model, current tasks, availability, load.
2. Model list từ Ollama thật.
3. Nếu chưa có deterministic allowlist cho reassign/model switch thì UI ghi rõ `Chưa khả dụng`, không tạo nút giả.

### Giai đoạn E — Báo cáo và cài đặt
1. Báo cáo 6 phần từ state thật: Tổng tiến độ / Hạng mục chính / P0 Vướng mắc / Đang xử lý / Nhân sự AI / Mốc kế tiếp.
2. Cài đặt chỉ đọc: kênh release, refresh, private bind, updater state; không đổi credential/security.
3. Progress: nếu không có % runtime thật thì hiển thị `Ước lượng theo trạng thái`, không trình bày như số đo thật.

### Giai đoạn F — Gate và tự xuất bản
1. Unit/typecheck/Playwright/build PASS.
2. PR vào `wo250/command-center-artifact-updater-v3` chỉ sau CI PASS.
3. Release bundle workflow PASS và artifact có SHA/hash.
4. Updater V3 tự cài lên PC01; candidate health + live health PASS hoặc tự rollback.
5. Physical E2E: login -> giao việc neutral -> issue được tạo -> PC01 claim -> evidence/result -> UI phản chiếu trạng thái cuối.
6. Chỉ claim DONE khi có physical evidence; không dùng screenshot/UI render thay runtime proof.

## P0 phạm vi chức năng
1. Tìm kiếm thật cho Công việc + AI + mô hình.
2. Chi tiết Công việc thật: mục tiêu, lifecycle, người phụ trách, bằng chứng, gate, log tóm tắt.
3. Hàng chờ `Cần anh Sơn`: Duyệt / Từ chối / Để sau, có CSRF + idempotency + audit + authority fail-closed.
4. Evidence viewer thật theo Work Order.
5. Đội AI: drilldown trạng thái/model/current task; chỉ bounded action đã được phép.
6. Hệ thống: updater version, installed SHA, health, last deploy/result; bounded recheck.
7. Báo cáo: dashboard 6 phần tiếng Việt từ state thật.
8. Cài đặt: read-only trước; không security-sensitive/credential changes.
9. Progress: runtime truth hoặc nhãn `ước lượng`; không giả phần trăm.
10. Auto-refresh nhẹ khi ở chế độ chỉ xem; không làm mất dữ liệu form đang nhập.

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
- Search/evidence/system/report hoạt động thật.
- Không còn nút/section chính giả chức năng; mục chưa triển khai phải ghi rõ `Chưa khả dụng` thay vì giả clickable.
