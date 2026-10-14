# TIGERIQ — WORK ORDER LIFECYCLE V2

Owner source: #1456. This release defines a source contract and a guarded Core intake gate; it does **not** claim runtime-wide/7-repository enforcement until installed E2E evidence exists.

## Every NEW work card from 2026-10-12 00:00 UTC
Must declare `WORK_ORDER_LIFECYCLE=V2`, `PROJECT_ID`, `WORKSTREAM_ID`, `PRIORITY`, `RESOURCE_SCOPE`, `MUTATION_OWNER`, `CURRENT_STATE`, `CURRENT_STEP`, `NEXT_ACTION`, `LAST_COMPLETED_STEP`, `BLOCKER`, `STARTED_AT`, `FINISHED_AT`, `ETA_STATUS`, STOP_CONDITIONS, ACCEPTANCE, and `## STRUCTURED_PROGRESS_CHECKLIST` with at least two numbered `- [ ]` lines. Completed `- [x]` lines must link to evidence.

## Timeline and states
- CREATED (GitHub created_at; **not** evidence execution started) → READY (eligible but unclaimed) → WORKING (real scoped lease and start receipt) → REVIEW → VERIFY → DONE (all real gates passed, issue closed completed).
- WAIT / BLOCKED requires blocker, next action, actor, and an authorized rearm condition; no blind retry. Administrative stopped issue is CLOSED NOT_PLANNED and never DONE.
- STARTED_AT=NOT_STARTED or UNVERIFIED before a real start; when WORKING use timezone-qualified ISO-8601 and START_RECEIPT_URL. FINISHED_AT=NOT_FINISHED until final accepted completion, then ISO-8601 with FINISH_RECEIPT_URL.
- ETA_STATUS=UNVERIFIED or NOT_COMMITTED when dependencies cannot be estimated. ESTIMATED / COMMITTED requires TARGET_FINISH_AT in ISO-8601 including timezone; optional CHECKPOINT_DUE_AT. Never infer ETA from issue age, checklist percentage, or model guesses. Track estimates separately from finish evidence.
- A checked step is a claim linked to evidence; CI/source tests are not evidence that a PC01/mobile live runtime passed. Cross-check the original receipt before marking verified.

## Enforcement scope
- After a guarded merge and verified installation, Core auto-intake **denies** newly created P1–P5 work cards with invalid V2 schema. P0 remains Owner-only and never auto-claimed.
- Existing legacy cards remain eligible under their existing strict safety contract during migration; otherwise a new rule could silently halt live work. Updating old cards to V2 makes the gate mandatory for them immediately.
- NV02/NV03/NV04 operate through separate UI/GitHub self-pull; this Core gate cannot alone guarantee their external acceptance. Seven project repositories and manually edited GitHub issue closures also require dedicated connector/CI governance and real E2E acceptance.
- Dashboard may display the declared timeline (unverified until source readback); it must not invent started/finished values or project timestamps as execution timestamps.
- Branch/PR, required CI, reviewed release, installed Core SHA, and a live PC01 plus NV02 real-card canary are separate mandatory milestones. GitHub source PASS != deployment PASS.

## Bắt buộc đồng bộ ô hoàn tất sau MỖI bước — Owner 15/10/2026
- Ngay sau khi nghiệm thu một bước có bằng chứng thật, người đang giữ quyền ghi hợp lệ phải sửa đúng dòng tương ứng trên thẻ GitHub từ `- [ ]` sang `- [x]` và gắn URL bằng chứng trên cùng dòng. Không tích các bước chưa nghiệm thu.
- Đọc lại nội dung Issue từ GitHub sau khi cập nhật, đối chiếu chính xác mã bước, dấu `[x]`, URL biên nhận và khóa một người ghi. Chỉ sau kết quả đối chiếu mới được công bố bước đó hoàn tất hoặc chuyển sang bước phụ thuộc.
- Nếu ghi thất bại, mất quyền, khác phiên bản thẻ, thiếu khóa ghi hoặc không đọc lại được: lưu lỗi và ở CHỜ/BỊ CHẶN, KHÔNG báo bước HOÀN TẤT, KHÔNG giả phần trăm; không dùng bình luận `DONE` thay ô tích. Không thử lặp trên cùng dữ liệu khi đã hết lượt cho phép.
- Cổng cuối phải đọc lại thẻ mới nhất, kiểm tra tất cả ô cần thiết đã được tích và gắn URL nguồn. Bình luận DONE, mã chạy xong hoặc Issue đóng riêng lẻ không phải xác nhận đủ.
- Quy tắc áp dụng cho công việc do Owner giao trong ChatGPT/Gemini và nhân sự AI; lớp mã cưỡng chế chỉ có hiệu lực trên từng tuyến đã thật sự tích hợp và phát hành. Không tuyên bố đã cài đặt xuyên các tài khoản gốc chỉ vì đã sửa GitHub.

## Fixed closure acceptance
1. Accurate one-writer claim + timestamp + receipt; all checklist entries have verified original evidence.
2. Exact-head CI/QA/PR/field tests as required, runtime acceptance and rollback verification when applicable.
3. Explicit FINISHED_AT + FINISH_RECEIPT_URL, DONE=true and GitHub CLOSED/completed; never 100% for open cards.
4. Owner-close NOT_PLANNED preserves undone work and does not grant completion.

## Example initial block
```text
## ACTIVE WORK ORDER
WORK_ORDER_LIFECYCLE=V2
PROJECT_ID=TIGERIQ_AI
WORKSTREAM_ID=core
PRIORITY=P2
OWNER_POLICY=AUTO
RESOURCE_SCOPE=EXAMPLE_UNIQUE_RESOURCE
MUTATION_OWNER=NONE
CURRENT_STATE=READY
CURRENT_STEP=M01 — establish baseline
NEXT_ACTION=Collect actual source readback
LAST_COMPLETED_STEP=NOT_STARTED
BLOCKER=NONE
STARTED_AT=NOT_STARTED
FINISHED_AT=NOT_FINISHED
ETA_STATUS=UNVERIFIED
## STRUCTURED_PROGRESS_CHECKLIST
- [ ] M01 — Baseline with source SHA
- [ ] M02 — Run and collect real acceptance
## ACCEPTANCE
M01–M02 evidence pass, no fake closure.
## STOP_CONDITIONS
Stop before cost/credentials/security/production/irreversible action.
```

## Không vượt cổng bằng tiêu đề
- Issue mới có PRIORITY trong active header, EXECUTABLE=true hoặc OWNER_POLICY=AUTO đều phải qua V2, kể cả thiếu nhãn [P1–P5] ở tiêu đề hoặc cố đặt nhãn [CENTRAL]/[STATE]. Trường hợp quản trị/reference không thực thi được loại trừ.
- Không được dùng nhãn hợp lệ ở phần lịch sử để vượt cổng. Checklist trong code fence không được tính như bước công việc thật.
- Mỗi bước đánh dấu hoàn thành cần link nguồn có thể đối chiếu; chỉ kiểm tra cú pháp URL không phải chứng minh biên nhận nội dung là thật.
