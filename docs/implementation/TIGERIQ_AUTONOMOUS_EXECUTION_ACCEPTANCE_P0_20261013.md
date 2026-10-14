# P0 — Kế hoạch tự thực thi và nghiệm thu toàn hệ thống

**Nguồn duy nhất:** #280 (6 bước chưa hoàn tất); không tạo Issue con trùng. Owner 13/10 đã cấp quyền RDC và phát hành trong đúng phạm vi P0; không được sửa App Chrome local-only, bí mật, bảo mật/quyền, dịch vụ có phí, thiết bị/xe không liên quan hoặc hành động không thể hoàn tác.

## Đánh giá ảnh hưởng ngày 13/10
- PC01: RDC **Online**, Core `127.0.0.1:8795/health` **HTTP 200**, nhiều tiến trình Node đang chạy; chưa có bằng chứng E2E auto-acceptance.
- GitHub mã Coding Lane: `await managerTick()` nằm ngay trước `claimJob()` gây chặn hàng đợi khi Manager chậm. Work Order V2 và shared resource lease đã có, chưa phải runtime tự nghiệm thu trọn vẹn.
- Phát hành phải theo branch → PR → exact-head CI/Queue/Vercel → review hợp lệ hoặc P0 waiver được ghi rõ → cài có kiểm soát → runtime smoke → readback trạng thái.

| Pha | Thay đổi | PASS | Tác động/rollback |
|---|---|---|---|
| A Audit | Đọc service/tasks/SHA/health hiện tại, lưu restore point | PC01 baseline có chứng cứ | Chỉ đọc |
| B AI pool | Dùng #4696 và #4595 sửa contract/tài nguyên | >=2 AI thật nhận việc và xuất output hợp lệ | Không đổi token/quyền |
| C Manager/Worker | Tách Manager tick không chặn Worker; khóa single-flight, cooldown | Manager treo nhưng 2 worker vẫn claim; chỉ 1 Manager active | Feature flag `TIGERIQ_CODING_MANAGER_DECOUPLED` mặc định **OFF**, tắt cờ trở về đường cũ |
| D DAG/lease | Child nội bộ theo scope, dependency, fencing; không tạo Issue mới | 3 scope độc lập song song; 2 cùng scope tuần tự; restart không nhân đôi | Dùng shared lease hiện hữu |
| E Auto QA | Tự test/fix có giới hạn, CI đúng HEAD, reviewer độc lập hoặc Owner-waived có khai báo | Sai → fix → retest PASS; cổng quyền vẫn giữ | Lỗi kéo dài → WAIT/BLOCKED, không lặp vô hạn |
| F Nghiệm thu | PC01 HTTP/API/browser/RDC kiểm tra đúng bản cài; bằng chứng bất biến, parent DONE sau mọi child | 2 Work Order nghiệm thu đủ và tiếp tục tự claim NEXT | Không có runtime receipt → không đóng; rollback code/cờ |
 
## Luồng trạng thái đúng
RECEIVED → CLAIMED (lease receipt) → EXECUTING → TESTED → REVIEWED → LIVE_VERIFIED → ACCEPTED → DONE. `GitHub closed` **không** chứng minh DONE. Với việc đã đóng thiếu nghiệm thu chỉ giữ `CLOSED_UNVERIFIED`. Không giả reviewer độc lập, AI đã chạy, hay PC01 đã cài.

## Canary, phát hành, STOP
1. Sửa nguồn trên một nhánh P0, kiểm thử Manager stall/exception/single-flight và khả năng Worker chạy trong lúc manager đang chờ.
2. Merge bảo vệ sau 3 cổng thành công; readback `main` đúng SHA. **Chưa bật cờ trên PC01 khi chưa có service backup/canary và quyền cài đúng dịch vụ**.
3. Chạy từng canary nhỏ không có side effect; đối chiếu heartbeat/lease/job ID, đúng 2 tác vụ thật, lỗi không nhân đôi writer.
4. Bật có kiểm soát, theo dõi metric backlog/latency/error; lỗi hàng đợi, lease trùng, acceptance giả, health suy giảm → STOP/rollback ngay.
5. Chỉ đóng #280 khi S1–S6 từ nguồn **và runtime** hoàn tất, lưu chứng cứ GitHub PR/head/checks, reviewer hoặc waiver, installed SHA, canary, issue readback, NEXT tự claim.

**Hiện trạng khi lập kế hoạch:** chỉ Source Stage A (#4700) đã hoàn tất; nhánh này triển khai phần Manager/Worker dưới cờ OFF, các pha còn lại chưa được gán PASS.
