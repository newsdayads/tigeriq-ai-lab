# UltraCar HCM V1 — v1.0.44 (285) TEST — nguồn lõi, chưa phải APK

**Nguồn yêu cầu:** [UltraCar V1 — Issue 5129](https://github.com/newsdayads/tigeriq-ai-lab/issues/5129). Bản nền đã xác minh: v1.0.43 (284) TEST, Camera tạm chốt OK. Production v1.0.17 (258) BẤT BIẾN. Đây là nhánh thử nghiệm, không hợp nhất trước khi có kiểm thử đầy đủ.

## Mã đã có
- `ExactCardIndex`: gắn `sessionId` với bounds màn hình thật của từng thẻ và tay nắm, từ chối điểm thả không khớp chính xác một thẻ.
- `DragSession`: khởi phát từ grip, giữ nguyên source ID và revision từ ACTION_DOWN đến ACTION_UP; bỏ thay đổi nếu phiên bố cục không đồng nhất.
- `SessionOrder`: thao tác reorder bằng ID duy nhất, không dùng tên hoặc khoảng cách; encode/decode Unicode bền vững.
- `QuickSlots`: 5 ô độc lập lưu đúng session ID, giữ gán qua thay đổi thứ tự; ID đã xóa không chuyển nhầm sang session khác.
- `V44LogicTest`: 49 phép thử mô hình (không phải kiểm thử giao diện).

Lệnh kiểm tra trong môi trường Java có JDK:
```sh
javac --release 8 -encoding UTF-8 -d out src/com/tigeriq/v44/*.java test/com/tigeriq/v44/*.java
java -cp out com.tigeriq.v44.V44LogicTest
```

## Các bước chưa làm (bắt buộc trước khi gọi là hoàn thành)
1. Tích hợp native Android/Compose vào đúng lưới 3 cột trong lớp `zc4.smali`; ghi bounds grip + card từ tọa độ màn hình thực của mỗi session, gắn sự kiện touch/mouse và hình thẻ đang kéo. Không dùng accessibility title hoặc lựa chọn thẻ gần nhất. Kiểm tra `Manager.shift(String,int)` và `saveOrder()` có lưu đúng thứ tự.
2. Tích hợp 5 nút Compose cùng một hàng ở màn chính, giữa KHỞI ĐỘNG và các nút dưới, mỗi nút đều nhau, icon + tên thật, chạm mở ID qua `MainActivity.onNewIntent`/extra `launch_session_id`, nhấn giữ chọn lại. Lưu các ID bằng SharedPreferences, kiểm tra đóng/mở ứng dụng.
3. Trên PC01, tạo stage mới **chỉ khi được nền tảng cho phép**. Bảo vệ hash lớp Camera/USB/Manifest, 3 cột, các nút khác và dữ liệu cũ. Không dùng bản v43/v17 làm đích ghi đè.
4. Dùng javac/D8 + Apktool -> zipalign -> apksigner v2/v3. versionCode=285, profile đúng v1.0.44. So chứng chỉ SHA256 `71617043eace89e5f220ea9168b0a9592808111b0f17eaa219f5e6eceb569558`.
5. Upload đúng thư mục Google Drive `TigerIQ UltraCar`, kiểm lại size/SHA và file ID. Kiểm thử thật Samsung Z Fold 2 SM-F916N ở chế độ DeX khi xe đỗ. Không tuyên bố DONE nếu thiếu bằng chứng.

**Thẩm định thực tế:** `MainActivity.smali` ở `smali/com/ultracar/dexsplit/ui/` có `launch_session_id`; `Manager.shift(String,int)` gọi `saveOrder()`; `Addons.target(FF)` bản v43 cũ dựa tên/điểm gần nhất dẫn tới kéo sai. Không sửa phần này bằng việc thay chỉ tên.

**Chặn thao tác đúng phạm vi:** PC01 đã từng từ chối lệnh dựng stage v44 qua cổng an toàn. Không lặp, đổi công cụ/tài khoản để né từ chối. Các công việc source/test độc lập vẫn tiếp tục.
