# TigerIQ — Portfolio / Project / Workstream / Job V2

## Authority
Owner approval: 2026-10-06.
Canonical implementation: #4325 - [P0][PORTFOLIO] Chuẩn hóa Dự án → Nhánh việc → JOB → thực thi.

## Cấu trúc chuẩn
`Portfolio → Project → Workstream → Job → Evidence`.

- **Portfolio**: toàn bộ danh mục TigerIQ.
- **Project**: sản phẩm/dự án lớn có mục tiêu riêng.
- **Workstream**: nhánh công việc lớn trong dự án.
- **Job**: đơn vị công việc có người nhận, trạng thái, phụ thuộc và bước tiếp theo.
- **Evidence**: issue/PR/check/log/artifact; dùng để chứng minh kết quả.

## Thư mục
- `projects/mobile-worker/`
- `projects/tigeriq-news/`
- `projects/tigeriq-live/`
- `projects/paperclip-vnext/`
- `projects/revenue-lab/`
- `platform/core/`

Core là nền tảng dùng chung, không phải sản phẩm ngang hàng.

## Hợp đồng metadata JOB
```
PROJECT_ID=
PROJECT_NAME=
WORKSTREAM_ID=
WORKSTREAM_NAME=
JOB_ID=
ASSIGNEE=
DEPENDENCIES=
NEXT_ACTION=
```

Các field explicit có quyền cao hơn classifier tương thích cũ.

## Luồng hiển thị
`Dự án → Nhánh việc → JOB → Người nhận → Trạng thái → Bước tiếp theo`.

## Tương thích
- Không di chuyển source hiện hữu.
- Manifest `project.yaml` trỏ tới `source_roots` thật.
- `WORK_PACKAGE_ID/NAME` được giữ để tương thích dữ liệu cũ.
- Project mới có thể xuất hiện từ metadata issue mà không cần hard-code UI.

## Ranh giới
Không đổi scheduler/router/lease/one-writer, không đổi credential/security, không đụng App Chrome.
