# TigerIQ LIVE — Project / Work Package / Task / Evidence V1

## Authority
Owner approval: 2026-10-04. Canonical implementation Work Order: #3730.

## Locked owner-facing hierarchy
`Project → Work Package (việc lớn) → Task (việc nhỏ) → Evidence`.

- **Project**: nhóm sản phẩm/hệ thống lớn, không đồng nghĩa GitHub issue.
- **Work Package**: một kết quả/mốc lớn mà Owner có thể hiểu và theo dõi.
- **Task**: bước thực thi/review/verify/release nằm trong Work Package.
- **Evidence**: issue, PR, SHA, checks, logs, artifact; ẩn khỏi màn hình chính, chỉ hiện khi drill-down.

## Current canonical projects
1. TigerIQ AI Lab
2. TigerIQ Mobile Worker
3. TigerIQ News — tên canonical; “TigerIQ Media” chỉ là historical alias.
4. Paperclip vNext
5. Revenue Lab

Dự án mới không được hard-code vào UI. Issue mới có thể khai báo:
```
PROJECT_ID=<stable-slug>
PROJECT_NAME=<owner-facing-name>
WORK_PACKAGE_ID=<stable-slug>
WORK_PACKAGE_NAME=<owner-facing-name>
```
Các field explicit có quyền cao hơn fallback legacy classifier.

## Visual baseline — locked
Giữ nguyên TigerIQ LIVE đã được Owner duyệt: màu, typography, spacing, card language, navigation và mật độ thông tin. Không thay bằng các mockup minh hoạ trong chat.

Desktop và mobile dùng cùng một design system và cùng data model:
- Desktop có thể trình bày nhánh song song theo cột.
- Mobile xếp dọc/drill-down.
- Không tạo hai sản phẩm hoặc hai logic riêng.

## Reference-video behavior
Luồng owner-facing:
`Mục tiêu/việc lớn → điều phối/nhánh → thực hiện → công cụ/evidence → kiểm tra → duyệt/kết quả`.

- Task độc lập có thể hiện/run song song.
- Task có dependency giữ tuần tự.
- Trạng thái active có live pulse/livebar/edge-particle dựa trên status thật.
- DONE/idle không được giả hiệu ứng đang chạy.
- Tôn trọng `prefers-reduced-motion`.

## Safety boundary
Phase 1 chỉ thêm read-only aggregation + presentation:
- Không đổi Core execution.
- Không đổi scheduler/router.
- Không đổi NV API dispatch.
- Không đổi queue/lease/one-writer.
- Không đổi credential/security boundary.
- Không tạo % tiến độ giả.

Superseded/legacy vẫn giữ ở technical/raw detail nhưng không làm bẩn Project/Work Package chính.

## Current expected grouping
### TigerIQ AI Lab
- Core / Router & Workforce
- TigerIQ LIVE
- Auto-RCA & Observability khi còn actionable work

### TigerIQ Mobile Worker
- Work Package canonical hiện hành, hiện tại là Live Worker v0.22
- source/review/runtime/sign/publish/update/device verify là task/stage con
- v0.21 và thấp hơn là historical detail khi v0.22 là current

### TigerIQ News
- Work Package hiện hành, gồm admin/security hardening khi còn mở

### Paperclip vNext
- Shadow evaluation + blocker/gate hiện hành

### Revenue Lab
- Apify Website Audit + deferred state

## Acceptance
- Dữ liệu owner-facing gom đúng 4 tầng.
- Duplicate technical parents cùng Work Package chỉ thành một card.
- LIVE baseline không redesign.
- Desktop/mobile responsive cùng một hierarchy.
- Live animation chỉ phản ánh activity thật.
- Raw issue/PR/SHA/evidence vẫn truy cập được.
- Tests/checks/review đạt trước merge.
- Chỉ publish production sau verified preview/real-surface gate theo authorization #3730.
