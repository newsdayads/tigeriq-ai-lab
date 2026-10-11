# TigerIQ — Ranh giới dự án và hợp đồng phối hợp V1

Owner approval: 2026-10-10; P0 issue #4640.
State: DOCUMENTED_ARCHITECTURE_ONLY; enforcement and runtime verification not yet proven.

## Distinct layers

- **Portfolio group:** 7 nhóm theo `projects/portfolio.yaml`. Là bản đồ quản trị, không có quyền tự chạy.
- **Project:** ổn định qua `PROJECT_ID` / `project.yaml`; có thể nằm trong cùng repository hoặc repository riêng.
- **Workstream/Job/Evidence:** giữ nguyên quan hệ hiện hành `Portfolio → Project → Workstream → Job → Evidence`; không biến việc cập nhật trạng thái hiển thị thành lệnh chạy Core.
- **GitHub Projects V2:** nếu tạo, là bảng quản lý nhìn xuyên repository, **không cấp quyền mới** tới repository riêng tư hay thiết bị.

## Isolation requirements

1. Mã nguồn, bảo vệ nhánh và quy trình phát hành theo chủ sở hữu từng repository; không di chuyển hoặc hợp nhất mã chỉ để khớp sơ đồ.
2. Dữ liệu nghiệp vụ và cơ sở dữ liệu riêng, không ghi xuyên dự án. Driver giữ riêng doanh thu/cuốc xe và ảnh nguồn, News giữ nội dung/xuất bản.
3. Tài khoản, thông tin xác thực, dịch vụ có phí, quyền quản trị và token phải tách phạm vi; không đưa bí mật vào manifest, Issue hoặc bảng điều hành.
4. Phát hành riêng: kiểm thử, rà soát độc lập, khả năng quay lại và phê duyệt đúng phạm vi trước khi thay đổi Production.
5. Sử dụng chung PC01/GPU/AI workforce chỉ khi có lịch tài nguyên và lease hợp lệ; không coi nhóm chung là quyền thực thi toàn cục.
6. App Chrome dùng nguồn và vận hành cục bộ PC01; GitHub chỉ theo dõi policy/manifest; cấm Work Order và triển khai App Chrome qua GitHub.
7. TigerIQ Coin chỉ kiểm kê mã nguồn, cấm tự khởi chạy miner, chỉnh ví, hệ thống, dùng CPU/GPU và phát sinh chi phí.

## Collaboration contract (required before any cross-project action)

- Bên yêu cầu và bên cung cấp, mục đích nghiệp vụ, `projectId` từng bên.
- Hành động/điểm gọi được cấp phép, phương thức xác thực, dữ liệu tối thiểu, phiên bản API/định dạng.
- Giới hạn tần suất/thời gian/tài nguyên, cách chống trùng, retry và cơ chế dừng khi lỗi.
- Bằng chứng truy vết, quyền thu hồi, ai duyệt thay đổi và rollback.
- Không dùng credential chung hoặc truyền dữ liệu cá nhân chỉ để tiện tích hợp.
- P0 do Owner/Vy điều khiển; `OWNER_HOLD` và điều kiện an toàn vẫn áp dụng cho mọi dự án.

## Component boundaries

- `app.tigeriq.dexshot` thuộc TigerIQ Driver (`newsdayads/drivetrack`), **không** thuộc DeXCam Personal.
- DeXCam Personal là tái xây dựng ứng dụng UltraCarVN cho nhu cầu cá nhân, còn phải phân tích phụ thuộc máy chủ/Firebase và quyền sử dụng.
- Alias `tigeriq-media` ánh xạ `tigeriq-news`; tránh tách đôi thành hai dự án.
- 4 repo Coin vẫn giữ nguyên và độc lập về mã nguồn; chỉ gom vào một nhóm danh mục quản trị.

## Acceptance gates before asserting fully independent operation

- Đối chiếu tài khoản Vercel, database, secrets, quyền GitHub và đường phát hành của từng dự án; đọc bằng chứng trước khi kết luận cô lập.
- Kiểm thử chức năng phân nhóm với mã dự án cũ; không đổi queue/lease/router, không tạo công việc trùng.
- Kiểm thử phân quyền tích hợp và sự cố chéo; độc lập khi lỗi; kiểm thử thiết bị khi cần.
- GitHub CI/rà soát độc lập/kiểm thử thực tế đạt trước merge hay public release.
