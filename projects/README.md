# TigerIQ Portfolio V2

Cấu trúc chuẩn:

`Portfolio → Project → Workstream → Job → Evidence`.

## Quy tắc
- Mỗi sản phẩm/dự án lớn có một thư mục dưới `projects/`.
- Nền tảng dùng chung đặt dưới `platform/`; Core không bị coi là sản phẩm ngang hàng.
- Không tạo thư mục theo từng GitHub issue.
- GitHub issue là JOB; issue khai báo tối thiểu:
  - `PROJECT_ID`
  - `PROJECT_NAME`
  - `WORKSTREAM_ID`
  - `WORKSTREAM_NAME`
  - `JOB_ID`
  - `ASSIGNEE`
  - `DEPENDENCIES`
  - `NEXT_ACTION`
- Source hiện hữu không bị di chuyển chỉ để khớp cấu trúc quản trị. `source_roots` trong manifest trỏ tới mã nguồn thật.
- Dự án mới chỉ cần thêm manifest + metadata issue; giao diện không cần hard-code tên dự án.
