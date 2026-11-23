# PC01 — bố trí lưu trữ TigerIQ trên ổ D

## Quyết định Owner ngày 2026-11-23

Tệp dự án, dữ liệu và cấu hình vận hành TigerIQ trên PC01 phải nằm dưới `D:\TigerIQ`, theo thư mục có tên và chức năng rõ ràng. Không tạo mới hoặc duy trì phụ thuộc vận hành vào `F:\TigerIQ`. Thay đổi này là quy tắc lưu trữ, không phải xác nhận các dịch vụ đã chuyển đổi hoặc nghiệm thu.

## Bố trí

| Nhóm | Đường dẫn |
|---|---|
| Nguồn dự án | `D:\TigerIQ\Workspace` |
| Bản cài vận hành dùng chung | `D:\TigerIQ\Runtime` |
| TigerIQ Driver | `D:\TigerIQ\Driver` với `data`, `images`, `backups`, `logs` |
| Dữ liệu dùng chung | `D:\TigerIQ\Data` |
| Dữ liệu PostgreSQL | `D:\TigerIQ\PostgreSQL` |
| Mô hình Ollama | `D:\TigerIQ\OllamaModels` |
| Nhật ký và bản sao lưu dùng chung | `D:\TigerIQ\Logs`, `D:\TigerIQ\Backups` |
| Lịch sử ngừng vận hành | `D:\TigerIQ\Archive` |
| Biên nhận chuyển dữ liệu | `D:\TigerIQ\Migration` hoặc thư mục `ops` của sản phẩm |
| Thông tin xác thực hiện hữu | `D:\TigerIQ\Secrets`, giữ nguyên kiểm soát truy cập; không đưa vào Git |

Các dự án đã có cấu trúc riêng trên D tiếp tục dùng cấu trúc đó; bảng không yêu cầu tái tổ chức mọi sản phẩm hoặc tạo kho trạng thái thứ hai. Tệp hệ điều hành và phần mềm hệ thống cài sẵn tuân theo vị trí Windows quản lý. Quy tắc không cấp quyền sửa mã nguồn trực tiếp trên PC01 hoặc thay đổi ranh giới bảo mật.

## Chuyển phụ thuộc cũ từ F

1. Kiểm kê đường dẫn trực tiếp và gián tiếp: dịch vụ, tác vụ định kỳ, tiến trình, cấu hình khởi động, biến môi trường, tệp khởi chạy/cấu hình được chúng sử dụng, mô hình, cơ sở dữ liệu và bản sao lưu. Ghi rõ phần bị hạn chế quyền; không coi phần không đọc được là không có phụ thuộc.
2. Xác nhận phạm vi ghi, quyền vận hành và khả năng hoàn tác. Lưu cấu hình trước thay đổi. Dừng ghi dữ liệu khi cần để chụp bản nhất quán; sao chép cơ sở dữ liệu đang chạy phải dùng quy trình sao lưu tương ứng.
3. Chuyển vào vị trí D phù hợp, bảo toàn tệp và đối chiếu số lượng, dung lượng, SHA-256. Thông tin xác thực phải giữ kiểm soát truy cập hiện hữu; không sao chép vào kho công khai hoặc thay khóa/quyền để vượt lỗi truy cập.
4. Đổi cấu hình vận hành đã xác minh sang D, gồm tác vụ sao lưu và đường dẫn khôi phục đang được sử dụng. Mã nguồn nếu cần sửa vẫn đi GitHub nhánh → PR → kiểm thử → rà soát → hợp nhất; cài đặt vận hành theo quyền tương ứng.
5. Kiểm tra dịch vụ thực chạy, đọc/ghi và sao lưu trên D; rà lại các phụ thuộc F. Tệp lịch sử trong kho lưu trữ không phải cấu hình vận hành và không được tự kích hoạt. Không thay mọi chuỗi F một cách máy móc, đặc biệt trong biên nhận, kiểm tra hồi quy và lịch sử Git.
6. Chỉ loại bỏ bản cũ sau khi đạt kiểm tra bảo toàn và vận hành, có quyền xóa và đường hoàn tác. Không dùng liên kết tại F để tiếp tục phụ thuộc ổ F. Khi quyền kiểm tra, chuyển, sửa cấu hình hoặc xóa bị từ chối, ghi đúng hành động bị chặn và tiếp tục phần độc lập an toàn; không đổi công cụ/tài khoản để vượt chặn.

## Nghiệm thu

Chỉ báo chuyển xong khi có biên nhận mới cho toàn phạm vi: dữ liệu bảo toàn, cấu hình hiệu lực trỏ D, dịch vụ/tác vụ và sao lưu hoạt động, không còn phụ thuộc vận hành F chưa xác minh, và bản cũ đã xử lý theo phạm vi được duyệt. Cập nhật tài liệu hoặc sao chép một bản sang D chưa phải nghiệm thu vận hành toàn hệ thống.
