# WO-044 — Hệ thống quản lý công việc

Priority: P0
Status: READY FOR INDEPENDENT REVIEW — FINAL HEAD GATES REQUIRED
Date: 2026-08-31
Tracking: GitHub issue #112
Independent review gate: GitHub issue #119
Branch: `wo044/work-management-system`

## Phạm vi
Chỉ quản lý vòng đời mục tiêu/công việc. Không sửa App, Web Control, Bộ điều phối AI, PC01 runtime hay Production.

## Audit thực tế
TigerIQ đã có Work Order cơ bản, Task Packet, hàng đợi chống trùng, scheduler theo năng lực, retry/reassignment, lease/restart recovery, Workforce Controller, FileJournal hash-chain, evidence contracts và Reviewer/Judge độc lập. Khoảng trống của WO-044 là lớp quản lý một **mục tiêu gồm nhiều việc**: phân rã, đồ thị phụ thuộc, khóa phạm vi, điều phối song song an toàn, trạng thái tổng hợp, lịch sử xuyên suốt và cầu nối tới Workforce Registry thật.

## Thiết kế
`GoalRequest -> GoalDecomposer -> GoalPlan/DAG -> Ready Work -> Scope Lock + Lease -> Workforce Registry -> Executor -> Evidence -> Reviewer -> Judge -> Completed`.

- `GoalDecomposer` là ranh giới tích hợp: Bộ điều phối AI có thể cung cấp việc phân rã mà WO-044 không sửa logic chọn model/provider của Bộ điều phối AI.
- Mỗi việc khai báo phụ thuộc, phạm vi sửa, năng lực cần, loại worker được phép, bằng chứng cần và số lần thử tối đa.
- DAG bị kiểm tra cycle trước khi nhận việc.
- Idempotency ở cấp goal chống nhận trùng; conflicting replay cùng idempotency key nhưng đổi nội dung bị từ chối; workId là duy nhất toàn hệ thống.
- Scope lock theo cây đường dẫn ngăn hai executor sửa cùng phạm vi hoặc phạm vi cha/con cùng lúc.
- Chỉ việc không còn dependency mới được READY; dependency thất bại làm việc sau BLOCKED.
- Executor lease hết hạn sau restart được requeue hữu hạn; reviewer/judge lease hết hạn được giao lại mà không giả DONE.
- Kết quả trả về sau khi lease hết hạn bị từ chối như stale result, không thể đóng việc bằng kết quả quá hạn.
- Manager tự checkpoint trạng thái trước khi gọi worker bên ngoài và sau khi nhận kết quả; lỗi checkpoint fail-closed thay vì âm thầm tiếp tục.
- Reviewer không thể là executor; Judge không thể là executor hoặc reviewer của cùng việc, kể cả sau retry.
- PASS/DONE không được chấp nhận nếu thiếu bằng chứng có ref hợp lệ.
- Runtime có snapshot đầy đủ goal/work/lease/result/history và adapter lưu snapshot vào `FileJournal` hiện hữu trên PC01/Farm Controller. Vercel không dùng làm durable storage.
- `WorkforceRegistryBridge` chỉ đọc identity, worker kind, capability, health và concurrency từ Workforce Registry hiện hữu. Worker đã hết concurrency bị đánh dấu không sẵn sàng; execution vẫn đi qua `WorkDriver` được cung cấp để WO-044 không sửa AI Coordinator hoặc PC01 runtime.
- GitHub issue/Work Order vẫn là nguồn trạng thái kỹ thuật cấp dự án; FileJournal là trạng thái vận hành chi tiết để phục hồi liên tục.

## Thành phần
- `packages/work-management/src/index.ts` — public exports.
- `packages/work-management/src/types.ts` — Goal/Work/Worker/Evidence contracts.
- `packages/work-management/src/helpers.ts` — validation, DAG cycle check, evidence gate, scope conflict.
- `packages/work-management/src/store.ts` — state machine, dependency readiness, locks, leases, retry/recovery, history.
- `packages/work-management/src/manager.ts` — safe parallel execution + durable checkpoint + stale-result rejection + independent Reviewer/Judge loop.
- `packages/work-management/src/journal-store.ts` — checkpoint vào FileJournal append-only/hash-chain.
- `packages/work-management/src/workforce-bridge.ts` — cầu nối read-only từ Workforce Registry vào Work Manager.
- `schemas/work-management-plan.schema.json` — contract trao đổi GoalPlan.
- `tests/work-management.test.ts` — dedupe/conflicting replay, DAG/cycle, lock, parallelism, dependency order, retry, evidence gate, stale lease, auto-checkpoint, role independence, durable restore.
- `tests/work-management-workforce-bridge.test.ts` — routing theo Workforce Registry: PC01 executor, AI reviewer/judge độc lập, worker hết concurrency không được nhận thêm việc.

## Definition of Done
- Typecheck PASS.
- Unit tests PASS.
- Playwright smoke PASS.
- Build PASS.
- Queue Hygiene PASS.
- PR CI PASS trên exact head.
- Không thay đổi App/Web/AI Coordinator/PC01 runtime.
- Independent review #119 PASS trên exact head trước khi đóng WO-044.
- Không merge MAIN/Production nếu chưa có quyền release.
