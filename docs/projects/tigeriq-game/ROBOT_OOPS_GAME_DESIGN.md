# TIGERIQ GAME — ROBOT OOPS! / THIẾT KẾ GAME V1 (BẢN THỬ)
PROJECT_ID=TIGERIQ_GAME_ROBOT_OOPS|RELATED=#5179|ISSUE=G02(#5181)
STATUS=G02_DESIGN_SPEC_VERIFIED_OFFLINE; 5 kịch bản đã đối chiếu phép thay duy nhất tại G02; G05/G06 vẫn phải kiểm thử engine thật.

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

## 3. Bộ 5 tình huống thử (dữ liệu chuẩn và nghiệm chứng tại G02)
1. **Lạc hướng:** Robot cần đến ô (2,1), xuất phát (0,1) nhìn Đông; lệnh cũ `MOVE, TURN_LEFT`. Dự kiến sửa lệnh 2 thành `MOVE`.
2. **Rẽ sai:** Xuất phát (0,2) nhìn Đông, đích (1,1); lệnh cũ `MOVE,TURN_RIGHT,MOVE`. Dự kiến sửa lệnh 2 thành `TURN_LEFT`.
3. **Bấm nhầm:** Xuất phát (1,1) nhìn Đông, nút ở (1,2); lệnh cũ `TURN_LEFT,MOVE,PRESS`. Dự kiến sửa lệnh 1 thành `TURN_RIGHT`.
4. **Giao gói hàng:** Xuất phát (0,1) nhìn Đông; kiện hàng (1,1), nơi giao (2,1); lệnh cũ `MOVE,PICK,TURN_LEFT,DROP`. Dự kiến sửa lệnh 3 thành `MOVE`.
5. **Đường vòng:** Xuất phát (0,2) nhìn Đông, đích (2,1); lệnh cũ `MOVE,TURN_RIGHT,MOVE,TURN_RIGHT,MOVE`. Dự kiến sửa lệnh 2 thành `TURN_LEFT`.
Quy ước: lưới đủ 4×4 cho các tình huống; vật cản/hoạt ảnh vui thiết kế sau, không được phá tính có nghiệm. Năm nghiệm dự kiến đã được mô phỏng G02 độc lập để kiểm tra tính nhất quán cơ bản; G05 vẫn phải thực thi solver TypeScript và test dữ liệu chính thức.

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

## 8. Hợp đồng triển khai dữ liệu và máy kiểm chứng G02 (2026-10-23)

**Ranh giới nghiệm thu:** G02 chốt luật/dữ liệu và xác nhận được ít nhất 1 lời giải bằng bộ duyệt độc lập. **G05** mới triển khai engine/solver trong mã sản phẩm, **G06** mới tích hợp 5 màn có thể chơi; G02 không tự tuyên bố hai việc này hoàn thành.

### 8.1. Máy trạng thái chuẩn (G05 phải giữ tương đương)

- Toạ độ nguyên không âm, `0 <= x,y < 4`; không có vật cản trong bộ 5 màn đầu. Vật cản là ô cấm tuỳ chọn cho G05 mở rộng; di chuyển ra ngoài lưới/vào vật cản dừng `OUT_OF_BOUNDS`/`BLOCKED` (không tự xuyên tường).
- Hướng `N=0, E=1, S=2, W=3`; `TURN_LEFT=(heading+3)%4`, `TURN_RIGHT=(heading+1)%4`. `MOVE` tăng một ô theo hướng. `WAIT` giữ nguyên trạng thái trong một bước.
- `PICK`: chỉ hợp lệ nếu robot cùng ô với vật phẩm tồn tại và chưa cầm món khác; đặt `holding=true` và xóa vật phẩm khỏi ô. Sai điều kiện trả `INVALID_PICK`. `DROP`: chỉ hợp lệ khi đang cầm; trả `INVALID_DROP` nếu tay trống; nếu thả ở `delivery` đặt `delivered=true`.
- `PRESS`: chỉ hợp lệ khi robot cùng ô công tắc; đúng thì `pressed=true`, sai trả `INVALID_PRESS`. Mục tiêu `position` so tọa độ cuối; `switch` cần `pressed=true`; `delivery` cần `delivered=true` và tay trống.
- Tất cả lệnh chạy **tuần tự đúng thứ tự** sau khi người chơi thay một lệnh; lỗi đầu tiên là kết quả terminal; không có vòng lặp, nhảy lệnh hay random. Mục tiêu chỉ xét sau khi đã thi hành **toàn bộ chương trình** không lỗi. `maxSteps` là số lệnh tối đa và cũng chính là độ dài chương trình trong bộ mẫu; nếu vượt, trả `STEP_LIMIT`. Không đạt mục tiêu trả `GOAL_NOT_MET`.
- Cưỡng chế **đúng một lần thay**: đầu vào là `{slot, replacement}`, phải có `slot == editableSlot`, `replacement in allowedCommandsBySlot[slot]`, `replacement != originalCommands[slot]`; không cho thêm/xóa/di chuyển lệnh hoặc thay hai vị trí. Mỗi lần nhấn Chạy tạo bản sao đầu vào ban đầu để không rò state giữa các lần.

### 8.2. JSON kịch bản chuẩn (0-based slot và tọa độ)

