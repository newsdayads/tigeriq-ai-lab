# NV03 P1–P5 tự nhận từ GitHub — cổng phát hành

Trạng thái: CHƯA KÍCH HOẠT, chỉ chuẩn bị khả năng chuyển chế độ.

- Owner ủy quyền NV03 tự nhận một việc P1–P5 phù hợp; NV04 giữ tuyến nghiên cứu/kiểm duyệt qua Core.
- `coreUiNv03SelfPullFenced` mặc định false; chỉ true khi đủ ba biến môi trường có xác minh độc lập: `TIGERIQ_NV03_SELF_PULL_MODE=GITHUB_SELF_PULL`, `TIGERIQ_NV03_CORE_ROUTE_FENCED=1`, `TIGERIQ_NV03_GLOBAL_LEASE_VERIFIED=1`.
- Khi hàng rào có hiệu lực, Core UI bỏ tạo nhiệm vụ NV03 mới, tránh chuyển việc dự phòng sang NV03; vẫn hòa giải nhiệm vụ cũ cho đến khi kết thúc, không hủy công việc đang chạy.
- Đây chưa phải cổng claim GitHub nguyên tử hay bằng chứng Core toàn hệ đã dừng giao. Không bật biến nếu claim/lease Core–GitHub–NV02/NV03 chưa xác minh.
- Đường App Chrome local-only Owner→Vy→PC01 độc lập; GitHub không được sửa hoặc triển khai App Chrome.
- Nghiệm thu đầy đủ: CI đạt, kiểm duyệt độc lập, Core đang chạy xác minh chặn giao trùng, NV03 GitHub đọc/claim/lease được, vòng nhận việc–thực hiện–kết thúc–chuyển việc thực tế, không đụng P0/hard gate.

Công việc tiếp nối: https://github.com/newsdayads/tigeriq-ai-lab/issues/4649
