# REA GH-4780 — R05 read-only Core admission diagnostic

**Scope: source-only diagnostic, not lease admission.** This utility does NOT grant access, install REA, alter PC01, claim/release a Core lease, or verify a caller's identity.

## Source and verified real-world gap

[Actual PC01 Core readback](https://github.com/newsdayads/tigeriq-ai-lab/issues/4780#issuecomment-6189075602): on 2026-10-15T09:35:53Z, 14 enabled resources, zero shared leases, **zero NV02 resource rows**. The absence of shared leases does not imply an authorized NV02 writer. Core [live-status](../../apps/tigeriq-core/core.mjs) is a read-only projection; [acquireSharedResourceLease](../../apps/tigeriq-core/shared-resource-lease.mjs) requires an enabled employee-matched resource, and only the authorized Core executor can claim.

## Diagnostic states

The new r05-readonly-core-admission.mjs accepts an untrusted live-status-shaped JSON object. It fails closed for invalid shape, invalid rows, impossible UTC timestamp, stale (>120s) or far-future (>15s) input, or oversized data. Valid snapshots distinguish NV02_RESOURCE_ABSENT, NV02_RESOURCE_BUSY, NV02_RESOURCE_NOT_READY (all NV02 rows blocked by health, credentials, or disabled state) and REAL_ATOMIC_CLAIM_AND_DEVICE_AUTH_REQUIRED. Missing/unknown resource statuses fail closed as INVALID_RESOURCE; ready-looking rows are never authorization. Only fixed status codes and numeric counts are emitted, never lease tokens, resource IDs or provider metadata.

Every result has sourceAuthenticated=false, leaseOwned=false, deviceAuthorized=false, installAuthorized=false, mutated=false. Even a visible idle row does **not** authorize atomic claim or installation.

## CLI and tests

For already-permitted **sanitized** input on an independent machine, pass JSON over stdin, not an arbitrary host path:

~~~sh
node projects/rea-reconstruction-lab/r05-readonly-core-admission.mjs --read-only < sanitized-live-status.json
~~~

CLI output is sanitized fixed JSON; input max 256 KiB. CI tests cover absence, contention, stale reads, bogus lease evidence and actual Node subprocess behavior **of this diagnostic**, not actual REA runtime.

## Next real action

R05 remains **unchecked** until a legitimate executor identity/resource binding, independently authorized device action and Core-issued atomic work/resource/lease receipt with appropriate TTL/heartbeat (and fencing if the actual contract supports it) are read back. No invented lease, no impersonation, no registry mutation. R02 NO-GO, R06 installation and R07 MCP remain separate gates.

## Core status safety regression (15/10/2026)

Core `publicStatus()` distinguishes `WAIT_KEY`, `RATE_LIMITED`, `ERROR`, `OFFLINE`, `DISABLED`, `BUSY`, `ON_DEMAND`, `IDLE`, and `READY`. The read-only projection is *not* an authenticated action grant. When all NV02 rows are unhealthy/disabled or busy, the diagnostic must not suggest a free claim candidate. Added tests cover unknown/missing statuses, five unavailable statuses, mixed contention and health, and CLI no-authorization flags. The actual NV02 resource and device authorization still require separate Core/PC01 receipts. Changes are source-only and do not alter Core, resource registry, leases, PC01, or REA installation.

## Core job lịch sử — đối chiếu PC01 thật (16/10/2026)
- Đọc tại PC01 qua `GET /api/status`, giờ nguồn `2026-10-15T18:38:35.684Z`: `ok=true`, **15 resources**, **40 jobs với `status=done`**, **0 shared leases**, **0 NV02 resource**. Đây là biên nhận ảnh chụp chỉ đọc, không phải quyền sử dụng Core.
- Bộ đọc R05 cũ chỉ nhận `running`/`queued`, nên khi đưa đúng 40 job lịch sử vào, bộ kiểm tra đánh `INVALID_JOB_PROJECTION` trước khi có thể trả `NV02_RESOURCE_ABSENT`. Đây là lỗi định dạng đầu vào, không phải lỗi cấp tài nguyên.
- Bản vá chỉ chấp nhận thêm `done` như trạng thái cuối lịch sử, vẫn kiểm tra định dạng `employee_id`/`resource_id`, chỉ `running` được tính là tranh chấp hiện hành; `queued` không được diễn dịch là đã nhận lease. Trạng thái lạ vẫn bị từ chối.
- Chỉ thay bộ chẩn đoán và hồi quy nguồn, không sửa Core server, lịch sử job, lease, tài nguyên, quyền thiết bị hoặc cài REA. `R05` và `R06` tiếp tục chờ nghiệm thu ngoài đời thật.

## R05 — Hostile projection / busy pointer fail-closed (16/10/2026)

Bước nguồn tách biệt, **không lặp kiểm thử R06/R09 đã xong**. Đầu vào của `inspectR05ReadOnly` là projection **không đáng tin**, không phải Core-issued lease. Kiểm thử RED thực trên [PR #4939](https://github.com/newsdayads/tigeriq-ai-lab/pull/4939) cho thấy bốn nhóm lỗi: getter cấp cao hoặc Proxy tài nguyên ném exception, và `current_job_id` hoặc `shared_lease_work_id` sai kiểu số/object/bool đã lọt qua phân loại busy.

Bộ chẩn đoán mới bắt lỗi tại entrypoint và trả đối tượng an toàn `INVALID_UNTRUSTED_SNAPSHOT` thay vì ném exception có thể làm lộ nội dung giả mạo. Mã job và mã lease trên từng resource phải là `null`, không có trường hoặc chuỗi ID hợp lệ 1–256 ký tự; dữ liệu không hợp lệ trả `INVALID_RESOURCE` trước đánh giá tài nguyên bận. Trường hợp không có/null được giữ tương thích, vẫn chỉ trả `REAL_ATOMIC_CLAIM_AND_DEVICE_AUTH_REQUIRED` chứ không cấp quyền.

Phạm vi **nguồn, offline, không ghi Core**. Không kiểm chứng được tính xác thực của projection, người điều hành NV02, giao dịch claim Core, fencing/TTL, quyền thiết bị, host sandbox, SBOM hoặc cài REA. `sourceAuthenticated=false`, `leaseOwned=false`, `deviceAuthorized=false`, `installAuthorized=false`, `mutated=false`. R05/R06 và toàn Work Order #4780 vẫn chưa được nghiệm thu thực tế.
