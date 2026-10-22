# TIGERIQ GAME — NGHIỆM THU, DỮ LIỆU VÀ KIỂM THỬ V1
PROJECT_ID=TIGERIQ_GAME_ROBOT_OOPS|RELATED=#5179|STATUS=PROPOSED_NOT_EXECUTED

## A. Bộ kiểm thử tối thiểu
1. `npm ci` hoặc cách dựng phụ thuộc tương đương không cần bí mật; `lint`, `typecheck`, `test`, `build` phải có kết quả thật và môi trường kèm ngày/giờ.
2. Test bộ mô phỏng: xác định hướng trái/phải, va chạm, biên bản đồ, đi vào đích, nhặt/giao, nhấn nút, lệnh lỗi, hết bước, chơi lại, cùng seed cùng kết quả.
3. Solver trên mọi màn: thử lần lượt từng vị trí và lệnh thay hợp lệ, thu lời giải/không nghiệm, chặn dữ liệu lỗi; riêng 5 màn phải có nghiệm.
4. Test trình duyệt điện thoại thật, xoay màn, thay kích thước, chạm trúng nút, lưu/khôi phục, không mất màn, âm thanh có thể tắt.
5. Kiểm tra tốc độ tải/khả năng chơi trên thiết bị được nêu cụ thể; không giả số FPS hoặc giây tải khi chưa đo.

## B. Bộ đánh giá người chơi
- Mẫu dự kiến 30–50 người tham gia tự nguyện, nhóm chưa biết luật; dữ liệu giả định không được dùng làm minh chứng đạt.
- Biểu mẫu mỗi phiên: ngày, thiết bị/phần mềm, mã phiên vô danh, hiểu luật <=30s, hoàn tất màn 1/3/5, số lần thử, lý do bỏ, muốn chơi tiếp hay không, đánh giá mở.
- Giả thuyết sàng lọc: >=80% hiểu luật nhanh, >=70% qua 3 màn, >=30% muốn chơi tiếp; không tuyên bố có ý nghĩa thống kê với mẫu nhỏ.
- Nếu không đủ mẫu, ghi CHƯA ĐỦ BẰNG CHỨNG và chỉ tính tỷ lệ trên mẫu có thật. Không xây nhánh trả phí từ giả định.

## C. Bảo mật, pháp lý và kinh tế
- Không thu tên, số điện thoại, GPS, email hoặc mã thiết bị nếu không cần; xác minh trước nếu chọn dịch vụ phân tích bên ngoài.
- Giấy phép nguồn, đồ họa, âm nhạc được lưu vào danh mục có nguồn.
- Thẩm định điều kiện trò chơi/phát hành ở Việt Nam và chính sách thanh toán nền tảng trước khi mở kinh doanh.
- Các hành động trả phí, bí mật, pháp lý, phân quyền hoặc phát hành không được mở khóa bởi việc issue đã tạo.

## D. Biên nhận phải được giữ
- Gxx issue + trạng thái (mới/đang nhận có token/quá trình kiểm thử/đã nghiệm thu), thời gian, người ghi và lease nếu cần.
- SHA/PR và exact-head CI.
- Kết quả kiểm thử có log và thiết bị cụ thể; đường dẫn xem demo đã phát hành đúng quyền (nếu có).
- Phản hồi người thử có đồng ý và thống kê ẩn danh; phân tích thừa nhận sai số.
- Báo cáo GO/PIVOT/STOP, quyết định có phê duyệt khi qua gate.
