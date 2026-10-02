# TigerIQ Mobile Worker — Execution Prompt V1

```
LÀM — NO YAPPING.

Thực thi #2949 - [P3][ANDROID] TigerIQ Mobile Worker — cụm AI Employee Android tự nhận việc, thực thi và tự cập nhật theo đúng docs/android/MOBILE_WORKER_MASTER_V1.md.

MỤC TIÊU:
Biến Android thành worker node có quản lý của TigerIQ: nhận job từ Core, gắn đúng AI Employee, điều khiển đúng phiên AI, trả result/evidence, hỗ trợ recovery và cập nhật tập trung. Pilot Z Flip 7 trước, S7 sau khi có thiết bị.

NGUYÊN TẮC CỨNG:
1. Không đổi kiến trúc/gate đã khóa nếu chưa có evidence thực tế bắt buộc; architectural delta phải ghi SPEC_DELTA và chờ Owner nếu ảnh hưởng lớn.
2. Build baseline trước; chạy thiết bị thật càng sớm càng tốt; chỉ fix dựa trên lỗi tái hiện/evidence.
3. GitHub source: branch → PR → exact-head checks → independent review → merge. Không direct main.
4. Mobile Worker không tự chọn backlog/P0 và không tự chiếm scope. Core giao job; worker execute.
5. Device != AI Employee. Binding tách biệt.
6. RELAY MODE là mặc định; điện thoại không direct-write main.
7. Accessibility semantic selector trước; hot-config selector; toạ độ chỉ bounded fallback.
8. Exactly-once/dedupe/one-resource-one-writer bắt buộc.
9. Update: Hot Config + DEV/CANARY/STABLE APK; verify SHA256 + signer; forward rollback.
10. Không đụng App Chrome.
11. Không paid/Production/credential/security widening/destructive action nếu thiếu Owner gate.
12. Không claim ĐẠT/HOÀN TẤT nếu thiếu evidence thật.
13. MASTER JOB chỉ được HOÀN TẤT khi OWNER_FINAL_ACCEPTANCE=APPROVED.

THỨ TỰ:
GATE A → B → C → D → E → F → G → H → I → J → K → L.
Không nhảy gate để tạo cảm giác tiến độ.
Nếu gate phụ thuộc thiết bị chưa có, hoàn thành tối đa phần source/test an toàn rồi checkpoint CHỜ THIẾT BỊ; không bịa runtime PASS.

MỖI LỖI:
EVIDENCE → ROOT_CAUSE → FIX NHỎ NHẤT → TEST → RETEST THỰC TẾ → CHECKPOINT.

BÁO CÁO:
KẾT QUẢ → BỊ CHẶN → BƯỚC TIẾP THEO.
Chỉ hiển thị % khi có checklist/evidence định lượng thật.
```
