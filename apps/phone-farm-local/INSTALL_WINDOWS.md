# TigerIQ Phone Farm — Windows RC

## Cài theo user, không cần Administrator

1. Giải nén gói Windows.
2. Giữ nguyên các file LICENSE/NOTICE và `BUILD_MANIFEST.json`.
3. Chạy PowerShell: `powershell -ExecutionPolicy Bypass -File .\install-user.ps1`.
4. Mở shortcut **TigerIQ Phone Farm** trên Desktop.
5. Cắm Android đã bật USB Debugging và cấp quyền ADB cho PC.

Mặc định installer copy runtime vào `%LOCALAPPDATA%\TigerIQ\PhoneFarm`, tạo `drop\` và `recordings\`, rồi tạo shortcut. Không cài driver, không đổi firewall, không sửa RDC và không chạm LAIXI.

PC01 đã có ADB và scrcpy riêng tại `D:\TigerIQ\Tools\...`. Máy khác phải cài ADB/scrcpy từ nguồn chính thức rồi đặt `TIGERIQ_ADB` và `TIGERIQ_SCRCPY`.

## Gỡ bỏ

Chạy `powershell -ExecutionPolicy Bypass -File .\uninstall-user.ps1` từ gói đã giải nén. Mặc định recordings/drop được chuyển sang thư mục backup trong `%LOCALAPPDATA%\TigerIQ\` trước khi xóa runtime. Chỉ dùng `-RemoveData` khi chủ sở hữu muốn xóa cả dữ liệu Phone Farm.

## Kiểm tra toàn vẹn

Đọc `BUILD_MANIFEST.json`, tính SHA-256 của `TigerIQPhoneFarm.exe`, `node.exe`, `WebView2Loader.dll` và đối chiếu. TigerIQ EXE hiện chưa ký số; Node và WebView2Loader trên PC01 có chữ ký nhà phát hành hợp lệ. Không tắt Defender/SmartScreen.

## Trạng thái nghiệm thu 26/10/2026

Đã thử 19 Android thật đồng thời; screenshot 19/19; APK install/launch/stop/uninstall 2/2; clipboard; macro cancel; scheduler phục hồi sau backend kill; MKV 5 giây. WiFi ADB LAN thật chưa PASS vì TCP/5555 từ PC01 tới điện thoại bị topology hiện tại chặn.
