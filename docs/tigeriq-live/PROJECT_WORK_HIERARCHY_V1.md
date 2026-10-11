# TigerIQ LIVE — Portfolio / Project / Workstream / Job / Evidence V2

## Authority
Owner approval: 2026-10-04. Canonical implementation Work Order: #3730.

## Locked owner-facing hierarchy
`Portfolio → Project → Workstream (nhánh việc) → Job → Evidence`.

- **Portfolio**: toàn bộ danh mục TigerIQ.
- **Project**: sản phẩm/dự án có mục tiêu riêng, không đồng nghĩa GitHub issue.
- **Workstream**: nhánh công việc bền vững bên trong một Project.
- **Job**: GitHub Issue/Work Order cụ thể được nhận, thực hiện, review, publish/verify và đóng.
- **Evidence**: PR, SHA, checks, logs, artifact; chỉ là bằng chứng của Job.
- **Platform**: nền tảng dùng chung (Core/Router/Workforce/Observability), được nhóm riêng và không giả thành product project.

## Owner-approved portfolio groups (2026-10-10; issue #4640)

Bảy nhóm cấp cao, **không đổi danh tính Project/Job hiện có**:
1. TigerIQ AI — nền tảng `tigeriq-platform`, `tigeriq-mobile-worker`, `tigeriq-live`, `tigeriq-workflow-lab`, `tigeriq-app-chrome`.
2. TigerIQ News / Media — `tigeriq-news`.
3. Paperclip vNext — `paperclip-vnext`.
4. Revenue Lab — `revenue-lab`.
5. TigerIQ Driver — `tigeriq-driver` (gồm DeX Shot, repo riêng `newsdayads/drivetrack`).
6. DeXCam Personal — `dexcam-personal` (UltraCarVN, khác DeX Shot).
7. TigerIQ Coin — `tigeriq-coin` (4 repo mã khai thác, mặc định không vận hành).

Group `tigeriq-ai` là lớp tổng hợp, không phải một dự án thay thế `tigeriq-platform`. Những thành phần dùng chung của Core vẫn có `kind=platform`. Danh sách nhóm không tự cấp quyền chạy AI, ghi dữ liệu hay phát hành.
Cấu hình `projects/portfolio.yaml` là khai báo danh mục; chưa khẳng định được nghiệm thu giao diện thực tế hoặc GitHub Projects đã được tạo.

Dự án mới không được hard-code vào UI. Issue mới có thể khai báo:
```
PROJECT_ID=<stable-slug>
PROJECT_NAME=<owner-facing-name>
WORKSTREAM_ID=<stable-slug>
WORKSTREAM_NAME=<owner-facing-name>\nJOB_ID=<stable-job-id>\nASSIGNEE=<NVxx|Owner>\nDEPENDENCIES=<#issue,...>\nNEXT_ACTION=<owner-facing-next-action>
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


## Cấu trúc thư mục chuẩn
- Product project: `projects/<project-id>/project.yaml` + `workstreams/`
- Shared platform: `platform/<platform-area>/project.yaml`
- Không tạo thư mục theo issue/version chỉ để phản ánh backlog.
- `WORK_PACKAGE_*` tiếp tục được đọc như alias tương thích ngược cho `WORKSTREAM_*`.

## Owner-facing work list
Mỗi Job phải có thể hiển thị tối thiểu:
`Dự án → Nhánh → JOB → Người nhận → Trạng thái → Bước hiện tại → Bước tiếp theo`.
