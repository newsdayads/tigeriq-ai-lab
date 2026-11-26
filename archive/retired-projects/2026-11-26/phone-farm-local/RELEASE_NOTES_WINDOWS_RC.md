# TigerIQ Phone Farm — Windows v0.5 RC

## Đã nghiệm thu thực tế trên PC01

- Windows host tự phục hồi Node backend sau khi child process bị kill.
- 19 Android thật online; UI 19/19 card; screenshot 19/19; E2E 26.19 giây.
- Điều khiển HOME thật và đồng bộ nhiều máy hoạt động.
- Clipboard PC → Android input hoạt động.
- Realtime scrcpy nhận cấu hình FPS / kích thước / bitrate có whitelist; cấu hình ngoài whitelist bị HTTP 400.
- APK smoke: install, launch, force-stop, uninstall 2/2; artifact test đã dọn.
- Macro có cancel; scheduler bền vững chạy tiếp sau backend restart.
- Ghi MKV thật 5 giây, 53,134 bytes; cấu trúc EBML/Segment/Tracks/Cluster hợp lệ.
- Runtime chỉ bind loopback và không yêu cầu login/license server.
- Bundle không chứa LAIXI, upstream Qt/FFmpeg, ADB hay scrcpy.

## Chưa được phép quảng cáo

- Không tuyên bố LAN/WiFi ADB runtime PASS: điện thoại có IP LAN nhưng TCP/5555 không reachable từ PC01; đã restore USB mode.
- Không tuyên bố 20/100/300 thiết bị hoặc Auto.js đầy đủ.
- TigerIQ EXE chưa code-sign; sử dụng hash manifest và CI provenance.

Xem `SUPPLY_CHAIN_RC_20261026.md`, `INSTALL_WINDOWS.md`, GH-5291 và PR-5292.
