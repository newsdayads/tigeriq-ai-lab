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
```text
test_id,device_model,android_version,oneui,dex_mode,hub_power,
usb_vid,usb_pid,usb_attach_on_R,usb_permission,
R_on_timestamp,usb_detected_timestamp,first_live_frame_timestamp,
window_visible_timestamp,R_off_timestamp,layout_restored_timestamp,
auto_open_success,manual_open_success,error_code,notes
```
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
