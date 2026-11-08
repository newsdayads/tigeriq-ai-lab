# UltraCar HCM — website đại lý tại TP.HCM

Tên miền đích: https://ultracar.tigeriq.io.vn/ · Hạ tầng: **PC01 + Cloudflare Tunnel**, không Vercel.

## Nguồn
- Trang hãng: https://ultracar.vn/ (kiểm kê công khai ngày 2026-11-06).
- 54 mã đã đối chiếu trực tiếp với danh mục công khai ngày 07/11/2026, không thiếu mã hoặc sai giá trong đối chiếu; NC888 đã cập nhật theo mô tả hãng Snapdragon 888, RAM 12GB / 256GB. Giá/tồn kho đại lý cần xác nhận trước giao dịch.
- Logo chủ sở hữu cung cấp trực tiếp: `assets/ultracarhcm-logo-original.png` (PNG 1024×341 RGBA), SHA-256 `93411ebb0ed5197254819f908413fc54b213926435d3e3cea2f55002860baaf5`. Header/footer dùng nguyên ảnh này, không đặt tên thương hiệu lặp bên phải. Favicon SVG giữ nguyên vì phù hợp kích thước tab trình duyệt.
- Ảnh công khai của hãng được nhúng theo URL gốc trong media.js; 4 ảnh gallery và ảnh theo SKU lấy từ window.UCProductImages trên https://ultracar.vn/san-pham/. Không sao chép hàng loạt tệp ảnh hoặc nhận là ảnh tự chụp; mã thiếu ảnh có thông báo minh bạch. Cần xác minh quyền dùng lại lâu dài với UltraCar.

## Runtime PC01
Chạy Node.js `node server.mjs` mặc định 127.0.0.1:8893 (biến `PORT`), Health GET `/healthz` trả HTTP 200. Giao diện tại `/`. Cần kích hoạt bộ định tuyến wildcard đã duyệt rồi chạy lệnh đăng ký chuẩn `register-public-webapp.ps1 -Name ultracar -Port 8893 -HealthPath /healthz -Public` (trong phạm vi quyền/lease hợp lệ).

## Test
`node --test tests/site.test.mjs`. Trình duyệt Playwright kiểm tra desktop/mobile tại `test_site.py` (chỉ chạy khi có Chromium/Playwright).

Liên hệ đại lý: 0392 960 003 / https://zalo.me/0392960003.
- Danh mục được đối chiếu theo `window.UCBackendProducts` ngày 06/11/2026: 54 mã hãng và giá công khai (NC888 2.500.000đ, xác nhận cấu hình Snapdragon 888 ngày 07/11/2026). Mã ULTRAMOUNT không xuất hiện trong catalog hãng được bỏ; tồn kho theo hãng đang 0, vì vậy không khẳng định sẵn hàng tại HCM. Các mô tả bổ sung viết lại ngắn gọn, không sao chép nội dung dài.

## Tự phục vụ toàn bộ liên kết nội dung tại UltraCarHCM (2026-11-06)
- 172/172 URL tiếng Việt được xác minh HTTP 200 và thu thập metadata (title, description, headings, ảnh OG); bản dữ liệu canonical `source-details.json` do GitHub quản lý.
- 128 ảnh đại diện, gallery và sản phẩm được lưu trực tiếp tại PC01 `assets/manufacturer`; `assets/manufacturer/manifest.json` ghi đường dẫn và SHA256 để kiểm tra. File binary được tái tạo theo `tools/source-snapshot.mjs` trên PC01, không hotlink website hãng.
- Mọi thẻ trong thư viện mở `/chi-tiet.html?page=...` và sản phẩm dùng `?sku=...`, không điều hướng ra UltraCar.vn. Trang chi tiết là nội dung tóm lược biên tập riêng, **không phải bản chép toàn bộ nội dung bản quyền, video, 3D hoặc chính sách gốc**.
- Tất cả outbound source hyperlinks trong HTML/app đã bỏ; Zalo vẫn mở vì là kênh liên hệ chủ đại lý.

## Tiếp tục hoàn thiện nội dung 07/11/2026
- **42 bộ bài hướng dẫn độc lập** trong `guides.js`: 12 chủ đề đã có + 30 chủ đề bổ sung từ tiêu đề/đề mục công khai (lắp đặt, SIM, DeX, nguồn Pogo PIN, chính sách, ứng dụng, nhà sản xuất, bài hướng dẫn). Nội dung được viết lại; không sao chép toàn bài hãng.
- **101 trang theo dòng xe**, trong đó 100 ảnh minh họa từ bộ đã lưu tại PC01; `vehicle-gallery.js` lọc/tìm theo hãng và tên xe, `chi-tiet.js` thêm checklist riêng áp dụng cho ảnh và táp-lô thực.
- **Mô phỏng phối cảnh 2D** bằng hình có sẵn trên trang 3D; cố ý không nhận là file 3D gốc.
- Video gốc, mô hình 3D gốc, ảnh bổ sung ngoài bộ đã có, văn bản chính sách nguyên gốc và quyền tái sử dụng dài hạn **chưa được cấp phép/xác minh**; không tự sao chép hoặc bảo đảm chúng đã có. Giá và tồn kho không tự đồng bộ theo thời gian.

