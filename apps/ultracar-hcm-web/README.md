# UltraCar HCM — website đại lý tại TP.HCM

Tên miền đích: https://ultracar.tigeriq.io.vn/ · Hạ tầng: **PC01 + Cloudflare Tunnel**, không Vercel.

## Nguồn
- Trang hãng: https://ultracar.vn/ (kiểm kê công khai ngày 2026-11-06).
- 36 mã, thông số/giá biên tập dựa trên dữ kiện công khai; chênh lệch giá và NC888 được đánh dấu chờ xác minh.
- Logo là tham chiếu cắt từ banner người dùng đã cung cấp, chưa phải master. Không đồng bộ ảnh/3D/video/văn bản nguyên bản khi chưa có tư liệu nguồn được quyền sử dụng.

## Runtime PC01
Chạy Node.js `node server.mjs` mặc định 127.0.0.1:8893 (biến `PORT`), Health GET `/healthz` trả HTTP 200. Giao diện tại `/`. Cần kích hoạt bộ định tuyến wildcard đã duyệt rồi chạy lệnh đăng ký chuẩn `register-public-webapp.ps1 -Name ultracar -Port 8893 -HealthPath /healthz -Public` (trong phạm vi quyền/lease hợp lệ).

## Test
`node --test tests/site.test.mjs`. Trình duyệt Playwright kiểm tra desktop/mobile tại `test_site.py` (chỉ chạy khi có Chromium/Playwright).

Liên hệ đại lý: 0392 960 003 / https://zalo.me/0392960003.