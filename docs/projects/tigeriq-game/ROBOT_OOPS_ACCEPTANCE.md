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


## E. S10 5G — kiểm thử thiết bị thực bắt buộc
**Vị trí trong DAG:** G06 S03 smoke thật trước khi đóng G06; G08 kiểm thử hồi quy riêng sau G07; G12 thử APK nếu và chỉ nếu qua GO của G10. Không tạo Issue thứ 15.
**Preflight:** PC01 truy cập được S10 5G bằng ADB; chụp `adb devices -l`, `adb shell getprop ro.product.model`, `adb shell dumpsys battery`; chỉ chạy trên serial đã xác nhận `device`. Nếu `offline`/`unauthorized`, dừng thao tác, lưu bằng chứng và không reset quyền/USB debug không được cấp.
**Set pin 100% (chỉ giá trị ADB mô phỏng):** `adb -s SERIAL shell dumpsys battery set level 100`; đọc `dumpsys battery` xác nhận level=100 trước khi mở game. Không đại diện tình trạng sạc vật lý. Không cần root để giả định; nếu máy từ chối thì ghi rõ chưa đạt thay vì khai 100%.
**Kênh truy cập game:** phát triển Web nội bộ có quyền; có thể `adb -s SERIAL reverse tcp:4173 tcp:4173` + URL Android `http://127.0.0.1:4173/`, chỉ sau khi có server local đang chạy và được cấp quyền. Nếu đường này không hỗ trợ, chọn đường nội bộ hợp lệ có bằng chứng; **không thay Production release gate**.
**Smoke G06:** mở trình duyệt thật, thao tác touch L01–L05 (1 edit → RUN → kết quả), sai → thử lại, chuyển màn và màn nhỏ, không đụng PII. Thu hình/video/log kỹ thuật không có thông tin cá nhân nếu có thể, đọc lại file và hash/URL bằng chứng.
**Regression G08:** kiểm 5/5 lời giải, restore tiến trình, touch target, đổi hướng màn/viewport, âm thanh mute, không crash, thời gian tải và độ mượt đo thực khi công cụ có; kiểm tra các lỗi phát hiện được sau fix, QA độc lập.
**Cleanup luôn thực hiện:** `adb -s SERIAL shell dumpsys battery reset` và readback mức pin thực được trả về; `adb -s SERIAL reverse --remove tcp:4173` nếu đã set; đóng dev server nếu do chính bước thử mở và có quyền đóng. Cleanup thất bại là blocker riêng `ADB_BATTERY_SIMULATION_RESET_UNVERIFIED`, phải báo không im lặng.
**Evidence G06/G08:** `device_model`, serial được che/mã hóa, `adb_authorized`, `battery_before`, `battery_emulated_100_verified`, `battery_reset_verified`, URL build/local SHA, Chrome version, thời gian, thao tác level + kết quả, ảnh/video/log và lỗi, người/lease thực thi, PR/commit hoặc số issue. Không ghi DONE nếu chỉ có unit test/CI hoặc ảnh mock.


## F. Quyền và preflight thiết bị RDC/ADB — owner granted 23/10/2026
- `AUTHORIZED_ROUTE=MCP_RDC_PC01_ADB_S10_ONLY` cho G06 và G08; endpoint RDC có `start_process` (không phải chứng cứ Core có typed ADB action). Không được xóa `NO_PC01_SHELL=true` để cấp shell không giới hạn. Chỉ lệnh ADB đã liệt kê trong kế hoạch.
- Biên nhận đọc thực tế PC01: ADB binary `D:\TigerIQ\Tools\platform-tools\adb.exe` tồn tại; device list có 1 thiết bị state `device` model `SM_G977N`; `getprop ro.product.model=SM-G977N`; `dumpsys battery` có `level:100` và `UPDATES STOPPED`. Đã READ ONLY, **chưa chạy app, chưa chạm UI hoặc thay đổi battery** trong kiểm tra cấp quyền.
- G06 S03 tiếp theo: kiểm tra một writer/lease; tạo/xác minh game server nội bộ; chạy bằng ADB trên đúng serial S10, bấm đủ L01–L05, thu chứng cứ. Mọi mutation phải được cấp quyền qua bề mặt đang hoạt động. Quy tắc chứng cứ/cleanup ở mục E tiếp tục có hiệu lực, nhưng khi `UPDATES STOPPED` đã tồn tại **trước phiên**, không reset override vô căn cứ của actor khác.
- G08 sau G07: QA độc lập trên cùng máy; không tính việc test G06 là nghiệm thu G08.
- Dữ liệu cần ghi: owner trực tiếp 23/10/2026, đường dẫn binary, mã thiết bị (serial mask), PC01 connector quota/trạng thái tại lần gọi, `batteryBefore`, `batteryStateOwner`, `battery100AtStart`, `batteryAfter`, `runtimeSha`, `levelsPlayed`, `screenshotsOrVideo`, `cleanupReceipt`, `leaseOwner`, `result`.
