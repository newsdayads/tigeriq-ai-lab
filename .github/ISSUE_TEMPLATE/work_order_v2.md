---
name: "CÔNG VIỆC — WORK ORDER V2"
about: "Tạo công việc mới có người phụ trách, danh sách bước, thời gian và nghiệm thu. P0 không tự giao AI."
title: "[P2][DỰ ÁN][NVXX] Tên công việc — mục tiêu nghiệm thu"
---

## ACTIVE WORK ORDER
WORK_ORDER_LIFECYCLE=V2
PROJECT_ID=CHỌN_MÃ_DỰ_ÁN
WORKSTREAM_ID=CHỌN_NHÁNH_CÔNG_VIỆC
PRIORITY=P2
OWNER_POLICY=AUTO
TIGERIQ_EXECUTABLE=false
AUTO_QUEUE=EXCLUDED_UNTIL_VALIDATED
RESOURCE_SCOPE=WORK_V2_UNIQUE_ID
MUTATION_OWNER=NONE
CURRENT_STATE=READY_FOR_CONTRACT_REVIEW
CURRENT_STEP=M01 — Xác minh điều kiện và nguồn lực
LAST_COMPLETED_STEP=NOT_STARTED
NEXT_ACTION=Đối chiếu nguồn, thay thế toàn bộ placeholder rồi kiểm tra gate
BLOCKER=NONE
STARTED_AT=NOT_STARTED
FINISHED_AT=NOT_FINISHED
ETA_STATUS=UNVERIFIED
START_RECEIPT_URL=NOT_AVAILABLE
FINISH_RECEIPT_URL=NOT_AVAILABLE
TARGET_FINISH_AT=UNVERIFIED
CHECKPOINT_DUE_AT=UNVERIFIED
DONE=false
NO_PC01_SHELL=true
NO_DIRECT_MAIN=true
NO_PRODUCTION_RELEASE=true
NO_PAID_COST=true
NO_CREDENTIAL_CHANGE=true
NO_SECURITY_BOUNDARY_CHANGE=true
NO_DESTRUCTIVE=true
APP_CHROME_MUTATION=FORBIDDEN

## GOAL
- Mục tiêu cụ thể và kết quả cuối có thể kiểm thử:

## STRUCTURED_PROGRESS_CHECKLIST
- [ ] M01 — Kiểm tra nguồn hiện hành, xác minh quyền và điều kiện để bắt đầu; gắn URL bằng chứng khi đạt
- [ ] M02 — Thực hiện thay đổi nhỏ nhất trong phạm vi, gắn PR/receipt và kết quả test thật
- [ ] M03 — Rà soát, E2E/rollback theo phạm vi, chốt nghiệm thu và FINISHED_AT có biên nhận

## ACCEPTANCE
- Các mốc bắt buộc đều có biên nhận thật, người kiểm tra hợp lệ, nguồn SHA/Test khớp.
- Chỉ CLOSED/completed khi DONE=true, FINISHED_AT + FINISH_RECEIPT_URL thật; NOT_PLANNED không phải DONE.

## STOP_CONDITIONS
- Dừng trước thay đổi Main/Production, credential, chi phí, quyền bảo mật, thiết bị hoặc tác vụ không thể đảo ngược nếu thiếu phê duyệt từng hành động.
- Không tự mở quyền chỉ vì ưu tiên cao; không claim P0 tự động; không chiếm lease của worker khác.

## GHI CHÚ
- **Chưa tự chạy:** mẫu mặc định `TIGERIQ_EXECUTABLE=false` / `AUTO_QUEUE=EXCLUDED_UNTIL_VALIDATED`; người có quyền phải nghiệm thu hợp đồng rồi mới mở điều kiện tự nhận.
- STARTED_AT chỉ ghi ngày giờ ISO 8601 có múi giờ sau khi đã nhận việc thật, kèm URL biên nhận.
- ETA nếu chưa đủ dữ liệu cứ để `UNVERIFIED`; nếu ấn định cần `ETA_STATUS=ESTIMATED` và `TARGET_FINISH_AT=YYYY-MM-DDTHH:mm:ss+07:00`.
- Với mỗi bước đã qua, cập nhật `- [x]` và link PR/receipt ngay trên cùng dòng. Không đổi trạng thái DONE bằng tay khi thiếu acceptance.
