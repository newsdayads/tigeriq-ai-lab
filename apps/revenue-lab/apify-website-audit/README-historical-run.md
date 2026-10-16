# GH-2293 R04 — Chỉ đọc lần chạy Apify đã có ngày 08/10/2026

**Phạm vi:** `TIGERIQ_REVENUE_LAB_APIFY_POC_V2`. Đây là bộ thu thập bằng chứng R04, không phải biên nhận R04 được nghiệm thu trước khi đọc thật Actor và Run.

## Nguồn chứng cứ hiện tại

Issue [#2293](https://github.com/newsdayads/tigeriq-ai-lab/issues/2293) xác nhận ảnh chụp Owner trên Apify Console về Actor riêng tư `tigeriq/tigeriq-ai-lab`, bản build `0.0.4`, một lượt chạy **SUCCEEDED** ngày 08/10, dữ liệu `schemaVersion=1.0`. Biên nhận [Owner UI](https://github.com/newsdayads/tigeriq-ai-lab/issues/2293#issuecomment-6058613785) **không có** opaque Actor ID, Run ID và số liệu computeUnits/usageTotalUsd đã đối chiếu. Dòng 0.000 USD trên UI là *làm tròn, không phải chi phí chốt*.

## Quy trình GET-only, không được tự chạy khi thiếu cổng

Tại **môi trường được ủy quyền của Owner**, cấp những biến này qua kho bí mật hoặc cơ chế an toàn của nền tảng, không dán vào chat hay GitHub:

- `APIFY_TOKEN`: token đọc riêng tư đúng scope, chỉ đưa vào header Authorization.
- `APIFY_ACTOR_ID`: opaque Actor ID đã đối chiếu với Owner.
- `APIFY_RUN_ID`: opaque Run ID của đúng lượt chạy **08/10/2026**.
- `APIFY_READONLY_EXECUTE=OWNER_APPROVED_EXISTING_RUN_READ`: cổng rõ ràng cho hành động đọc.

Sau khi có đủ quyền: `npm run apify:historical-readonly`. Nếu thiếu cổng hoặc ID, lệnh từ chối **trước khi gọi mạng**. Các GET cố định:

1. `/v2/actors/:actorId` kiểm tra exact ID/handle, private, LIMITED_PERMISSIONS.
2. `/v2/actor-runs/:runId` kiểm tra exact run ID, `actId`, SUCCEEDED, ngày Việt Nam 08/10, hoàn tất trước ít nhất 10 giây; GET **lại đúng run ID** để nhận usage.
3. `/v2/key-value-stores/:defaultKeyValueStoreId/records/OUTPUT` — ID lấy từ Run; chỉ lưu schema/status, không lưu dữ liệu URL hoặc nội dung riêng tư.

**Cảnh báo:** Theo tài liệu Apify, `GET /actors/:id/run-sync` *có thể khởi chạy Actor*, vì vậy đường này **không bao giờ được gọi**, dù cũng có chữ GET. Mọi URL khác ngoài danh sách và mọi redirect đều bị chặn.

## Tính chính xác về chi phí

Sau GET hợp lệ, evidence chỉ xác nhận `usageTotalUsd` và `stats.computeUnits` (nếu có) từ API tại thời điểm đọc. Apify nêu rõ tổng USD API có thể tính lại theo mức giá hiệu lực và **không thay thế hóa đơn cuối**. Bộ đọc đặt `ownerBillingConfirmed=false`, `zeroCostClaim=false`, `revenueVerified=false`. R05 vẫn cần hóa đơn/chứng từ đủ thẩm quyền nếu yêu cầu chi phí chốt.

Tài liệu: [Get Actor](https://docs.apify.com/api/v2/actor-get), [Get Run](https://docs.apify.com/api/v2/actor-run-get), [Run usage eventual consistency](https://docs.apify.com/api/v2/actors-actor-runs).

## Kiểm thử và giới hạn nghiệm thu

`npm run test:apify-historical` dùng mocked Response và **không có request Apify thật**. Nó kiểm tra gate, URL allowlist GET, tránh run-sync/POST, đối chiếu identity và ngày, từ chối redirect/HTTP 403, usage null/negative/NaN, không rò token, không báo doanh thu/chi phí chốt giả.

Không có token scoped/Actor ID/Run ID thì **R04 chưa nghiệm thu**. Bộ đọc không tạo run, build, Actor, không bật paid/public, không sửa Core, PC01, Chrome, secrets hoặc Production. Giữ checklist R04/R05 unchecked và Work Order DONE=false đến khi có biên nhận quyền đọc thật và kết quả đối chiếu.

## R04 — Chống lệch ngày do múi giờ (nguồn-only)

Apify trả `startedAt` và `finishedAt` theo kiểu ISO 8601 date-time, ví dụ hậu tố `Z`; bộ đọc chỉ chấp nhận timestamp có UTC `Z` hoặc offset rõ ràng (`+07:00`, `-04:00`). Các chuỗi chỉ có ngày hoặc không có timezone bị bác, thay vì để `Date.parse` ngầm chọn múi giờ host. Bộ locator cũng kiểm tra UTC absolute instant trong cửa sổ ngày 08/10/2026 giờ Việt Nam. Đây là sửa kiểm chứng nguồn, không xác nhận lại run thật và không cấp quyền mới. Nguồn schema: https://docs.apify.com/api/v2/actor-run-get và https://docs.apify.com/api/v2/actor-runs-get.
