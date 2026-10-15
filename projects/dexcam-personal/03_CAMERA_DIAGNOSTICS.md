# 03 — Phân tích camera lùi / chẩn đoán nguyên nhân

## 1. Kết nối do Owner xác nhận
```
[Camera sau xe] --video analog?--> [Cục điều khiển / bộ chuyển]
                                   ^ dây đỏ đến tín hiệu R xe
                                   ^ dây đen nối dây đen cục điều khiển
                                              |
                                          [USB data]
                                              |
                                          [USB Hub]
                                              |
                                     [Samsung DeX/Android]
                                              |
                                [Ứng dụng UltraCar hiện tại]
```
- Đã rõ **bộ điều khiển phát cáp USB đến hub**.
- Owner nói camera "chỉ xuất hiện khi vào R": **chưa phân biệt USB descriptor mới attach/detach hay chỉ video mới có tín hiệu**; đây là nút chẩn đoán quan trọng.
- Không có bản vẽ mạch/đồng hồ đo; **chưa được phép khẳng định dây đen là GND**, dây đỏ luôn 12 V, công tắc high/low hay điều khiển chuyển nguồn.

## 2. Triệu chứng hiện tại
1. DeX đang chạy các cửa sổ ứng dụng bình thường.
2. Vào R, đáng lẽ camera hiện nổi nhưng có lần thất bại.
3. Bấm biểu tượng camera trong UltraCar, camera nhiều lần mở được.
4. Chưa có log ghép cặp thành công/thất bại; do đó chưa có nguyên nhân chính xác.
5. Video trước ghi hình camera và giao diện đa cửa sổ, chưa xác nhận được điện áp/USB attach.

**Không đánh đồng:**
- `USB detected`: Android nhìn thấy thiết bị;
- `permission granted`: ứng dụng có quyền USB;
- `stream opened`: UVC mở thành công;
- `frame valid`: nhận hình sống hợp lệ;
- `window visible`: giao diện camera thực sự nổi trên ứng dụng khác.
- `reverse intent OFF`: **chỉ được ghi nếu nguồn R=OFF đã kiểm chứng**; mất frame, USB detach hay stream stop không mặc nhiên tương đương rời số R. Khi không rõ R đang ON/OFF mà camera mất hình, phải ưu tiên trạng thái cảnh báo và ghi `reverse_state=UNKNOWN` thay vì tự đóng cửa sổ để trả bố cục.

## 3. Dấu vết từ APK (đã đọc tĩnh)
- Có `classes.dex`, các native library `libUVCCamera.so`, `libuvc.so`, `libusb1.0.so`.
- Trong DEX hiện diện chuỗi `camera_auto_open_edge`, `camera_auto_open_skip`, `camera_usb_discovery`, `camera_permission_retry`, `camera_open_view`, `camera_signal`.
- Những dấu vết này hỗ trợ việc tồn tại các thành phần phát hiện/hiển thị/tự mở trong app gốc; **không đủ xác nhận chính xác call graph, nhánh điều kiện, timeout hay lỗi cụ thể khi chạy thực tế**.

