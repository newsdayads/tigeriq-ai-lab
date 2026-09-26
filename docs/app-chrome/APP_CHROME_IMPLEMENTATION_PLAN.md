# APP CHROME — IMPLEMENTATION PLAN V1
Status: LOCKED
Authority: APP_CHROME_SPEC_LOCK.md + #1940

Không đổi thứ tự hoặc đổi kiến trúc giữa chừng nếu Owner không thay SPEC.

## 7 bước cố định
### STEP 1 — SPEC LOCK
Khóa APP_CHROME_SPEC_LOCK.md.

Exit:
- SPEC có mục tiêu, cấm, acceptance, precedence.
- Owner approval token được ghi.

### STEP 2 — HANDOFF CONTRACT
Tạo đủ:
- APP_CHROME_SPEC_LOCK.md
- APP_CHROME_IMPLEMENTATION_PLAN.md
- APP_CHROME_WORKING_RULES.md
- APP_CHROME_EXECUTION.md
- APP_CHROME_EVIDENCE.md

Exit:
- NEW CHAT có locator rõ.
- Issue #1940 trỏ tới CURRENT_STEP/NEXT.

### STEP 3 — AUDIT CURRENT
So sánh GitHub main + live PC01 với SPEC.

Bắt buộc xác định:
- logic nào gây đứng;
- logic nào tạo prompt Core/GitHub fallback;
- fix tốt nào phải giữ;
- file/source cần đổi tối thiểu.

Không code trước khi audit delta rõ.

### STEP 4 — FORWARD-CLEAN FIX
GitHub branch → code change tối thiểu:
- bỏ Core/assignment gate khỏi continuity;
- bỏ role-fallback/self-claim prompt;
- khôi phục local short prompt;
- giữ anti-spam/recovery/UTF-8/pacing/model bounded/watchdog.
Không rollback nguyên deploy cũ.

### STEP 5 — PER-WORKER LIVE TEST
NV02/NV03/NV04 test riêng:
- READY → 1 dispatch ngắn;
- chuyển WORKING thật;
- WORKING → không gửi chồng;
- trở về READY → chỉ arm lượt sau;
- prompt prefix đúng worker.

### STEP 6 — LIFECYCLE TEST
Test:
- F5 safe;
- lỗi load/network bounded recovery;
- restart riêng worker;
- planned restart 2–4h path ở mức canary phù hợp;
- reboot PC01;
- self-start/converge.

### STEP 7 — CLOSEOUT
- Exact head/package/live deploy ghi đủ.
- CI/review/gate đạt.
- Evidence 3 worker + lifecycle.
- APP_CHROME_EXECUTION.md = DONE.
- APP_CHROME_EVIDENCE.md có live proof.
- #1940 cập nhật terminal state.
- NEW CHAT command `1` tiếp tục/đọc đúng nguồn.

## Merge / rollout
- Không direct main.
- Branch → PR → required checks → review/gate → merge.
- Rollout PC01 bằng updater/safe deploy path hiện hành.
- Rollback chỉ khi canary fail; không gọi PASS nếu chưa có live evidence.
