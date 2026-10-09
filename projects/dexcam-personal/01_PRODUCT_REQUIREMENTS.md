# 01 — Đặc tả yêu cầu sản phẩm (PRD)

## 1. Mục tiêu & nguyên tắc
- **Người sử dụng chính:** chủ xe; ứng dụng cài trực tiếp trên Android dùng chế độ Samsung DeX.
- **Giá trị cốt lõi:** bố cục cửa sổ ổn định + camera lùi ưu tiên tức thời và đáng tin cậy.
- **Không ràng buộc thời gian sử dụng do nhà cung cấp thứ ba:** mã nguồn và dữ liệu thuộc dự án cá nhân; không cần cấp phép định kỳ.
- **Offline-first:** tất cả chức năng lõi hoạt động khi không có Internet; cập nhật chỉ theo lệnh.
- **Fail-visible:** camera lỗi phải hiện cảnh báo/mất tín hiệu, **không giả hình trực tiếp bằng frame cũ**.
- **An toàn vận hành:** không yêu cầu tài xế cấu hình hoặc chạm màn hình khi xe đang di chuyển.

## 2. Hành trình sử dụng mục tiêu
### UC-01 — Khởi động hệ thống
**Cho trước:** thiết bị có DeX và ứng dụng cá nhân đã được cấp quyền cần thiết.
**Khi:** kết nối hub/màn hình hoặc kích hoạt hồ sơ.
**Thì:** khôi phục bố cục ứng dụng đã chọn theo màn hình hiện hành; nếu chưa đủ quyền, thông báo và hướng dẫn khắc phục; không tự nâng quyền.
**Ngoại lệ:** màn hình/dpi thay đổi phải đánh giá lại tọa độ, tránh cửa sổ nằm ngoài vùng nhìn thấy.

### UC-02 — Đang hoạt động, chuyển số R
**Cho trước:** ứng dụng bản đồ/gọi xe vẫn hiển thị.
**Khi:** bộ camera có kích hoạt R hoặc tín hiệu camera USB phù hợp được nhận.
**Thì:** tự đưa cửa sổ camera lên vùng ưu tiên **mà không phá hủy bố cục app**; hiển thị tín hiệu sống hoặc thông báo rõ nếu chưa có frame.
**Đo:** thời gian từ tín hiệu attach/frame đầu tới thời gian cửa sổ camera xuất hiện; thời gian từ R vật lý nếu có mốc đo.
**Ngoại lệ:** event USB trùng, luồng camera xuất hiện rồi mất nhanh, quyền USB không cấp.

### UC-03 — Rời số R
**Khi:** trạng thái R không còn hoặc camera mất tín hiệu đã qua xác nhận chống rung.
**Thì:** ẩn/đóng cửa sổ camera theo cài đặt, chuyển về chính xác bố cục trước đó; không tự đóng/kết thúc các app bản đồ.
**Lưu ý:** không suy diễn 'USB detach = rời R' nếu thiết bị hỗ trợ cách truyền tín hiệu khác.

### UC-04 — Camera không tự xuất hiện
**Khi:** USB phát hiện nhưng không có frame/không thấy cửa sổ.
**Thì:** trình điều khiển thử hồi phục trong giới hạn thời gian an toàn, ghi nguyên nhân và cho phép mở thủ công; trạng thái báo rõ cho người dùng.
**Định nghĩa lỗi:** tách 4 lớp: phát hiện thiết bị, quyền USB, luồng video, cửa sổ nổi.

### UC-05 — Điều chỉnh từng ứng dụng
**Khi:** người dùng định nghĩa vị trí/kích thước hoặc chọn mẫu bố cục.
**Thì:** ứng dụng xác thực cấu hình và áp dụng được trong giới hạn quyền Android; nếu không thể, hiển thị sai lệch thực tế và đề nghị bố cục thay thế.
**Chế độ:** tọa độ tuyệt đối (px), tỉ lệ theo vùng hiển thị (%), preset, khoảng cách, lưu nhiều hồ sơ.

### UC-06 — Đổi thiết bị/hub, khởi động lại
**Thì:** ghi nhận việc USB mất/kết nối lại, không lỗi treo lâu, đọc lại quyền khi cần; không lộ dữ liệu ngoài máy.

