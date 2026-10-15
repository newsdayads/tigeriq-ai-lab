# 08 — Cách theo dõi DeXCam Personal trên TigerIQ

## Nguồn tiến độ hiện hành
- **Issue chính (duy nhất):** https://github.com/newsdayads/tigeriq-ai-lab/issues/4625
- **Yêu cầu hợp nhất hiện hành (đã hợp nhất):** https://github.com/newsdayads/tigeriq-ai-lab/pull/4815 · commit main 4706ea7059ed0c4cc3d0931b84d9a784dfb2ceb6. PR #4626 là hồ sơ cũ đã đóng, không hợp nhất.
- **Quy tắc:** Mọi tiến độ của Issue được xác định từ danh sách `- [x]` và `- [ ]` trong mục **THEO DÕI TIẾN ĐỘ — 30 MỐC CÓ BẰNG CHỨNG** của Issue chính, không tính nhẩm từ ngày bắt đầu hoặc chỉ bởi số trang tài liệu.
- **Nguồn dữ liệu nội bộ:** `api/live-status.mjs` có `progressForIssue`. Chỉ nhận tỷ lệ từ checklist nếu `PROGRESS_VERIFIED=true` hoặc `PROGRESS_SOURCE=VERIFIED_CHECKLIST`. Nếu trạng thái chưa kết thúc, không nhận 100%.
- **Hiển thị nguồn đã nghiệm thu ngày 15/10/2026:** 5/30 = **17% mốc nghiệm thu khi làm tròn**, **không phải 17% giờ công, 17% chức năng ứng dụng hay mức hoàn thiện APK**. Khi Issue đổi, lấy checklist hiện hành trực tiếp thay vì cố định số này.
- **Độ phủ:** 5/6 mốc A; A05 chưa có biên nhận rà soát độc lập. A06 đã nghiệm thu qua 3 quy trình GitHub đúng HEAD, hợp nhất và đọc lại main. Không có bằng chứng chạy ứng dụng/thiết bị.

## Hướng dẫn theo dõi cho chủ sở hữu
1. Vào **TigerIQ Live → Dự án DeXCam Personal → Hồ sơ công việc GH-4625** (nếu bản giao diện Live đã đồng bộ).
2. Xem tên bước A01…F05, dấu hoàn thành, bằng chứng có liên kết, bước đang chờ, người điều phối.
3. Chọn **Mở GitHub** để đối chiếu danh sách đầy đủ trong Issue nếu bản giao diện Live đang dùng dữ liệu cũ.
4. Xem trạng thái **thực tế trên GitHub** của PR tài liệu (mở, bản nháp, đã qua rà soát, đã hợp nhất); không suy ra `draft` từ Issue hoặc tài liệu tĩnh, và không coi PR mở là hoàn tất.
5. Khi bổ sung tính năng, cập nhật checklist/phụ thuộc/tiêu chí nghiệm thu trước khi thay đổi mẫu số.

## Quy tắc phân vai và trạng thái
- **VY:** điều phối và cập nhật hồ sơ (không suy ra nhân sự lập trình đang chạy).
- **P1 (Owner cập nhật 12/10/2026):** Work Order cho phép phát triển phần mềm có điều kiện và đưa vào hàng đợi; không có biên nhận Core claim thì chưa thể báo đang thực thi. Nhãn `P0` cũ chỉ là lịch sử.
- **Phần dở hiện hành:** A01–A04 và A06 đã nghiệm thu; A05 chưa có rà soát độc lập (miễn rà soát AI tùy chọn không phải phê duyệt A05), B01–B05 cần số đo Android/DeX/USB/số R thật. G1/G2 chưa đạt; không tự nhận đã viết APK, thử xe hay có quyền cài.
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
- `project.yaml` và 9 tài liệu Markdown của DeXCam đã tồn tại trên GitHub `main` sau PR #4815, commit `4706ea7059ed0c4cc3d0931b84d9a784dfb2ceb6`. Nhánh cũ `docs/dexcam-personal-project-20261009` là lịch sử; không tính lại mốc chỉ vì tài liệu được thêm.
- PR #4815 đã qua kiểm tra và hợp nhất `main`; Issue GH-4625 vẫn là nguồn tiến độ động. B01 chỉ có thể được nghiệm thu với bằng chứng máy thật, không phải vì đã có tài liệu hay bộ kiểm tra offline.
- Khi đổi nguồn/qui tắc theo dõi, cần kiểm tra bộ đọc TigerIQ Live và xác minh đúng giao diện thực tế. Không tự cài/sửa code Live chỉ bằng đăng ký dự án.

## B01 — Cổng kiểm tra chứng cứ trước nghiệm thu (chưa đo thiết bị)
- [Hướng dẫn B01](B01_EVIDENCE_ADMISSION.md) và [bộ kiểm tra dữ liệu ngoại tuyến](b01-evidence-admission.mjs) chỉ kiểm tra đủ trường, phân loại và chống lộ dữ liệu. Các phép thử dùng fixture tổng hợp, không phải thiết bị thật.
- Giá trị đầu vào có vẻ hợp lệ chỉ tạo `CANDIDATE_NEEDS_DEVICE_REVIEW`; `b01_accepted=false` cho mọi đầu vào. Quyền tạo/checklist B01 tiếp tục cần bằng chứng thiết bị thực và quyền thích hợp; không tự tích ô `[x]`.
- Mọi biên nhận về chính chương trình và kiểm thử phải gắn vào Work Order; không thay dữ liệu B01 thực.
