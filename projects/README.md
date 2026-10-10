# TigerIQ Projects

Cấu trúc chuẩn cho nhiều dự án chạy đồng thời:

`Portfolio → Project → Workstream → Job → Evidence`

- Mỗi **Project** có một thư mục ổn định trong `projects/<project-id>/`.
- `project.yaml` khai báo tên, loại, thứ tự hiển thị và các nhánh công việc.
- `workstreams/` mô tả các nhánh nghiệp vụ/kỹ thuật bền vững; **không tạo thư mục theo từng GitHub issue**.
- GitHub Issue là **JOB**. Metadata chuẩn: `PROJECT_ID`, `PROJECT_NAME`, `WORKSTREAM_ID`, `WORKSTREAM_NAME`, `JOB_ID`, `ASSIGNEE`, `DEPENDENCIES`, `NEXT_ACTION`; các field `WORK_PACKAGE_*` cũ vẫn được hỗ trợ.
- Source code hiện hữu không bị di chuyển chỉ để khớp cây tổ chức. Manifest trỏ tới `source_roots` hiện tại.
- Dự án mới chỉ cần thêm `projects/<id>/project.yaml`; UI không được hard-code riêng cho từng dự án.

Nền tảng dùng chung nằm ở `platform/`, không giả thành product project.

## Cấu trúc Owner chốt 2026-10-10 — P0 #4640

Danh mục 7 nhóm cấp cao được mô tả trong `projects/portfolio.yaml`, KHÔNG phải bảy lệnh thực thi tự động:

1. **TigerIQ AI**: Nền tảng TigerIQ, Mobile Worker, TigerIQ Live, Workflow Lab, App Chrome.
2. **TigerIQ News / Media**: một sản phẩm, tên kỹ thuật giữ `tigeriq-news`.
3. **Paperclip vNext**.
4. **Revenue Lab**.
5. **TigerIQ Driver**: repository `newsdayads/drivetrack`, gồm DeX Shot; DeX Shot không thuộc DeXCam.
6. **DeXCam Personal**: ứng dụng cá nhân dựa trên UltraCarVN; hiện chỉ đặc tả.
7. **TigerIQ Coin**: nhóm quản trị bốn repository DERO/Zephyr, mặc định **KHÔNG CHẠY KHAI THÁC**.

Giữ nguyên `PROJECT_ID` lịch sử và các Issue đang có; nhóm cha `tigeriq-ai` chỉ dùng cho hiển thị, **không phải `PROJECT_ID` runnable**. `CANONICAL_PORTFOLIO_GROUPS` và `buildPortfolioGroups` của Core cung cấp lớp hiển thị không sửa quy tắc điều phối. Trạng thái chạy và % phải lấy từ bằng chứng thật; danh mục rỗng không đồng nghĩa có nhân sự đang chạy.

**Ranh giới:** App Chrome tiếp tục LOCAL-ONLY trên PC01, các dự án ngoài repo có quyền và quy trình phát hành riêng, mỗi tích hợp xuyên dự án cần hợp đồng API/phân quyền/hạn mức và bằng chứng. Bảng GitHub Projects (nếu được tạo riêng qua quyền GitHub hợp lệ) không đồng nghĩa với file manifest; xem `docs/PROJECT_ISOLATION_AND_COLLABORATION_V1.md`.

Cấu hình này trên nhánh đề xuất chưa tự khẳng định đã phát hành, đã phân quyền độc lập hoặc đã tạo bảng GitHub Projects.
