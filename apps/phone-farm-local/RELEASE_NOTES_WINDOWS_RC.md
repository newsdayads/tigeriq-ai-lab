# TigerIQ Phone Farm — Windows v0.5.0 RC (PC01)

## Trạng thái
**Đã có ứng dụng Windows EXE dùng được trên PC01. Chưa nghiệm thu FULL tương đương LAIXI.**

- Ứng dụng desktop `TigerIQPhoneFarm.exe` (.NET 8 WinForms + WebView2) là cửa sổ Windows thật, tích hợp bộ điều khiển Node cục bộ. Không cần mở Chrome hoặc đăng nhập LAIXI.
- Runtime Node 24.19.0 được đóng cùng bản phát hành. Cài WebView2 Evergreen (PC01 đã có), ADB và scrcpy được dùng từ PC01. Không kết nối máy chủ cấp phép.
- Giao diện xanh/trắng tham chiếu bố cục công khai LAIXI: lưới màn hình, tab General/Tasks/Toolbox, nhóm, đồng bộ chạm/phím, truyền tệp, quản lý ứng dụng, macro, lịch và ghi hình MKV.
- Có giới hạn an toàn lệnh, chỉ dùng loopback 127.0.0.1 và ADB do chủ thiết bị cấp quyền. Không chứa mã/chỉnh sửa binary LAIXI.

## Bằng chứng nghiệm thu
- GitHub Phone Farm CI: 16/16 Node tests PASS trên Node 22.
- PC01: 16/16 Node tests PASS; một điện thoại Samsung SM-G977N kết nối ADB; ảnh và điều khiển thực tế hoạt động.
- Ghi màn hình thực: 8 giây, file MKV 2.081.357 bytes, SHA-256 `861DC68BD044CBA2A08FFEE0386AFD4FA3DFB780CEF867202E3AEAD52C009896`.
- Tệp Android upload hash trùng; macro thực 3/3; lịch thật kích hoạt 1/1.
- Windows x64 self-contained EXE biên dịch và khởi chạy ở Desktop Session 1 PC01. Ảnh nghiệm thu trên máy `D:\TigerIQ\Apps\TigerIQ-PhoneFarm\exe-accept.jpg` thể hiện cửa sổ TigerIQ và ảnh Android. Không phát tán ảnh màn hình riêng tư.

## Chưa đạt
- Chưa có 2+ điện thoại vật lý để thử đồng bộ/tải; chưa đạt tiêu chí 20/100/300 thiết bị.
- APK install thật, Auto.js parity, chạy offline ngắt Internet có kiểm soát và chức năng đa PC chưa được nghiệm thu đầy đủ.
- Bản EXE chưa ký số; không khẳng định tương thích mọi Windows hoặc bằng LAIXI 100%.

## Phát hành và an toàn
- Dùng riêng trong thư mục đã giải nén, không xóa bản LAIXI cũ. **Không tắt Defender, không vượt kiểm tra toàn vẹn.**
- Giữ `NODE_LICENSE.txt`, `DOTNET_LICENSE.txt`, `DOTNET_THIRD_PARTY.txt`, `WEBVIEW2_LICENSE.txt`, `WEBVIEW2_NOTICE.txt` đi kèm. Không cung cấp lại scrcpy/ADB trong ZIP.
- Nguồn mã và kiểm thử: nhánh `feat/tigeriq-phone-farm-local-v1`; theo dõi GH-5291/PR-5292.
- Bản phát hành này là **RC — chưa phải release FULL**.
