# NV07 — Canary khởi tạo một lần, chỉ đọc — Work Order #4783

Tình trạng: mã nguồn ứng viên; **CHƯA kết nối Core, CHƯA cài PC01, CHƯA xác thực CLI**.

## Nguyên nhân cần sửa

`nv07CoreRoutingDecision` chỉ cho phép nhân sự đã ACTIVE, có heartbeat và runtime được nghiệm thu. Đó là quy tắc phù hợp cho giao việc thường, nhưng **không thể dùng chính nó để chạy canary ban đầu** khi NV07 còn PROVISIONING.

## Phương án bổ sung, KHÔNG nới lỏng giao việc chính

- `nv07BootstrapCanaryDecision`: đường riêng cho 01 canary `READ_METADATA` với Work Order #4783, đúng PC01/wdragons12x, phiên Windows được xác minh, phê duyệt Owner từ kênh xác thực, lease Core thật có hạn, SHA ghim và idempotency.
- `runNv07OneShotCanary`: bộ nối sẵn cho host đáng tin cậy. Phụ thuộc callback xác minh phê duyệt, đọc lease Core, xác minh user/session, ghi đặt chỗ nguyên tử, thực thi CLI có giới hạn và lưu biên nhận bền. Thiếu bất kỳ callback/biên nhận nào sẽ từ chối.
- Chỉ dùng `prepareNv07CliProposal` và `verifyNv07CliProposal` hiện có; không cho ghi mã nguồn PC01, không mở shell tùy ý, không đăng nhập bằng tài khoản SYSTEM, không chạm App Chrome.
- Chỉ xuất `BOOTSTRAP_CANARY_PROPOSAL_VERIFIED_NOT_ACTIVE`. Không tự kích hoạt NV07, không ghi nhận đã test LIVE chỉ từ kiểm thử mô phỏng.

## Ràng buộc trước khi gọi thật

1. Host trên PC01 phải tự kiểm tra phê duyệt Owner xác thực, lease nguyên tử Core và thời hạn, nguồn `agy`, đúng phiên `wdragons12x`, hạn mức Google và môi trường cô lập. Callback do host cấp; **không nhận cờ xác minh từ nội dung job hoặc AI**.
2. Host phải thực thi chính xác lệnh/đối số đã chuẩn bị, chặn công cụ đọc bí mật/ghi file/chạy shell, giới hạn hệ điều hành và thời gian, xử lý huỷ/thoát tiến trình, loại bí mật khỏi nhật ký.
3. `reserveOnce` bắt buộc duy nhất/bền và `storeReceipt` phải ghi dấu vết thật. Khi lỗi không tự lặp cùng một job/không đổi khoá.
4. Dù unit test đạt cũng KHÔNG chứng minh có khả năng chặn ở mức hệ điều hành. Cần kiểm thử từ phiên PC01 thật, nhận kết quả JSON và xác minh hậu điều kiện.
5. Cổng PC01 Production/Updater cần chứng cứ ký phát hành theo chính sách hiện hành; hạn mức RDC chính 0%, không chuyển tài khoản để vượt giới hạn.
6. Thẻ công việc duy nhất #4783; không tạo thẻ con. Mọi chứng cứ và bước tiếp theo lưu tại đó.

## Nghiệm thu nguồn / thực tế

- [ ] CI đúng mã nhánh, kiểm thử phủ ca thành công/từ chối/quá hạn/trùng/không đủ bằng chứng.
- [ ] Rà soát độc lập đúng phạm vi hoặc miễn rà soát Owner hợp lệ; áp dụng cổng GitHub thực tế.
- [ ] Kết nối host callback thật với Core và thiết bị (chưa thực hiện trong PR này).
- [ ] Biên nhận chạy `agy` trong user session đúng, không sửa source, không thiếu bảo vệ.
- [ ] Kiểm thử S6/S7 và phục hồi đủ, chỉ sau đó xem xét chuyển ACTIVE.
