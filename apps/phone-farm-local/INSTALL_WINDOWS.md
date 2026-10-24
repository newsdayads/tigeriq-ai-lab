# TigerIQ Phone Farm — Cài đặt Windows (DEV v0.4)

## Sử dụng ngay trên PC01
1. Nhấp đúp `TigerIQ Phone Farm.cmd` trên Desktop PC01. Hoặc từ thư mục ứng dụng chạy `run-local.cmd`.
2. Ứng dụng mở trong Chrome tại `http://127.0.0.1:8765/`. Node.js, ADB và scrcpy đã có trên PC01.
3. Bật USB Debugging trên thiết bị Android, chấp thuận khóa ADB, sau đó chọn **Refresh USB**.
4. Chọn thiết bị bằng số dưới **Select devices**, hoặc tích ô trên đầu màn hình Android.
5. Điều khiển chạm/vuốt trên ảnh điện thoại, bật **Sync Mouse** để gửi tới nhóm đã chọn. Tab **Tasks** chứa macro/lịch; **Toolbox** chứa cài APK, truyền tệp, mở ứng dụng.

## Cài trên máy Windows khác
- Giải nén bản ZIP vào thư mục riêng; cài Node.js 20+ và Android SDK Platform Tools, scrcpy.
- Chỉnh biến môi trường `TIGERIQ_ADB` và `TIGERIQ_SCRCPY` tới đúng đường dẫn các tệp thực thi cục bộ.
- Nhấp đúp `run-local.cmd`.
- **Không phải tệp EXE/MSI tự chứa**: đây là bản preview kỹ thuật, chưa hoàn thành mục tiêu FULL.
- Dữ liệu phiên làm việc, lịch và tên máy sẽ chỉ lưu vào thư mục này. Không đưa thư mục `drop` hoặc `schedules.json` lên dịch vụ đám mây.

## Bảo mật
- Chỉ nghe `127.0.0.1:8765`, không mở mạng WAN, không cần tài khoản/máy chủ LAIXI.
- Chỉ kết nối WiFi ADB tới IP trong mạng LAN riêng đã được thiết bị cho phép. Không can thiệp Android lockscreen, root, phát hiện/né khóa bản quyền.
- APK/tệp phải được chủ sở hữu tự đặt trong thư mục `drop`, đặt tên theo mẫu an toàn.
- Macro chỉ cho phép lệnh chạm, vuốt, text ASCII, phím và đợi thời gian; không thực thi arbitrary shell.

## Gỡ và khôi phục
- Dừng tác vụ TigerIQ Phone Farm trên PC, sau đó xóa thư mục ứng dụng DEV.
- Bản LAIXI gốc và dữ liệu người dùng Android không bị sửa bởi quy trình cài đặt TigerIQ.
- Phần mềm Qt native thử nghiệm vẫn ở thư mục đánh giá riêng và không được phát hành lại dưới tên TigerIQ.

## Trạng thái kiểm thử
- PC01: 13/13 unit test đạt, trình duyệt Chrome/Puppeteer E2E đạt trên 1 Samsung.
- Giao diện lấy bố cục tham chiếu từ ảnh LAIXI công khai; **chưa ngang 100% về mọi thao tác hoặc số máy**.
- Chưa có xác nhận 20/100/300 máy, kết nối đa PC qua Internet hoặc Auto.js tương thích hoàn toàn.
