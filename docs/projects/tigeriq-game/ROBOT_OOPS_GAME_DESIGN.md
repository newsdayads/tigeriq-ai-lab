# TIGERIQ GAME — ROBOT OOPS! / THIẾT KẾ GAME V1 (BẢN THỬ)
PROJECT_ID=TIGERIQ_GAME_ROBOT_OOPS|RELATED=#5179|ISSUE=G02(#5181)
STATUS=DESIGN_DRAFT; level data cần được solver kiểm chứng tại G05/G06.

## 1. Hứa hẹn với người chơi
«Robot sắp làm hỏng việc. Bạn chỉ được sửa đúng một lệnh để cứu tình huống».
Chạm để chọn lệnh sai → chọn lệnh thay → nhấn CHẠY → xem hoạt cảnh thất bại hoặc chiến thắng. Thua có thể sửa lại ngay; không phạt thời gian hay bắt xem quảng cáo ở bản thử.

## 2. Cơ chế thử nghiệm tối thiểu
- Màn 2D dạng ô lưới; trục x sang phải, trục y xuống dưới; 4 hướng Bắc/Đông/Nam/Tây.
- Trạng thái `RobotState`: tọa độ, hướng, đang cầm đồ hay không, các cờ công tắc/mục tiêu; trạng thái thiết bị tĩnh/vật cản.
- Tập lệnh v0: `MOVE` (đi 1 ô), `TURN_LEFT`, `TURN_RIGHT`, `PICK`, `DROP`, `PRESS`, `WAIT`.
- Mỗi màn có `originalCommands`, `allowedCommandsBySlot`, `maxSteps`, `goalPredicate`, `obstacles` và hình hoạt cảnh.
- Người chơi thay **duy nhất 1 ô lệnh** thành lệnh khác thuộc tập hợp cho phép; không thêm/xóa/sắp thứ tự nhiều lệnh.
- Mô phỏng tuần tự tất định, giới hạn bước; dừng khi thắng, đụng vật cản, hành động sai hoặc chạy hết lệnh; xem lỗi rõ.
- Nút: chọn lệnh, nút thay, CHẠY, CHƠI LẠI, BẬT/TẮT ÂM, về chọn màn. Bản đầu không có quảng cáo/đăng nhập/cửa hàng.
- Trạng thái thắng chỉ tính sau khi CHẠY xong và `goalPredicate` đúng; bộ kiểm tra tự duyệt các phép thay hợp lệ có giới hạn để loại màn vô nghiệm.
- Chính sách nhiều lời giải: bản đầu chấp nhận **ít nhất 1 lời giải**, nhưng phải ghi danh sách nghiệm do solver sinh; tính duy nhất là ưu tiên cân độ khó, không tuyên bố đạt trước khi test.

## 3. Bộ 5 tình huống thử (dữ liệu minh họa phải chuyển thành JSON và kiểm định)
1. **Lạc hướng:** Robot cần đến ô (2,1), xuất phát (0,1) nhìn Đông; lệnh cũ `MOVE, TURN_LEFT`. Dự kiến sửa lệnh 2 thành `MOVE`.
2. **Rẽ sai:** Xuất phát (0,2) nhìn Đông, đích (1,1); lệnh cũ `MOVE,TURN_RIGHT,MOVE`. Dự kiến sửa lệnh 2 thành `TURN_LEFT`.
3. **Bấm nhầm:** Xuất phát (1,1) nhìn Đông, nút ở (1,2); lệnh cũ `TURN_LEFT,MOVE,PRESS`. Dự kiến sửa lệnh 1 thành `TURN_RIGHT`.
4. **Giao gói hàng:** Xuất phát (0,1) nhìn Đông; kiện hàng (1,1), nơi giao (2,1); lệnh cũ `MOVE,PICK,TURN_LEFT,DROP`. Dự kiến sửa lệnh 3 thành `MOVE`.
5. **Đường vòng:** Xuất phát (0,2) nhìn Đông, đích (2,1); lệnh cũ `MOVE,TURN_RIGHT,MOVE,TURN_RIGHT,MOVE`. Dự kiến sửa lệnh 2 thành `TURN_LEFT`.
Quy ước: lưới đủ 4×4 cho các tình huống; vật cản/hoạt ảnh vui thiết kế sau, không được phá tính có nghiệm. Mọi nghiệm dự kiến phải được solver G05 kiểm tra; kết quả kiểm tra hiện CHƯA CÓ.

## 4. Nhịp độ & cảm xúc
- Hướng dẫn bằng một màn đầu cực ngắn: bấm vào lệnh có dấu cảnh báo, chọn lệnh mới, CHẠY.
- Thời gian mục tiêu cho một màn sau khi hiểu: 20–90 giây; con số là giả thuyết thiết kế.
- Sai thì robot có phản hồi ngộ nghĩnh (rẽ sai, nhấn trượt, đi nhầm), không bêu xấu người chơi; không ép quảng cáo để qua.
- Đúng thì âm thanh vui 0,5–1,5 giây, lên màn kế tiếp.
- Màn sau thêm một biến mới: hướng, nút, vật phẩm, đường vòng; không tạo nhiều luật mới cùng lúc.

## 5. Nội dung học được để mở rộng
Hệ thống data-driven lưu JSON kịch bản; các tình huống mới chỉ được đưa vào bộ 10 màn nếu solver xác minh và QA không hồi quy.
Có thể sinh gợi ý bằng máy nhưng không tự xuất bản khi chưa qua validator.
Từ bản Web có thể cân nhắc Android gói WebView/TWA/Capacitor hoặc viết lại Unity **chỉ sau dữ liệu thử nghiệm**, không chọn trước theo sở thích công nghệ.

## 6. Rủi ro sao chép
Không lấy mã nguồn game khác làm mẫu trừ khi giấy phép cho phép cụ thể. Không dùng nhân vật, âm thanh, nhãn hiệu, bố cục hoặc cấp độ nguyên bản.
Ý tưởng giải đố về lệnh robot có tiền lệ; tên ROBOT OOPS! là tên làm việc chưa thẩm định nhãn hiệu.

## 7. Quy định sản phẩm và kinh doanh
MVP không chứa nội dung cờ bạc, tiền đổi tiền hoặc cơ chế thắng bằng trả phí.
Mọi đề xuất quảng cáo thưởng hoặc bán gói chỉ ở G13 và sau G10, tránh thiết kế ép xem quảng cáo để tránh việc game có giá trị thấp.