## Đặt hàng và thanh toán UltraCarHCM (2026-11-08)
- Giỏ hàng là **giỏ mua hàng**, không phải "giỏ tư vấn". Khách chọn mã hàng, số lượng, nhập họ tên, điện thoại, địa chỉ, dòng/đời xe, ghi chú; chọn COD có điều kiện hoặc chuyển khoản MB. Giá hiển thị là tiền hàng tạm tính, chưa có phí giao/lắp, không đảm bảo còn tồn.
- `POST /api/orders` trên PC01 nhận yêu cầu cùng nguồn, tự tính giá theo `products.json` (bỏ qua giá phía khách), chống gửi trùng qua `requestId`, giới hạn 4 yêu cầu/15 phút theo số điện thoại; kết quả `pending_confirmation` + `unpaid`. Backend chỉ xác nhận **đã lưu yêu cầu**, không xác nhận có hàng, giao hàng hay đã nhận tiền.
- Đơn lưu JSONL ngoài thư mục công khai: mặc định `D:\\TigerIQ\\Data\\UltraCarHCM\\orders.jsonl` trên PC01 (có thể chỉ định `ULTRACAR_ORDERS_DIR`). Không có API đọc đơn công khai; nhân sự được cấp quyền cần tiếp nhận/đối soát thủ công. Không lưu trên trình duyệt trừ giỏ hàng cũ; không gửi mật khẩu/OTP.
- Tài khoản nhận: MB Bank, chủ `NGUYEN TRUONG SON`, số `0967360003` theo ảnh Chủ sở hữu gửi 08/11/2026. QR tĩnh `assets/mb-vietqr-owner.svg` dựng nguyên mẫu QR đã giải mã, giữ nguyên dữ liệu EMV, không tự nhúng số tiền hoặc mã đơn. **Chưa xác thực nhận tiền từ ngân hàng**: owner/người thanh toán kiểm tra tên, số TK trong app ngân hàng trước giao dịch. Chỉ chuyển khi UltraCarHCM đã xác nhận tổng giá cuối qua kênh liên hệ.
- Sau ghi nhận khách nhận mã `UC...`, trạng thái chờ xác nhận/chưa thanh toán, nút copy đơn, nút Zalo và thông tin ngân hàng nếu chọn chuyển khoản. Website **không tự đánh dấu đã thanh toán**; cần đối chiếu ngân hàng thủ công hoặc tích hợp API ngân hàng/Webhook được phê duyệt sau này.
- Test: `node --test tests/*.test.mjs`, gồm kiểm thử HTTP POST, giá server-side, bảo mật cross-Origin, idempotency và dữ liệu riêng tư. Có thể chạy CI độc lập và staging PC01 bằng thư mục dữ liệu test `ULTRACAR_ORDERS_DIR` khác Production.


## Immersive 3D showroom — V5 (08/11/2026)
- Home section #mo-phong-3d after hero, direct hero CTA. Original screen shell built using CSS-3D/HTML/SVG, no OEM CAD or MP4 copied: six 3D faces, drag/touch 360-degree orbit, face front/back, autoplay when in viewport, slider and keyboard. Functional UI modes: map/music, five-app multitasking, reverse-camera illustration. Touch slide-screen reveal and four-step 12V/Pogo PIN illustration.
- Source comparison only: https://ultracar.vn/, https://ultracar.vn/nguon-nam-cham/, https://ultracar.vn/video/ as of 2026-11-08. Manufacturer proprietary CAD/GLB and MP4 redistribution not authorized; do not download/embed those assets or claim exact fidelity.
- Critical namespace isolation: ucx3d- is distinct from existing uc3d- in official-media.js. Previous selector conflict caused unintended 2px stage height; corrected and verified. No other commerce state changes.
- Accessibility/performance: pointer/touch only active on device, keyboard arrows, focus outline, correct button states, IntersectionObserver viewport idle-pausing, document visibility, prefers-reduced-motion.
- Checks: node --check immersive-3d.js, node --test tests/*.test.mjs and PC01 Chrome CDP mobile/tablet/desktop with real touch drag + reduced-motion tests.
