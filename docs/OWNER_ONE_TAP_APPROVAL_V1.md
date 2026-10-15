# TIGERIQ — PHÊ DUYỆT MỘT CHẠM V1 (P0)
Ngày Owner giao: 2026-10-14. Nguồn: Issue #504 — [P0][QUẢN TRỊ] Chính sách tương tác + hiển thị nhân sự chuẩn. Các phiên đọc nguồn chuẩn sẽ lấy quy tắc theo Loader GitHub main.

## Mục tiêu
Mọi giao diện do TigerIQ kiểm soát và mọi cuộc trò chuyện có tải nguồn chuẩn ưu tiên nút DUYỆT / TỪ CHỐI khi thật sự thiếu quyền mới. Vy tự xác định hành động cần duyệt, soạn câu lệnh, tóm tắt phạm vi. Không buộc anh Sơn tự tìm điểm duyệt trong báo cáo dài.

## Quy tắc hành động
1. Nếu việc đã ủy quyền đúng phạm vi, an toàn, có thể hoàn tác và không chi phí: tự thực hiện, KHÔNG mở thẻ duyệt.
1a. **BẮT BUỘC TỰ HIỆN NÚT:** Ngay khi cần anh Sơn duyệt, từ chối, xác nhận việc đã làm hoặc thực hiện thao tác Owner ở bước tiếp theo, đặt nút có callback thật trên đầu phản hồi hiện tại. Không đợi anh nhắc "đưa Button", không chôn hành động trong văn bản dài. Tên nút phải đúng chức năng: mở hồ sơ thì ghi MỞ HỒ SƠ, gửi tin thì ghi GỬI QUYẾT ĐỊNH; không giả một cú bấm gửi tin là giấy phép/cổng ký đã được cấp. Chỉ áp dụng trên bề mặt có UI hỗ trợ; khi không hỗ trợ thì đưa đúng đường dẫn/khung Copy và nêu rõ giới hạn.
2. Thiếu quyền mới: trình ngay đầu một thẻ chỉ cho một hành động, một phạm vi, tác động, rủi ro, chi phí, hoàn tác, nguồn xác minh. Nhiều quyền độc lập cần tách thành các thẻ.
3. Nếu có sự kiện bấm thật: DUYỆT / TỪ CHỐI. Bấm DUYỆT chỉ gửi một câu lệnh đúng phạm vi vào kênh được hỗ trợ; chưa được coi là có quyền trước biên nhận của hệ thống đích. Bấm TỪ CHỐI không thực thi.
4. Không tự bấm thay Owner, không giả chữ ký/quyền, không cho trạng thái đã cấp quyền khi chỉ mới hiện nút hoặc gửi tin nhắn.
5. Không có nút thật: đưa đúng một khung Copy một dòng bắt đầu LÀM — NO YAPPING. và nội dung cụ thể. Không dựng nút chỉ để trang trí.
6. Thiếu nguồn kiểm chứng hoặc nguồn cũ: không đưa nút duyệt; báo CHƯA XÁC MINH, tiếp tục bước điều tra an toàn.
7. Đối chiếu quyền đã có, không hỏi lại cùng quyền. Sau thay đổi phạm vi phải dùng mã yêu cầu mới.

## Hợp đồng kỹ thuật
- Bộ kiểm tra dùng chung: apps/shared/owner-one-tap-approval.mjs.
- Yêu cầu có requestId, status=OWNER_GATE, requiresNewAuthorization=true, một gate cụ thể, hành động/phạm vi/tác động/rủi ro/chi phí/hoàn tác/nguồn. Cờ nguồn verified=true, fresh=true phải do bộ chuyển đổi đáng tin tự xác minh, không nhận từ dữ liệu ngoài chưa xác thực.
- Chỉ hiển thị nút khi có hàm gửi tin và giao diện bắt sự kiện bấm thật. Không tự phát lệnh khi kết xuất; không gửi hai lần một yêu cầu; lỗi không được báo thành công.
- Giữ cơ chế giới hạn từng lệnh RDC theo lệnh/đối số/quyền thực tế, không suy diễn "toàn quyền" thành phiếu vượt cổng. Codex chỉ khi Owner nêu rõ Codex và phạm vi.
- Giữ các cổng: trả phí/tài chính, thông tin xác thực, ranh giới bảo mật, phá hủy/không thể hoàn tác, pháp lý/vật lý, phát hành thực tế tùy chính sách.
- App Chrome là nguồn cục bộ PC01, không được sửa/triển khai qua GitHub.
- Nút không thay thế xác nhận bắt buộc của Windows, iOS, GitHub hoặc nhà cung cấp.

## Nghiệm thu từng bề mặt
| Bề mặt | Bằng chứng tối thiểu |
|---|---|
| ChatGPT phiên hiện tại | Nút gửi đúng một tin sau khi bấm, không tự gửi khi hiển thị |
| ChatGPT Plus/Go chat mới | Nạp Loader + Issue #504 và thử đúng cổng/đã có quyền trên từng tài khoản |
| Gemini Pro | Kiểm tra thực tế có nút hay chỉ Copy, không tự đoán khả năng |
| TigerIQ LIVE / Web Control / BCCT | Nối thư viện vào trình kết xuất với dữ liệu xác minh; thử nhấn + xác nhận biên nhận |
| PC01/Core/GitHub | Xác nhận sự kiện tài khoản Owner, quyền hiện hành và biên nhận thực thi đích; không giả chữ ký |
| Bề mặt khác | Chỉ đánh dấu hoàn tất sau khi kiểm chứng thật từng nơi |

## Trạng thái
Nguồn V1 cung cấp đặc tả + thư viện kiểm tra + kiểm thử, CHƯA chứng minh đã nối vào mọi giao diện, cài PC01 hoặc thay đổi ChatGPT nguyên bản. Chính sách GitHub không thể cưỡng chế mọi phiên chat/nhà cung cấp chưa nạp nguồn.

Cổng HOÀN TẤT = kiểm thử/kiểm tra nguồn → hợp nhất có bảo vệ → tích hợp đường hiển thị thật → nghiệm thu nút trên từng bề mặt → biên nhận đích → đọc lại trạng thái.

DRIVE_SYNC=NOT_REQUIRED: Loader và 5 Bootstrap không đổi, Issue #504 đã là điểm nạp động. Nếu sau này Loader đổi, đồng bộ chính xác bản Drive sau hợp nhất và thử chat mới.