## 3. Bảng yêu cầu chức năng (FR)
| ID | Ưu tiên | Yêu cầu | Chỉ tiêu nghiệm thu ban đầu |
|---|---|---|---|
| FR-001 | P0 | Khám phá USB/UVC theo interface, VID/PID, danh sách mode hỗ trợ | Có thông tin xác minh từ USB descriptor, không giả tên chipset |
| FR-002 | P0 | Quản lý quyền USB khi kết nối lại | Trạng thái/grant/deny được ghi và UI hướng dẫn |
| FR-003 | P0 | Camera tự kích hoạt theo tín hiệu thực tế | Có kiểm thử lặp R/D trên xe |
| FR-004 | P0 | Cửa sổ camera nổi ưu tiên trên bố cục khác | Không cần bấm icon trong điều kiện đã nghiệm thu |
| FR-005 | P0 | Tự trả bố cục sau khi ngừng R | Bố cục trước đó không bị phá |
| FR-006 | P0 | Khung hình hiện hành và trạng thái mất tín hiệu | Không giữ hình cũ như hình trực tiếp |
| FR-007 | P0 | Tự phục hồi có giới hạn khi lỗi USB/preview | Mỗi lỗi có dấu vết, không lặp vô hạn |
| FR-008 | P0 | Preset cửa sổ và gán app | Lưu, áp dụng, báo khác biệt so với tọa độ yêu cầu |
| FR-009 | P0 | Thiết lập X/Y/W/H và vùng màn hình | Tôn trọng kích thước tối thiểu, taskbar, dpi |
| FR-010 | P0 | Lưu toàn bộ cài đặt cục bộ | Khôi phục sau khởi động lại |
| FR-011 | P0 | Nhật ký camera theo lần kích hoạt R | Có tương quan event và mốc thời gian |
| FR-012 | P0 | Chế độ kích hoạt thủ công dự phòng | Vẫn mở camera khi event tự động trượt, nếu USB sẵn sàng |
| FR-013 | P1 | Chỉnh hiển thị lật, xoay, zoom, crop, fit | Không làm chậm hành trình R ngoài ngưỡng đo |
| FR-014 | P1 | Điều chỉnh độ sáng/tương phản/màu tùy khả năng phần cứng | Chỉ hiển thị controls khi thiết bị báo hỗ trợ; có cách xử lý phần mềm |
| FR-015 | P1 | Vạch canh xe do chủ xe hiệu chỉnh | Chỉ là hỗ trợ hiển thị, không thay thế quan sát thực tế |
| FR-016 | P1 | Sao lưu/khôi phục cấu hình ngoại tuyến | Không bao gồm dữ liệu nhạy cảm nếu chưa được duyệt |
| FR-017 | P1 | Hỗ trợ nhiều màn hình/độ phân giải | Preset theo định danh màn hình |
| FR-018 | P2 | Các tiện ích cá nhân phát triển sau | Mỗi tiện ích có đặc tả và nghiệm thu riêng |

## 4. Yêu cầu phi chức năng (NFR)
| ID | Nhóm | Tiêu chuẩn |
|---|---|---|
| NFR-001 | Tin cậy | Mục tiêu thử tối thiểu **50/50 lượt R thành công** trên cấu hình chuẩn; chưa được coi là kết quả hiện tại |
| NFR-002 | Độ trễ | Đo phân bố P50/P95/P99 từ R→hình sống; **chưa chốt số ms** khi chưa có đo USB/hardware |
| NFR-003 | An toàn | Camera mất hình phải cảnh báo rõ; không gọi hình đứng là hình sống |
| NFR-004 | Ngoại tuyến | Không cần tài khoản, API, Firebase, kết nối Internet cho chức năng lõi |
| NFR-005 | Riêng tư | Nhật ký và cài đặt nằm ở thiết bị, xuất chỉ do người dùng quyết định |
| NFR-006 | Bảo trì | Module độc lập, dữ liệu versioned, kiểm thử tái lập được |
| NFR-007 | Tương thích | Chỉ cam kết các mẫu điện thoại/One UI/DeX đã kiểm thử |
| NFR-008 | Ổn định | Không khóa ứng dụng khác, không vòng lặp CPU/USB vô hạn |
| NFR-009 | Khả dụng | Cài đặt khi dừng xe, nút camera thủ công rõ ràng |
| NFR-010 | Khả năng mở rộng | Không tạo dependency buộc kết nối máy chủ chỉ để thêm tính năng |

## 5. Không thuộc phạm vi phiên hiện tại
- Không viết, build, cài đặt, phát hành, ký APK; không chạy thử bằng ADB trên xe.
- Không phá cơ chế cấp phép hoặc chỉnh sửa bản APK gốc.
- Không dùng Firebase hay service quản trị/trả phí.
- Không cam kết nhận CAN/OBD, đọc cần số qua dây đỏ từ phần mềm (đường kích hoạt thuộc phần cứng).
- Không bảo đảm điều khiển được **mọi** ứng dụng Android khi hạn chế quyền/One UI không cho phép.
- Không quyết định kho mã độc lập, công nghệ cuối hay lịch phát hành khi chưa được duyệt.

## 6. Các câu hỏi còn mở
- USB có kết nối hệ thống liên tục và chỉ có khung hình khi vào R, hay descriptor USB cũng attach/detach theo R?
- R là 12V trigger, công tắc hay đầu ra bộ điều khiển, và dây đen có là mass chung hay dây khác?
- Camera/bộ chuyển hỗ trợ UVC interface, MJPEG/YUY2, PAL/NTSC, VID/PID nào?
- Đang chạy Galaxy model, One UI, Android, DeX đời nào? Có quyền Shizuku/ADB thực không?
- Màn hình ngoài có DPI/resolution/layout cụ thể nào?
- Anh Sơn muốn các tiện ích nào ở giai đoạn bổ sung tiếp theo? Chưa tự điền yêu cầu.

## 7. Bảng truy nguồn
- [O] Yêu cầu/triệu chứng của Owner trong cuộc trao đổi ngày 2026-10-09.
- [A] Thành phần APK tĩnh: DEX + thư viện UVC/USB; *chưa phải hành vi thời gian thực*.
- [V] Hai video thao tác và ảnh linh kiện do Owner cung cấp trong chat; *chưa lưu lên GitHub công khai*.
- [D] Những mục chưa được đo/kiểm thử là thiết kế đề xuất, không ghi đã xác nhận.
