# TigerIQ Phone Farm — Windows Local RC

Ứng dụng Windows độc lập do TigerIQ viết để quản lý Android qua ADB/scrcpy cục bộ. Không dùng binary, tài khoản, máy chủ hoặc cơ chế cấp phép LAIXI. Không tuyên bố tương thích LAIXI 100% hay “không giới hạn” phần cứng.

## Chức năng đã triển khai

- Phát hiện nhiều thiết bị USB ADB; kết nối WiFi ADB chỉ tới IPv4 LAN riêng; tự refresh inventory; đổi tên và nhóm cục bộ.
- Lưới ảnh nhiều máy, điều khiển phóng lớn, chạm/vuốt/phím, đồng bộ nhóm, nhập ASCII và dán clipboard PC.
- Mirror realtime scrcpy với FPS 15/25/30/60, max-size 720/1080/1440/2160 và bitrate 2/4/8/12 Mbps.
- App Manager và thao tác nhóm: cài/gỡ/mở/force-stop APK/package, upload file vào `/sdcard/Download/TigerIQ/`.
- Macro tương đương Auto.js cho tập hành động được phép: `tap`, `swipe`, `key`, `text`, `wait`; có trạng thái, hủy và khóa thiết bị khi chạy.
- Scheduler bền vững một lần/chu kỳ 1–1440 phút; không replay backlog quá 1 giờ; sống qua backend restart.
- Screenshot PNG và ghi MKV cục bộ có kiểm tra EBML + Segment + Tracks + Cluster.
- Windows host có watchdog 3 giây tự phục hồi Node backend.

## Bằng chứng PC01 ngày 26/10/2026

- 19 thiết bị Android thật online đồng thời; UI hiển thị đủ 19 card.
- E2E UI: điều khiển HOME thật PASS; screenshot PNG 19/19 PASS; vòng E2E 24.54 giây.
- APK smoke tự tạo không quyền nhạy cảm: install 2/2, launch 2/2 có PID, force-stop 2/2, uninstall 2/2 và xác minh sạch.
- Clipboard PC → input Android qua UI PASS.
- Scheduler: lưu lịch, kill backend, watchdog phục hồi, lịch tiếp tục chạy HOME và hoàn thành; lịch QA đã xóa.
- Video 5 giây: 53,134 bytes, SHA-256 `D4189CD5C803BFEC689AE49FDC1FE27BE39618ECCF4D4D4AC88C38313F629A10`, MKV structural guard PASS.
- Runtime network: Node chỉ LISTEN `127.0.0.1:8765`; EXE không có TCP; không có login/password/license service.

## Hạn chế đã xác minh

- Một thử nghiệm WiFi ADB qua LAN có IP thật nhưng TCP/5555 không reachable từ PC01; thiết bị thử đã được trả về USB mode. Vì vậy không được tuyên bố LAN/WiFi runtime đã nghiệm thu trên topology hiện tại.
- ADB server restart đã tái phát hiện 19/19 thiết bị trong 500 ms; không tự nhận 20/100/300 máy.
- TigerIQ EXE hiện chưa có code-signing certificate. Dùng SHA-256 + CI để kiểm tra toàn vẹn; không tắt Defender/SmartScreen.
- Auto.js parity là tập macro tương đương có giới hạn, không phải engine Auto.js đầy đủ.

## Chạy từ source

Yêu cầu Windows, ADB và scrcpy được chủ sở hữu cài riêng. Mặc định PC01 dùng:
`D:\TigerIQ\Tools\platform-tools\adb.exe` và `D:\TigerIQ\Tools\scrcpy\scrcpy-win64-v4.1\scrcpy.exe`.

Tại `apps/phone-farm-local`:
`node --test test.mjs recording.test.mjs` rồi `node app.mjs`.
Controller chỉ mở `http://127.0.0.1:8765/`.

Theo dõi: GH-5291 và PR-5292.
