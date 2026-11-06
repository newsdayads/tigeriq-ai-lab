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

## Tự phục vụ toàn bộ liên kết nội dung tại UltraCarHCM (2026-11-06)
- 172/172 URL tiếng Việt được xác minh HTTP 200 và thu thập metadata (title, description, headings, ảnh OG); bản dữ liệu canonical `source-details.json` do GitHub quản lý.
- 128 ảnh đại diện, gallery và sản phẩm được lưu trực tiếp tại PC01 `assets/manufacturer`; `assets/manufacturer/manifest.json` ghi đường dẫn và SHA256 để kiểm tra. File binary được tái tạo theo `tools/source-snapshot.mjs` trên PC01, không hotlink website hãng.
- Mọi thẻ trong thư viện mở `/chi-tiet.html?page=...` và sản phẩm dùng `?sku=...`, không điều hướng ra UltraCar.vn. Trang chi tiết là nội dung tóm lược biên tập riêng, **không phải bản chép toàn bộ nội dung bản quyền, video, 3D hoặc chính sách gốc**.
- Tất cả outbound source hyperlinks trong HTML/app đã bỏ; Zalo vẫn mở vì là kênh liên hệ chủ đại lý.

## BLUEPRINT DESIGN V3 — UltraCarHCM, ngày 06/11/2026
- Thương hiệu: giữ PNG logo gốc 1024x341 do Owner cung cấp; bảng màu midnight #070d19, electric cobalt #065dff, titanium silver #dbe5f1. Không thêm tiêu đề chữ bên phải logo.
- Liên hệ duy nhất: 0392 960 003 / tel:+84392960003 / https://zalo.me/0392960003. Loại số điện thoại và địa chỉ đại lý khác khỏi nội dung public. Không tự công bố địa chỉ lắp đặt chưa xác minh.
- Hiệu ứng: showroom góc nhìn sản phẩm từ ảnh, kéo/slider/chọn góc, tự xoay, hero tilt, scroll progress và reveal; hỗ trợ prefers-reduced-motion, focus và mobile. Đây là phối cảnh tương tác minh họa, không phải 3D CAD chính thức của hãng.
- Video: 8 clip mp4 công khai được tải về PC01 vào assets/motion và xác minh theo SHA-256 manifest. Trang có trình phát tại chỗ, server hỗ trợ video/mp4 và HTTP Range 206. Thêm 22 Shorts hướng dẫn nhúng theo cơ chế YouTube Privacy Enhanced, vẫn ở trong UltraCarHCM.
- Nội dung: 172 chủ đề từ nguồn metadata, 54 mã sản phẩm, 128 ảnh nội bộ, 22 hướng dẫn biên tập độc lập trong dealer-guides.json. Nội dung không phải bản sao 1:1 của bài viết có bản quyền, CAD, mã nguồn 3D hoặc tài liệu pháp lý hãng. Quyền thương mại đối với media cần được xác nhận.
- CI -> main -> PC01 localhost -> Cloudflare Tunnel, kiểm tra HTTPS và rollback. Không dùng Vercel.

- Thư viện thực tế theo xe: 276 ảnh, 552 file thumbnail/full (60.6MB), 15 hãng xe, lưu PC01 assets/gallery, bản kê gallery.json chứa cảnh báo review, nhãn dòng xe và SHA256. Bộ lọc hãng/từ khóa/ảnh cần xác minh, dialog phóng to nội bộ; không dẫn sang ultracar.vn.
