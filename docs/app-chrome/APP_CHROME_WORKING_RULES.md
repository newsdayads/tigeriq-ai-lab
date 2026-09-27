# APP CHROME — WORKING RULES V1
Status: LOCKED
Authority: APP_CHROME_SPEC_LOCK.md + #1940

## 1. Không dùng chat làm Source of Truth
Chat chỉ là giao diện trao đổi. Trạng thái bền vững phải nằm ở:
1. APP_CHROME_SPEC_LOCK.md
2. APP_CHROME_IMPLEMENTATION_PLAN.md
3. APP_CHROME_WORKING_RULES.md
4. APP_CHROME_EXECUTION.md
5. APP_CHROME_EVIDENCE.md
6. Issue #1940 cho trạng thái động/handoff.

## 2. NEW CHAT contract
Khi anh Sơn nhập `1` trong chat mới cho lane App Chrome:
1. đọc Loader + Bootstrap canonical;
2. đọc #1940;
3. đọc 5 file trong `docs/app-chrome/`;
4. verify live PC01;
5. tiếp tục đúng `CURRENT_STEP / NEXT`;
6. không audit lại để thiết kế kiến trúc khác;
7. không dùng checkpoint cũ override SPEC.

## 3. Checkpoint rule
Sau mỗi step hoặc trước khi đổi chat:
- cập nhật CURRENT_STEP;
- DONE;
- CURRENT;
- NEXT;
- BLOCKER;
- TARGET_HEAD/PR nếu có;
- evidence refs.

Không được chỉ báo trong chat rồi coi là đã lưu.

## 4. Mutation rule
- App Chrome source: GitHub only.
- Không code bằng PC01 CMD/SHELL/Desktop Commander.
- PC01 chỉ runtime/deploy/live verification.
- Không direct main.
- Không paid/credential/security/destructive ngoài scope đã duyệt.
- App Chrome mutation chỉ Owner + Vy theo owner lock.

## 5. Scope rule
Nếu phát hiện vấn đề ngoài SPEC:
- không kéo vào sửa chung;
- ghi blocker/adjacent issue;
- chỉ sửa nếu cần trực tiếp để acceptance App Chrome đạt và vẫn trong authorization.

## 6. PASS/DONE rule
Không gọi ĐẠT/HOÀN TẤT nếu thiếu evidence.
Mỗi claim phải gắn:
- commit/head;
- test/check;
- live worker evidence nếu là runtime behavior.

## 7. Failure rule
Lỗi → root cause → fix nhỏ nhất → retest.
Không đổi kiến trúc chỉ vì một test fail.
Không rollback nguyên bản cũ nếu bản đó có lỗi đã biết.

## 8. Owner approval đã cấp
`DUYỆT APP_CHROME_RECOVERY_V1` cho phép:
- tạo/khóa 5 file;
- audit;
- sửa App Chrome đúng 7 bước;
- test 3 worker + lifecycle + reboot;
- branch/PR/check/review/merge/rollout trong scope App Chrome recovery;
- cập nhật execution/evidence/handoff.

Chỉ xin lại quyền nếu:
- Owner đổi SPEC;
- phát sinh paid/credential/security-sensitive/destructive hoặc scope ngoài App Chrome recovery.
