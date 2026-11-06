# UltraCar HCM — website đại lý tại TP.HCM

Tên miền đích: https://ultracar.tigeriq.io.vn/ · Hạ tầng: **PC01 + Cloudflare Tunnel**, không Vercel.

## Nguồn
- Trang hãng: https://ultracar.vn/ (kiểm kê công khai ngày 2026-11-06).
- 54 mã, thông số/giá biên tập dựa trên dữ kiện công khai; chênh lệch giá và NC888 được đánh dấu chờ xác minh.
- Logo chủ sở hữu cung cấp trực tiếp: `assets/ultracarhcm-logo-original.png` (PNG 1024×341 RGBA), SHA-256 `93411ebb0ed5197254819f908413fc54b213926435d3e3cea2f55002860baaf5`. Header/footer dùng nguyên ảnh này, không đặt tên thương hiệu lặp bên phải. Favicon SVG giữ nguyên vì phù hợp kích thước tab trình duyệt.
- Ảnh công khai của hãng được nhúng theo URL gốc trong media.js; 4 ảnh gallery và ảnh theo SKU lấy từ window.UCProductImages trên https://ultracar.vn/san-pham/. Không sao chép hàng loạt tệp ảnh hoặc nhận là ảnh tự chụp; mã thiếu ảnh có thông báo minh bạch. Cần xác minh quyền dùng lại lâu dài với UltraCar.

## Runtime PC01
Chạy Node.js `node server.mjs` mặc định 127.0.0.1:8893 (biến `PORT`), Health GET `/healthz` trả HTTP 200. Giao diện tại `/`. Cần kích hoạt bộ định tuyến wildcard đã duyệt rồi chạy lệnh đăng ký chuẩn `register-public-webapp.ps1 -Name ultracar -Port 8893 -HealthPath /healthz -Public` (trong phạm vi quyền/lease hợp lệ).

## Test
`node --test tests/site.test.mjs`. Trình duyệt Playwright kiểm tra desktop/mobile tại `test_site.py` (chỉ chạy khi có Chromium/Playwright).

Liên hệ đại lý: 0392 960 003 / https://zalo.me/0392960003.
- Danh mục được đối chiếu theo `window.UCBackendProducts` ngày 06/11/2026: 54 mã hãng và giá công khai (NC888 cập nhật 2.500.000đ). Mã ULTRAMOUNT không xuất hiện trong catalog hãng được bỏ; tồn kho theo hãng đang 0, vì vậy không khẳng định sẵn hàng tại HCM. Các mô tả bổ sung viết lại ngắn gọn, không sao chép nội dung dài.