## 4. Bảng giả thuyết RCA có kiểm chứng
| Mã | Giả thuyết | Dấu hiệu phân biệt | Kiểm chứng phù hợp |
|---|---|---|---|
| C-01 | Event USB attach bị bỏ lỡ | Android nhận thiết bị nhưng auto-open không có log | So sánh Android USB device list và log app cùng mốc |
| C-02 | USB vẫn cắm, chỉ tín hiệu video thay đổi | Không có attach/detach khi R, nhưng frame xuất hiện | Theo dõi USB descriptor + frame timestamp trong một chu kỳ R |
| C-03 | Quyền USB cấp muộn/chưa cấp | Thiết bị hiện trong danh sách, stream chưa mở; nhấn icon xin quyền | Kiểm tra quyền hệ thống + log permission grant |
| C-04 | Thiết bị UVC enumeration chậm | Event attach có, interface hoặc format chưa sẵn sàng | Poll lại sau thời điểm attach, chụp descriptor |
| C-05 | Stream initialization thất bại | USB và quyền hợp lệ, không first frame | Log UVC open, format negotiation, first-frame timeout |
| C-06 | Hình video xuất hiện nhưng không nhận là signal valid | Frame có nhưng camera UI không hiện | Phân tích sample frames/quality, tránh nhận đen là mất R |
| C-07 | Bị giới hạn đưa Activity lên foreground | Camera đã có frame, cửa sổ không nổi | Ghi `activity-start/overlay` error và task/window state |
| C-08 | Nguồn/hub USB chập chờn | Dmesg / Android USB detach bất ngờ, thiết bị đổi ID | Kiểm tra nguồn PD, cáp, cổng, hub khi xe đỗ |
| C-09 | Chuyển tín hiệu analog/chuẩn PAL-NTSC | Hình xanh, đen, méo hoặc trễ khi R | Xác định chuẩn nguồn và capture mode |
| C-10 | Hai lần kích hoạt gần nhau gây race | Lỗi tăng khi R→D→R nhanh | Test có mốc monotonic và event generation |

**C-01..C-10 đều CHƯA XÁC NHẬN** trên thiết bị; không xếp mức phần trăm nguyên nhân.

## 5. Quy trình đo thực địa khi Owner giao kiểm thử
**Điều kiện an toàn:** xe ở nơi dừng/đỗ an toàn, có người phụ hỗ trợ nếu cần; không thao tác kỹ thuật khi đang lái. Không cắm nhầm nguồn R/đo bằng dây rời nếu chưa có thợ xác nhận sơ đồ điện.
1. Ghi kiểu máy Samsung, Android, One UI, DeX, firmware hub, cách cấp nguồn USB-PD.
2. Với R=OFF: chụp `UsbManager.getDeviceList()`, descriptor UVC, quyền và trạng thái frame nếu có.
3. Với R=ON: ghi cùng bộ thông tin cùng đồng hồ thời gian, có cả trạng thái cửa sổ.
4. R=OFF: xác minh USB biến mất hay chỉ luồng video dừng.
5. Lặp **tối thiểu 5 chu kỳ phát hiện**, sau đó mở rộng thành **50 chu kỳ nghiệm thu**; ghi thành công/thất bại từng lần.
6. Với **một lần mở tự động thất bại**, ghi ngay trạng thái Android USB, app foreground, quyền, first-frame, UI; sau đó bấm icon thủ công để so sánh đúng epoch.
7. Thử tháo/cắm USB **chỉ khi xe dừng và thiết bị an toàn**; ghi tác động khôi phục.
8. Nếu thấy màn hình xanh/mất màu: ghi đúng thời điểm so với thay R, frame format, resolution, FPS; không tự kết luận hỏng chipset.

## 6. Bộ dữ liệu kiểm thử tối thiểu (đề xuất)

Mỗi lần chuyển R là **một dòng CSV**, không tách tiêu đề thành nhiều dòng. Các mốc nội bộ Android nên dùng cùng đồng hồ **monotonic**; mốc R quan sát bằng thiết bị ngoài **có thể có cơ sở thời gian khác**. Chỉ tính độ trễ khi đồng hồ giống nhau hoặc có bằng chứng đồng bộ, offset và sai số; mốc không quan sát được ghi `NOT_MEASURED`, không thay bằng số 0 hoặc suy đoán R=OFF.

```csv
test_id,cycle_id,device_model,android_version,oneui,dex_mode,hub_power,app_target_sdk,usb_vid,usb_pid,usb_device_class,usb_interface_class,usb_present_before_R,usb_present_during_R,camera_runtime_permission,camera_sensor_privacy,usb_permission,reverse_state,reverse_state_evidence,clock_source,R_on_timestamp,R_on_clock_source,R_on_evidence,usb_detected_timestamp,first_live_frame_timestamp,first_live_frame_rendered_timestamp,window_visible_timestamp,first_visible_live_frame_timestamp,R_off_timestamp,R_off_clock_source,R_off_evidence,layout_restored_timestamp,clock_sync_evidence,clock_sync_uncertainty_ms,auto_open_success,manual_open_success,error_code,private_log_pointer,notes
```

