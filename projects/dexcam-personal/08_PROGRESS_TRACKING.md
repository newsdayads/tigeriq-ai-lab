# 08 — Cách theo dõi DeXCam Personal trên TigerIQ

## Nguồn tiến độ hiện hành
- **Issue chính (duy nhất):** https://github.com/newsdayads/tigeriq-ai-lab/issues/4625
- **Yêu cầu hợp nhất tài liệu:** https://github.com/newsdayads/tigeriq-ai-lab/pull/4626
- **Quy tắc:** Mọi tiến độ của Issue được xác định từ danh sách `- [x]` và `- [ ]` trong mục **THEO DÕI TIẾN ĐỘ — 30 MỐC CÓ BẰNG CHỨNG** của Issue chính, không tính nhẩm từ ngày bắt đầu hoặc chỉ bởi số trang tài liệu.
- **Nguồn dữ liệu nội bộ:** `api/live-status.mjs` có `progressForIssue`. Chỉ nhận tỷ lệ từ checklist nếu `PROGRESS_VERIFIED=true` hoặc `PROGRESS_SOURCE=VERIFIED_CHECKLIST`. Nếu trạng thái chưa kết thúc, không nhận 100%.
- **Hiển thị:** 4/30 được làm tròn thành **13% của 30 mốc nghiệm thu**, **không phải 13% giờ công, 13% chức năng đã xây hoặc tỷ lệ APK hoàn thiện**.
- **Độ phủ:** 4/6 mốc tài liệu; chưa lập trình bất kỳ phần nào.

## Hướng dẫn theo dõi cho chủ sở hữu
1. Vào **TigerIQ Live → Dự án DeXCam Personal → Hồ sơ công việc GH-4625** (nếu bản giao diện Live đã đồng bộ).
2. Xem tên bước A01…F05, dấu hoàn thành, bằng chứng có liên kết, bước đang chờ, người điều phối.
3. Chọn **Mở GitHub** để đối chiếu danh sách đầy đủ trong Issue nếu bản giao diện Live đang dùng dữ liệu cũ.
4. Xem PR liên quan để biết trạng thái tài liệu đang là bản nháp, được rà soát hay đã hợp nhất; không coi PR mở là hoàn tất.
5. Khi bổ sung tính năng, cập nhật checklist/phụ thuộc/tiêu chí nghiệm thu trước khi thay đổi mẫu số.

## Quy tắc phân vai và trạng thái
- **VY:** điều phối và cập nhật hồ sơ (không suy ra nhân sự lập trình đang chạy).
- **P1 (Owner chuyển ngày 2026-10-10):** NV02 được tiếp tục phần đặc tả trong phạm vi đã cấp; không suy ra Core đã nhận việc, và không dỡ khóa `IMPLEMENTATION_AUTHORIZATION=false`. Dữ liệu `P0` trong các bản ghi cũ chỉ có giá trị lịch sử.
- **Chỉ đặc tả:** không bị chặn kỹ thuật do chưa cấp quyền viết app; phần viết app **chủ động để chưa được phép** cho tới khi Owner ra lệnh.
- **Rà soát tài liệu:** là bước đang chờ nghiệm thu kỹ thuật, không phải yêu cầu Owner cấp quyền lại cho việc đã giao.
- Nếu màn hình ghi *BỊ CHẶN vì không thuộc hàng đợi*, đó là trạng thái đủ điều kiện điều phối tự động của P0, **khác** với kết luận tiến độ kỹ thuật dự án bị lỗi; cần kiểm tra cột nguồn mới trước khi khẳng định là lỗi.

## Bắt buộc khi đánh dấu hoàn tất
- Mỗi mốc chuyển từ `[ ]` sang `[x]` phải có URL/số liệu/tệp kiểm thử cho đúng mã và ngày.
- Không sửa tay `PROGRESS_PERCENT` để tạo số đẹp. Chỉ dùng `PROGRESS_SOURCE=VERIFIED_CHECKLIST` và checkbox làm nguồn xác thực.
- Nếu mẫu số tăng do Owner thêm tính năng, công bố lại mẫu số và tiến độ. Nếu xóa mốc, phải ghi lý do vào nhật ký quyết định.
- Tiến độ **phát triển mã nguồn** được báo riêng theo mốc D/E/F, không hòa lẫn thành bằng chứng chức năng chạy thật từ mốc tài liệu A/B/C.
- Không khẳng định TigerIQ Live đã cập nhật ngay nếu chưa đọc được dữ liệu hiển thị sau đồng bộ.

## Đồng bộ dự án vào nguồn chuẩn
- Hồ sơ quản lý Issue hiện có trên GitHub.
- `project.yaml` và hồ sơ Markdown hiện trên nhánh `docs/dexcam-personal-project-20261009`.
- Chỉ sau khi PR qua kiểm tra và hợp nhất `main`, kho chính thức mới có thể dùng các tài liệu dạng file; Issue vẫn là nguồn tiến độ động.
- Khi đổi nguồn/qui tắc theo dõi, cần kiểm tra bộ đọc TigerIQ Live và xác minh đúng giao diện thực tế. Không tự cài/sửa code Live chỉ bằng đăng ký dự án.