```json
[
  {"id":"L01","name":"Lạc hướng","width":4,"height":4,"start":{"x":0,"y":1,"heading":1},"originalCommands":["MOVE","TURN_LEFT"],"editableSlot":1,"maxSteps":2,"item":null,"switch":null,"delivery":null,"obstacles":[],"goal":{"kind":"position","x":2,"y":1}},
  {"id":"L02","name":"Rẽ sai","width":4,"height":4,"start":{"x":0,"y":2,"heading":1},"originalCommands":["MOVE","TURN_RIGHT","MOVE"],"editableSlot":1,"maxSteps":3,"item":null,"switch":null,"delivery":null,"obstacles":[],"goal":{"kind":"position","x":1,"y":1}},
  {"id":"L03","name":"Bấm nhầm","width":4,"height":4,"start":{"x":1,"y":1,"heading":1},"originalCommands":["TURN_LEFT","MOVE","PRESS"],"editableSlot":0,"maxSteps":3,"item":null,"switch":{"x":1,"y":2},"delivery":null,"obstacles":[],"goal":{"kind":"switch"}},
  {"id":"L04","name":"Giao gói hàng","width":4,"height":4,"start":{"x":0,"y":1,"heading":1},"originalCommands":["MOVE","PICK","TURN_LEFT","DROP"],"editableSlot":2,"maxSteps":4,"item":{"x":1,"y":1},"switch":null,"delivery":{"x":2,"y":1},"obstacles":[],"goal":{"kind":"delivery"}},
  {"id":"L05","name":"Đường vòng","width":4,"height":4,"start":{"x":0,"y":2,"heading":1},"originalCommands":["MOVE","TURN_RIGHT","MOVE","TURN_RIGHT","MOVE"],"editableSlot":1,"maxSteps":5,"item":null,"switch":null,"delivery":null,"obstacles":[],"goal":{"kind":"position","x":2,"y":1}}
]
```

**`allowedCommandsBySlot` chuẩn:** tại `editableSlot`, được chọn một trong `MOVE, TURN_LEFT, TURN_RIGHT, PICK, DROP, PRESS, WAIT`, ngoại trừ lệnh cũ. Các slot còn lại có danh sách cho phép rỗng, không chỉnh sửa. UI có thể giấu nút thay không hợp lệ để dễ hiểu, nhưng validator phải chặn cả đầu vào do code gửi thẳng.

### 8.3. Biên nhận kiểm chứng 5 màn — enumerate mọi phép thay hợp lệ

Mỗi màn có **6** khả năng thay thế ở slot đã cho (7 lệnh trừ lệnh cũ); mô phỏng độc lập đã duyệt hết 30 ứng viên với trạng thái ban đầu reset, kết thúc hữu hạn:

| Màn | Chương trình ban đầu | Kết quả ban đầu | Chỉ số slot (0-based) | Lệnh thay thành công | Số nghiệm / 6 |
| --- | --- | --- | ---: | --- | ---: |
| L01 | `MOVE,TURN_LEFT` | `GOAL_NOT_MET` | 1 | `MOVE` | 1 |
| L02 | `MOVE,TURN_RIGHT,MOVE` | `GOAL_NOT_MET` | 1 | `TURN_LEFT` | 1 |
| L03 | `TURN_LEFT,MOVE,PRESS` | `INVALID_PRESS` | 0 | `TURN_RIGHT` | 1 |
| L04 | `MOVE,PICK,TURN_LEFT,DROP` | `GOAL_NOT_MET` | 2 | `MOVE` | 1 |
| L05 | `MOVE,TURN_RIGHT,MOVE,TURN_RIGHT,MOVE` | `GOAL_NOT_MET` | 1 | `TURN_LEFT` | 1 |

**Chính sách nghiệm:** G02 chấp nhận từ 1 nghiệm trở lên; nếu có nhiều nghiệm, cho người chơi thắng với **bất cứ** phép thay hợp lệ nào thật sự đưa tới đích. Năm bộ mẫu này mỗi màn đang có một nghiệm trong tập 6 cách sửa tại slot xác định. G05 không được hard-code đáp án theo bảng: phải duyệt tất cả phép thay và trả danh sách nghiệm. Trường hợp 0 nghiệm phải fail validation; thời gian chạy giới hạn bởi `maxSteps` + số phương án hữu hạn. G05 phải test cả kết quả, replay, không mutation bản gốc, vật cản và `STEP_LIMIT`.

### 8.4. Trạng thái và UX cho G03/G06

`CHỌN MÀN → CHỌN 1 SLOT CHO PHÉP → CHỌN LỆNH KHÁC → CHẠY → (THẮNG | THUA CÓ LÝ DO) → CHƠI LẠI / MÀN TIẾP`. Chỉ hiển thị animation/vui khi không làm sai kết quả; nút Chạy khóa khi chưa có thay đổi hợp lệ. Mục tiêu 20–90 giây mỗi màn là giả thuyết, chưa có thử người dùng. Tên ROBOT OOPS vẫn `NAME_NOT_CLEARED`.

### 8.5. Cổng nghiệm thu

- **G02:** tài liệu chốt này, phép thay duy nhất, dữ liệu 5 màn, bảng kết quả độc lập, kiểm tra PR/CI/readback main và Issue G02.
- **G05:** tạo engine `apps/tigeriq-game/src/engine/` cùng test tự động với dataset tương đương; không chuyển kết quả mô phỏng G02 thành test PASS của G05.
- **G06/G08:** tích hợp trò chơi + trình duyệt/điện thoại thật, kiểm tra va chạm, reset, UX và hiệu năng; không claim đã chạy thiết bị thật tại G02.