- `cycle_id`: mã khác nhau cho từng lượt, kể cả lượt thất bại; phải liên kết được log USB, frame và cửa sổ của **cùng lượt**.
- `reverse_state`: trạng thái tại **thời điểm kết thúc ghi nhận** của lượt (`ON` / `OFF` / `UNKNOWN`), không thay thế lịch sử hai cạnh chuyển số. `reverse_state_evidence` chỉ chứng minh trạng thái đó; không dùng việc mất hình/USB làm bằng chứng R=OFF.
- `R_on_evidence` và `R_off_evidence`: hai nguồn xác nhận **riêng** cho mốc bật/tắt R. Chỉ ghi `R_off_timestamp` khi có nguồn R=OFF đã kiểm chứng; nếu chưa đo được, ghi `NOT_MEASURED` cho **cả mốc và bằng chứng**, giữ `reverse_state=UNKNOWN` nếu trạng thái cuối không thể xác định. Không suy ra R=OFF từ `usb_detached`, mất frame hoặc UI đóng.
- `R_on_clock_source` / `R_off_clock_source`: tên nguồn thời gian thật của từng cạnh R; `clock_source` là đồng hồ dùng cho mốc USB/stream/hiển thị nội bộ Android. Không gán nhãn `monotonic` cho mốc video quan sát bên ngoài nếu chưa chứng minh.
- `clock_sync_evidence`: tham chiếu phép đối chiếu hai nguồn đồng hồ, gồm cách đồng bộ, offset giữa hai clock và nguồn chứng cứ; `clock_sync_uncertainty_ms` là sai số ước lượng có cơ sở. Nếu nguồn clock khác nhau mà thiếu một trong hai trường này, ghi `NOT_MEASURED` và **không tính latency liên nguồn**; chỉ so sánh các mốc cùng đồng hồ.
- `first_live_frame_rendered_timestamp`: mốc UI **render frame sống**, khác với lúc Stream Engine nhận frame (`first_live_frame_timestamp`) và lúc cửa sổ hiện (`window_visible_timestamp`). Hai sự kiện render và hiện cửa sổ **không bắt buộc xảy ra theo một thứ tự**; không được lấy `frame rendered→window visible` làm độ trễ cố định.
- `first_visible_live_frame_timestamp`: mốc đầu tiên có **hình sống hợp lệ thật sự được người dùng nhìn thấy trong cửa sổ đang hiện**, có bằng chứng frame mới/freshness theo cùng `cycle_id`. Không được suy diễn bằng `max(first_live_frame_rendered_timestamp, window_visible_timestamp)` nếu không chứng minh hình ở thời điểm sau là còn sống/đang được hiển thị. Thiếu telemetry/bằng chứng quan sát thì `NOT_MEASURED`; tính `R→first visible live frame` chỉ khi đủ đồng hồ hoặc đồng bộ/sai số.
- `app_target_sdk`, `usb_device_class`, `usb_interface_class`, `camera_runtime_permission`, `camera_sensor_privacy`, `usb_permission`: ghi đúng metadata hệ điều hành/USB và các grant riêng biệt. **Device composite có thể không mang class VIDEO ở cấp thiết bị nhưng interface mang class VIDEO**; việc video capture được hệ thống nhận diện và chốt camera privacy phải kiểm tra trên Android/One UI thật. `camera_sensor_privacy`: `ENABLED` / `DISABLED` / `NOT_MEASURED`; chỉ ghi khi có phương thức quan sát hợp lệ, **không tự đổi cài đặt riêng tư**. Điều kiện CAMERA target API 28+ từ Android là nguồn tham khảo chính thức, không coi `USB_CLASS_VIDEO` là giá trị thật khi descriptor chưa đo. [Android UsbManager](https://developer.android.com/reference/android/hardware/usb/UsbManager); [AOSP kiểm tra video capture/camera privacy](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/services/usb/java/com/android/server/usb/UsbUserPermissionManager.java).
- `usb_present_before_R` và `usb_present_during_R`: `YES` / `NO` / `NOT_MEASURED`, nhằm phân biệt USB attach với video chỉ xuất hiện khi R.
- `clock_source`: đồng hồ dùng cho **các mốc Android** (`usb_detected`, `first_live_frame`, `first_live_frame_rendered`, `window_visible`, `first_visible_live_frame`, `layout_restored`); chỉ tính chênh lệch khi các mốc cùng cơ sở thời gian hoặc có bù offset/sai số với nguồn R đã đo.
- `auto_open_success` / `manual_open_success`: `YES` / `NO` / `NOT_TESTED`. Không đánh dấu YES nếu chỉ thấy USB/nhận được frame/hiện cửa sổ nhưng **không có chứng cứ `first_visible_live_frame_timestamp` thực tế** hoặc không chứng minh được luồng hình còn sống đúng lượt.
- `private_log_pointer`: tham chiếu nhật ký **nội bộ trên thiết bị**, không đưa dữ liệu định danh, tệp log thô hoặc URL riêng tư lên kho công khai.

**Cổng 5 lượt khám phá B04:** cần 5 `cycle_id` khác nhau, có mốc R và kết quả tự mở từng lượt; tối thiểu một lần auto fail (nếu xảy ra tự nhiên) phải đối chiếu với bấm mở thủ công cùng lượt. Không tạo lỗi giả hoặc coi lượt không đo được là đạt. **50 lượt nghiệm thu** là giai đoạn riêng và chỉ thực hiện sau khi có sản phẩm được phép thử.

Lưu dữ liệu tại thiết bị; **không đưa log có IMEI/serial/vị trí/biển số lên GitHub công khai**.

## 7. Các phép thử phân biệt nguyên nhân
### T-A — Thử "auto fail nhưng icon thành công"
Nếu `USB_CONNECTED, permission=true, stream/first-frame ready` trước lúc icon, nhưng auto không mở UI → ưu tiên điều tra coordinator và quyền hiển thị cửa sổ; **không đổ lỗi cho dây camera**.

### T-B — Thử USB chỉ attach sau R
Nếu descriptor thực sự biến mất ở R=OFF → ưu tiên attach receiver, tốc độ enumerating, requestPermission, lần mở đầu tiên và quyền đã cấp lại.

### T-C — Thử USB luôn attached
Nếu USB list không thay đổi nhưng frame valid chỉ có khi R=ON → thiết kế signal-based activation, không dựa vào attach event.

### T-D — Thử camera đã mở mà không có hình
Nếu stream open thành công nhưng frame timestamp đứng im → retry bounded phần preview/camera; không dùng hoạt cảnh UI để che lỗi tín hiệu.

### T-E — Thử sự cố nguồn
Nếu thiết bị USB detach/re-attach không theo R, đặc biệt khi bật tải xe → cần kiểm tra thiết kế nguồn/hub/cáp và tương thích OTG, chưa thể giải quyết chỉ bằng app.

## 8. Bảo mật và an toàn
- Không đề xuất cấp nguồn trực tiếp vào dây đỏ/đen khi chưa xác nhận điện áp, cực tính hoặc bản vẽ của cục điều khiển.
- Không dùng camera này như hệ thống duy nhất để bảo đảm an toàn lùi xe trước nghiệm thu trên xe thật.
- Nếu ứng dụng không có tín hiệu, phải ghi `CAMERA_UNAVAILABLE` và hiển thị khác biệt rõ với hình live.
- Không yêu cầu root hay điều khiển CAN/OBD để "đoán" số R; chỉ dùng khi được xác minh là cần thiết và Owner duyệt riêng.
