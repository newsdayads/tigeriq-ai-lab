# TigerIQ Phone Farm — Windows v0.5.0 RC

**Dành cho Windows 64-bit, dùng nội bộ trên PC01.** Đây là ứng dụng TigerIQ độc lập, không dùng máy chủ hoặc bản quyền LAIXI. Chưa nghiệm thu đầy đủ chức năng giống LAIXI hoặc hiệu năng nhiều thiết bị.

## Cách sử dụng trên PC01

1. Mở shortcut **TigerIQ Phone Farm** trên Desktop hoặc chạy `TigerIQPhoneFarm.exe` trong thư mục đã giải nén.
2. Ứng dụng hiển thị một cửa sổ Windows WebView2 và tự khởi động máy chủ Node nội bộ tại `127.0.0.1:8765` khi cần. Node.js đã đi kèm bản Windows này; không cần mở Chrome.
3. Cắm điện thoại/Box Android, bật USB Debugging và cấp quyền ADB cho PC01.
4. Bấm **Refresh USB**, chọn máy qua thẻ màn hình, dùng **General / Tasks / Toolbox** để điều khiển, đồng bộ, cài APK/tải tệp, chạy macro, lịch chạy và ghi màn hình.
5. Ghi video lưu `recordings/…mkv` trong thư mục ứng dụng; file upload/APK do người dùng chép vào `drop/` trước khi sử dụng.

## Điều kiện

- Máy Windows 64-bit; WebView2 Evergreen Runtime có sẵn trên PC01.
- **PC01:** ADB và scrcpy đã có tại `D:\TigerIQ\Tools\platform-tools\adb.exe` và `D:\TigerIQ\Tools\scrcpy\scrcpy-win64-v4.1\scrcpy.exe`.
- Máy Windows khác: cần cài Android SDK Platform Tools và scrcpy chính hãng, sau đó cấu hình biến môi trường `TIGERIQ_ADB`, `TIGERIQ_SCRCPY`.
- Bản RC **không bao gồm** ADB/scrcpy và không can thiệp vào LAIXI gốc. Node runtime đi kèm được cung cấp cùng `NODE_LICENSE.txt`.
- Tệp EXE **chưa có chữ ký số của TigerIQ**; bản phát hành có SHA-256 để đối chiếu. Không tắt Defender hoặc bỏ qua cảnh báo toàn vẹn để sử dụng.

## Đã nghiệm thu

- Bản Node: GitHub CI Node 22 **16/16 PASS**; PC01 cùng bộ mã nguồn **16/16 PASS**.
- EXE Windows x64 tự chứa .NET runtime đã build từ `windows/TigerIQPhoneFarm.csproj` và chạy ở **Session 1 PC01**.
- Desktop screenshot đã xác minh EXE hiển thị giao diện TigerIQ và lưới 1 Samsung thật; backend `127.0.0.1:8765` trả health OK.
- Ghi MKV thật: Samsung SM-G977N, 8 giây, 2.081.357 bytes, SHA-256 `861DC68BD044CBA2A08FFEE0386AFD4FA3DFB780CEF867202E3AEAD52C009896`; thử nghiệm giữ cục bộ trên PC01.
- Đã thử upload file đối chiếu SHA-256, macro thực 3 bước, lịch thực kích hoạt trên 1 máy. **Chưa nghiệm thu APK cài/gỡ thực hoặc 2+ thiết bị.**

## Giới hạn và gỡ cài đặt

- Chưa có bằng chứng cho 20–300 máy, đa PC, Auto.js tương thích hoàn toàn, tất cả chức năng LAIXI hay thử nghiệm ngắt Internet thật. Đây là **bản RC dùng được trên 1 máy**, không được tự nhận FULL.
- Đóng cửa sổ sẽ dừng backend Node do chính EXE khởi tạo; nếu backend đã chạy sẵn, EXE không dừng tiến trình của chương trình khác.
- Để gỡ, đóng EXE rồi xóa thư mục bản RC và shortcut, không xóa thư mục LAIXI hoặc dữ liệu Android.

Liên kết theo dõi: https://github.com/newsdayads/tigeriq-ai-lab/issues/5291
