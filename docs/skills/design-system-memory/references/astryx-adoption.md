# TigerIQ — Meta Astryx: chính sách áp dụng có chọn lọc

Nguồn quyết định: Owner 17/11/2026; hồ sơ [#5721](https://github.com/newsdayads/tigeriq-ai-lab/issues/5721).
Mục tiêu: dùng bài học từ Meta Astryx trong **bộ kỹ năng thiết kế TigerIQ đang có**, không tạo hệ thống thiết kế, hàng đợi hay AI mới.

## Nguồn đã kiểm tra (17/11/2026)
- https://github.com/meta/astryx — mã nguồn chính thức của Meta; giấy phép MIT; hiện ở giai đoạn Beta.
- https://astryx.atmeta.com/blog/introducing-astryx — giới thiệu và mục tiêu thiết kế phục vụ người và AI.
- https://github.com/meta/astryx/blob/main/packages/core/README.md — thư viện dùng React **19 trở lên**; CSS đã biên dịch, có hệ thống chủ đề.
- Căn cứ nội bộ: `docs/skills/registry.yaml`, `docs/OWNER_INTERACTION_V6.md`, `apps/tigeriq-showcase/DESIGN.md` và mã giao diện từng sản phẩm.
- Đánh giá này chỉ sử dụng **ý tưởng/tiêu chí**. Không sao chép mã hoặc hình ảnh từ Meta; không cài `@astryxdesign/*` và không coi mã nguồn trôi theo nhánh `main` là phiên bản cài đặt đã khóa.

## Quyết định KEEP / ADAPT / REJECT

| Quyết định | Năng lực | Áp dụng vào TigerIQ |
|---|---|---|
| KEEP | Quy tắc thành phần giao diện có thể truy cập, trạng thái tương tác, điều hướng, biểu mẫu | Tham khảo để làm rõ `DESIGN.md` cho từng sản phẩm và kiểm tra giao diện bằng `visual-quality-gate` |
| KEEP | Chủ đề theo biến CSS, khả năng đổi màu, kích thước chữ, vùng chạm | Dùng làm nguyên tắc thiết kế; chỉ chọn giá trị dựa trên thương hiệu/ảnh đã duyệt |
| ADAPT | Cấu trúc tài liệu và hướng dẫn cho AI lập trình | Thêm chỉ dẫn vào `design-system-memory`, dùng một `docs/skills/registry.yaml` hiện hữu; không tạo skill thứ tư |
| ADAPT | Thành phần React của Astryx | **Chỉ thử nghiệm độc lập** khi có dự án React 19+ thực tế và cổng kỹ thuật/chi phí/giấy phép được xác minh |
| REJECT | Cài Astryx toàn repository, tự chuyển HTML/CSS/JS hoặc ứng dụng Android sang React | Không có lợi ích được chứng minh, tăng phụ thuộc và nguy cơ hồi quy |
| REJECT | Đổi chuẩn tương tác Owner V6, đổi bộ trạng thái, thay `DESIGN.md` đã duyệt hoặc tạo control plane thứ hai | Trái nguồn chuẩn TigerIQ |
| REJECT | Cài CLI toàn máy/PC01, tự ghi đè giao diện sản xuất, tự cập nhật gói Beta | Thiếu phiên bản khóa, kiểm soát quyền, rà soát phụ thuộc và biên nhận kiểm thử |

## Ma trận áp dụng từng bề mặt

Dữ liệu cấu trúc kèm theo nằm tại `astryx-adoption.json`; đây là **đánh giá nguồn mã**, không xác nhận website đang chạy hoặc đang dùng Astryx.

- `apps/tigeriq-showcase/index.html`: HTML/CSS/JS, giữ `DESIGN.md` đã duyệt; chỉ học tiêu chí về biểu mẫu, khoảng cách, khả năng truy cập và trạng thái.
- `apps/tigeriq-web-studio/index.html`: HTML/CSS/JS, chỉ học nguyên tắc.
- `apps/ultracar-hcm-web/index.html`: HTML/CSS/JS, giữ trải nghiệm sản phẩm hiện hữu; chỉ học nguyên tắc.
- Các bảng điều hành Web Control / Work Center: chọn riêng **bề mặt giao diện** để đánh giá; chưa xác minh công nghệ trình bày và trạng thái vận hành nên **không cài thư viện**.
- Dự án web mới được **xác minh React 19+**: ứng viên thử nghiệm độc lập, chưa được mặc định phê duyệt phát hành.
- Các ứng dụng Android, AI Core, hàng đợi, tác nhân AI, công cụ điều khiển PC01 và lõi game/3D: không phụ thuộc React; không thay đổi. Phần nút điều khiển trong ứng dụng web 3D nếu có chỉ được học nguyên tắc, không thay công cụ dựng hình.

## Cổng thử nghiệm React 19+ (chưa đạt khi mới có tài liệu)

1. Chứng minh thật có sản phẩm React 19+ phù hợp, mã nguồn/khách hàng/ảnh tham chiếu và phạm vi tác động đã duyệt.
2. Khóa bản Astryx chính xác (phiên bản, hash, giấy phép, phụ thuộc bắc cầu), kiểm tra toàn bộ tập lệnh cài đặt trước khi thực thi; áp dụng `external-skill-security-gate`.
3. Dựng giao diện so sánh trong nhánh cô lập, **không thay đổi production**, không cài CLI toàn máy; giữ nguyên chức năng và dữ liệu.
4. Kiểm thử có biên nhận: truy cập bàn phím, nhãn hỗ trợ, tương phản, chế độ tối, tiếng Việt, màn hình iPhone/desktop, tải trang, dung lượng gói và hồi quy trạng thái tương tác.
5. Rà soát độc lập khi yêu cầu; chỉ sau kiểm thử và cổng quyền hiện hành mới hợp nhất, triển khai PC01 rồi kiểm chứng trên bề mặt thật.
6. Trượt một cổng thì trở về `PATTERNS_ONLY`; không thay thế công nghệ đang chạy vì nhận định thẩm mỹ đơn thuần.

## Bảo vệ nguồn và nghiệm thu

- Chuẩn Owner V6 và `DESIGN.md` từng sản phẩm luôn ưu tiên trước tài liệu tham khảo Astryx.
- Ba skill hiện có là `design-system-memory`, `image-to-ui-implementation`, `visual-quality-gate`; chỉ nạp kỹ năng liên quan.
- Phát hiện mang tính chủ quan chỉ là khuyến nghị; chỉ số kỹ thuật cần bằng chứng. Không tự cập nhật ảnh chuẩn khi kiểm thử lỗi.
- Không gắn trạng thái hoàn tất cho việc tích hợp React, kiểm thử PC01, phát hành website hay triển khai toàn dự án khi chưa có biên nhận.
- `DRIVE_SYNC=NOT_REQUIRED`: không thay đổi Loader, điểm trỏ hay nguồn khởi động.
