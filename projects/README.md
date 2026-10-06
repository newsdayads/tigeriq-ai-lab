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
