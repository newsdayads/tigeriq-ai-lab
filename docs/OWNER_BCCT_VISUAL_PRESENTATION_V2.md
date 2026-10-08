# TIGERIQ — CHUẨN TRÌNH BÀY BCCT TRỰC QUAN V2
Version: 2.0
Status: Owner-approved P0 presentation contract
Date: 2026-10-08
Authority: Owner direct instruction > Constitution/Workflow > Interaction Policy issue #504 > this specification
Work Order: #4545 — Chuẩn hóa báo cáo trực quan có màu, icon, biểu đồ và tương tác

## Phạm vi
Áp dụng cho lệnh `bcct`, `báo cáo chi tiết`, `bc chi tiết` trong ChatGPT/TigerIQ Owner-facing khi công cụ kết xuất giao diện hỗ trợ. Các lệnh `bc`, `báo cáo`, `tiến độ` giữ Dashboard nhanh và được phép dùng cùng ngôn ngữ trực quan. Đây là đặc tả trình bày, **không tự động thay đổi** mã hoặc cách phát hành trang TigerIQ Live, Core, Android, App Chrome; không tác động trực tiếp lên trạng thái/runtime.

## Cấu trúc báo cáo bắt buộc — 6 phần
1. **Tổng tiến độ**: thẻ trạng thái và tổng việc theo mẫu đã được xác minh. Không hiển thị % tổng khi chưa biết mẫu số/thước đo.
2. **Hạng mục chính**: bảng hoặc thẻ có mã + tiêu đề chuẩn, độ ưu tiên, trạng thái thật, nguồn truy xuất.
3. **P0 bị chặn/cần chú ý**: chỉ liệt kê trở ngại P0 thật; phân biệt đang nghiệm thu, chờ duyệt và lỗi xác thực.
4. **Đang xử lý**: chỉ xác nhận đang chạy khi có bằng chứng cập nhật; nếu không, ghi trạng thái hồ sơ và thời điểm chứng cứ.
5. **Nhân sự AI**: vai trò/tài nguyên và trạng thái trực tiếp chỉ khi có kiểm tra vận hành; nếu không, ghi 'chưa xác minh trực tiếp'.
6. **Mốc kế tiếp**: bước thực thi thật, người chịu trách nhiệm, điều kiện mở khóa và tham chiếu nguồn.

BCCT chi tiết bắt buộc bổ sung trong các phần phù hợp: bằng chứng kỹ thuật; Work Order, Issue và PR; lỗi/trở ngại; thay đổi từ lần kiểm tra trước; tiến độ kỹ thuật không phỏng đoán. Không dùng phần trăm 100% cho việc chưa hoàn tất.

## Giao diện trực quan — trong khả năng nền tảng
- **Thẻ số liệu**: nền pastel hoặc màu có độ tương phản đạt yêu cầu; dùng ít thành tố, số lớn và nhãn rõ.
- **Màu ngữ nghĩa**: xanh lá = hoàn tất *đã xác minh*; xanh dương = đang xử lý *có bằng chứng*; vàng/hổ phách = đang chờ; đỏ = lỗi hoặc trở ngại P0 thực sự; xám = chưa rõ/không có dữ liệu.
- **Biểu tượng**: dùng Lucide/vector theo ngữ cảnh (máy tính, bộ não AI, điện thoại, lịch, khóa, kiểm tra). Emoji trạng thái/đầu mục trực tiếp chỉ thuộc bộ canonical `✅ ⚙️ ⏳ ⚠️ 🔒 💡 📌 ➡️`; **không** thay thế nhãn tiếng Việt bằng màu hay emoji tròn.
- **Biểu đồ**: chỉ từ dữ liệu đã kiểm chứng, có tiêu đề, phạm vi mẫu số và dấu thời gian; chọn cột/tròn/đường đúng mục đích. Không dùng số liệu demo dưới nhãn 'toàn dự án'.
- **Tương tác**: thẻ lọc (tất cả / chưa xong / P0 / đã xong), chọn việc và xem chi tiết; các nút phải hoạt động, trỏ đúng nguồn/động tác thật. Không dùng nút giả.
- **Di động**: bố cục tự chuyển 2 cột → 1 cột khi màn hẹp, chữ ngắn dễ đọc trên iPhone; không kéo ngang. Ánh xạ sang bản chữ nếu nền tảng không hỗ trợ giao diện/tương tác.
- **Tính trung thực**: nếu dữ liệu lỗi/cũ, hiển thị cảnh báo/nguồn dự phòng; tuyệt đối không suy diễn PC01 đang online hoặc AI đang làm việc từ phân công GitHub.

## Phân biệt nền tảng
Giao diện BCCT của ChatGPT có thể tạo ngay trong câu trả lời bằng các thành phần hiển thị được hỗ trợ. Việc ghi quy tắc vào repository và Issue #504 khiến các phiên có tải canonical biết chuẩn đã duyệt, **không tạo ra tính năng sản phẩm mới** và **không chứng minh** tự động đồng bộ mọi tài khoản/mọi phiên khi chưa có hồi quy trên nền tảng đó.

## Cổng nghiệm thu
- [ ] Đúng 6 phần; BCCT mở rộng kỹ thuật nhưng vẫn gọn.
- [ ] Thẻ màu, biểu tượng vector hợp lệ, tương phản và bố cục iPhone.
- [ ] Bộ lọc/chọn hạng mục/tác vụ mở nguồn có hành động thật.
- [ ] Biểu đồ có dữ liệu thật hoặc được ghi rõ phạm vi mẫu, không phỏng đoán %.
- [ ] Mã Issue/PR có tên chuẩn tiếng Việt; quy tắc icon canonical được giữ.
- [ ] Đối chiếu nguồn động, ghi dấu thời gian; chưa đủ bằng chứng phải ghi rõ.
- [ ] Không thay đổi App Chrome/Live/Core, không phát sinh chi phí hay Codex.
- [ ] Rà soát độc lập khi cổng nguồn yêu cầu; hợp nhất đúng mã commit; đọc lại `main` và #504 để xác minh.

## Kiểm thử thủ công
1. Gõ `bcct` khi đã có dữ liệu nguồn: dashboard màu đúng nghĩa và đủ 6 phần.
2. Chọn bộ lọc P0: không trộn các việc P1 và không gán lỗi cho P0 chỉ vì chưa nghiệm thu.
3. Chọn việc: mở chi tiết đúng mã + tiêu đề đầy đủ; nút GitHub mở đúng liên kết.
4. Dữ liệu thiếu: biểu đồ/% không xuất hiện hoặc ghi nguồn mẫu minh họa; không báo hoàn tất giả.
5. Trên iPhone: bố cục không tràn ngang, ưu tiên đọc nhanh, không hiển thị mọi chi tiết mặc định.
