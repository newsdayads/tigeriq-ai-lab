# 02 — Kiến trúc hệ thống dự kiến (chưa triển khai)

## 0. Phân loại bằng chứng
- [XÁC NHẬN] APK tham khảo có mã DEX và `libUVCCamera.so`, `libuvc.so`, `libusb1.0.so`; các nhãn DEX `camera_auto_open_edge`, `camera_auto_open_skip`, `camera_usb_discovery`, `camera_open_view`, `camera_signal`, `camera_permission_retry`, `am task resize` hiện diện trong file APK. **Sự tồn tại của chuỗi không đồng nghĩa kiểm chứng thứ tự gọi thực tế.**
- [OWNER] Camera, bộ điều khiển và hub nối như yêu cầu; tự mở khi R chưa ổn định.
- [ĐỀ XUẤT] Kiến trúc dưới đây **không phải kiến trúc nội bộ đã xác minh của UltraCar**.

## 1. Các lớp kiến trúc
```text
+---------------------------------------------------------------+
| Giao diện cá nhân / preset / bộ chỉnh camera / bảng chẩn đoán   |
+---------------------------+-----------------------------------+
| Layout Coordinator        | Camera Presentation Controller    |
| Per-app X/Y/W/H           | Ưu tiên khi R; hiển thị/mất hình   |
+---------------------------+-----------------------------------+
| Android Window Adapter    | UVC Camera Adapter                |
| ActivityOptions           | UsbManager + USB permission       |
| Capability / ADB bridge?  | Device descriptor / preview      |
+---------------------------+-----------------------------------+
| Event Coordinator: state machine + idempotency + deadlines     |
| R/USB signal detector, event queue, retry budget, recovery     |
+---------------------------------------------------------------+
| Local Repository: profiles, config schema, diagnostics, events |
+---------------------------------------------------------------+
| Android / Samsung DeX / USB Hub / camera controller             |
+---------------------------------------------------------------+
```
Mỗi module có giao diện rõ ràng, không trực tiếp gọi nhau vòng tròn; sự kiện camera xuất phát từ tầng USB, không phụ thuộc Activity đang foreground.

## 2. Phân tách lõi
### 2.1. System Capability Probe
- Đọc phiên bản hệ điều hành, trạng thái DeX / display, vùng hiển thị, density, USB host, tập quyền đã được cấp.
- Lưu chứng cứ `available / permission_missing / unsupported / unknown`, không đoán quyền Shizuku/ADB.
- Chọn phương án quản lý cửa sổ tương ứng; chỉ dùng cầu ADB nếu được chủ thiết bị thiết lập và kiểm thử.

### 2.2. USB Device Discovery
- Lắng nghe attach/detach khi vòng đời được cấp; khi khởi động/resume/reconnect **luôn reconcile với `UsbManager.getDeviceList()`** thay vì dựa hoàn toàn vào broadcast.
- Lọc interface USB Video Class, đối chiếu descriptor/VID/PID nếu có, cho phép chọn thủ công khi nhiều thiết bị.
- Không ngầm coi video invalid = USB disconnected.
- Sinh `usb_epoch` tăng khi phát hiện vật thể USB mới, không dùng `deviceId` đơn độc vì có thể bị hệ thống tái sử dụng.

### 2.3. Permission Broker
- Quyền Android CAMERA/RECORD_AUDIO và quyền truy cập USB là những loại quyền khác nhau; phải xác nhận thư viện/thiết bị nào thực sự cần quyền nào.
- Nếu chưa được cấp quyền USB, yêu cầu thông qua thông báo hệ thống trong điều kiện được phép; không fake/grant bằng API không có quyền.
- Nếu tự mở bị chặn quyền: báo `NEEDS_USER_PERMISSION`, tránh lặp vô hạn hoặc che giao diện bằng popup ngoài ý muốn.

### 2.4. Stream Engine
- Khởi tạo mode chỉ từ danh sách thiết bị thật hỗ trợ (UVC format, resolution, frame interval, endpoint).
- Kiểm chứng preview bằng frame timestamp/monotonic clock, không bằng trạng thái `opened` đơn lẻ.
- Nếu thiết bị giữ USB kết nối nhưng AV mất hình, stream engine còn phải phân biệt frame đen/trống/nhiễu, mất frame, stream stalled.
- Chỉ cung cấp API `latestFrameAgeMs`, `streamState`, `signalQuality`; không cho UI tự suy đoán.

### 2.5. Presentation Controller
- Phân biệt `camera_requested`, `camera_window_shown`, `first_live_frame_rendered`.
- Có 3 chế độ hiển thị (chỉ là phương án): `AUTO_USB`, `AUTO_VIDEO_SIGNAL`, `MANUAL_ONLY`; chọn sau khảo sát USB thật.
- Khi camera hiện, lưu `layout_snapshot_id` và không kill app bản đồ; khi hết R, chỉ đảo thay đổi cửa sổ do camera gây ra.
- Nếu tự đưa Activity lên nền trước bị Android hạn chế: thử phương án cửa sổ độc lập/overlay **nếu quyền, phiên bản và quy định cho phép**, thông báo giới hạn.

### 2.6. Window Layout Controller
- Lưu nhiều `profile_id`, `display_fingerprint`, `bounds` và `app_package`.
- Cấu hình chuẩn hóa tách giữa `requestedBounds` và `appliedBounds`, báo sai khác rõ.
- App không có quyền đặc biệt không thể đảm bảo resize task của ứng dụng khác; không dựa vào API nội bộ không được phép khi ra sản phẩm.
- Giao diện camera và cửa sổ các app khác là hai ranh giới quyền khác nhau.

### 2.7. Recovery Supervisor
- Deadline theo từng bước; một request đang chờ được xem là `pending`, không bị phát trùng chỉ vì có thêm attach broadcast.
- Thử lại có budget, backoff, jitter và reset khi event state thay đổi; không retry vô tận khi không có USB hoặc quyền.
- Có cơ chế thủ công dự phòng, nhưng không coi `bấm icon mở được` là tự mở thành công.
- Restart preview không được phép giữ stale frame dưới dạng trực tiếp.

## 3. State machine camera được đề xuất
```text
NO_USB
  └─ attach / enumeration → USB_DISCOVERED
USB_DISCOVERED
  ├─ missing permission → WAIT_PERMISSION
  ├─ supported + granted → OPENING
  └─ unsupported → UNSUPPORTED
WAIT_PERMISSION
  ├─ granted → OPENING
  └─ denied/cancelled → USER_ACTION_REQUIRED
OPENING
  ├─ stream created → WAIT_FIRST_FRAME
  └─ timeout/error → RECOVERING
WAIT_FIRST_FRAME
  ├─ valid live frame → SIGNAL_VALID
  ├─ no useful frame → WAIT_SIGNAL / RECOVERING
  └─ disconnect → NO_USB
SIGNAL_VALID
  ├─ policy permits + UI visible → CAMERA_VISIBLE
  ├─ permission/UI blocked → PRESENTATION_BLOCKED
  └─ signal gone → SIGNAL_LOST_CONFIRM
CAMERA_VISIBLE
  ├─ signal/R gone confirmed → RESTORE_LAYOUT → WAIT_SIGNAL / NO_USB
  ├─ stream stalls → RECOVERING (show unavailable, not stale)
  └─ repeated attach same epoch → no-op
RECOVERING
  ├─ recovered → WAIT_FIRST_FRAME
  └─ max attempts → USER_ACTION_REQUIRED
```
**Tất cả ngưỡng thời gian chỉ được chốt sau đo**, không mặc định con số cố định cho mọi chipset.

## 4. Hàng đợi sự kiện có xác nhận
Các sự kiện đề xuất:
- `UsbAttached(deviceFingerprint, epoch, at)`
- `UsbDetached(epoch, at)`
- `PermissionGranted/Denied(epoch, at)`
- `StreamOpened/Failed(epoch, at)`
- `FrameReceived(frameId, at, quality)`
- `SignalValid/Invalid(epoch, at)`
- `ReverseIntentDetected(source, confidence, at)`
- `WindowShown/Hidden(taskId, at)`
- `LayoutRestored(profileId, at)`
Nguyên tắc: serial event reducer hoặc single-writer actor cho một camera session. Không phát `open` kiểu fire-and-forget mà không xác nhận cửa sổ thực hiện xong. `requestId` + `generation` chống race khi R bật/tắt nhanh. Cancel tác vụ cũ khi epoch thay đổi.

## 5. Quan sát vận hành & thời gian
- Clock dùng monotonic cho đo độ trễ, wall time để đối chiếu video/hệ thống.
- Mỗi lần R/USB có correlation ID; log đủ: `usb_seen`, `permission_ready`, `stream_opened`, `first_frame`, `signal_valid`, `window_shown`, `reverse_off`, `layout_restored`, `error_reason`.
- Bộ đếm riêng: `usbAttachMiss`, `permissionDenied`, `previewTimeout`, `uiOpenBlocked`, `layoutRestoreFailed`.
- Nhật ký vòng quay (ring buffer) trên máy, không ghi hình/video mặc định; xuất thủ công khi được chủ xe đồng ý.

## 6. Dữ liệu cấu hình đề xuất
```json
{
  "schema_version": 1,
  "profiles": [
    {
      "id": "default",
      "display": {"width_px": null, "height_px": null, "density": null},
      "windows": [
        {"package": "owner-chosen.package", "bounds": {"x": 0, "y": 0, "width": 500, "height": 700}, "mode": "absolute_px"}
      ],
      "camera": {
        "device_fingerprint": null,
        "activation_mode": "UNDECIDED",
        "exit_policy": "RESTORE_PREVIOUS_LAYOUT",
        "preview_aspect": "FIT"
      }
    }
  ]
}
```
Trường null có nghĩa **chưa được đo**. Tọa độ là ví dụ lược đồ, không phải số dùng thật.

## 7. Quyết định công nghệ chưa chốt
- Kotlin Android SDK, Jetpack Compose hay XML, thư viện UVC open-source có điều khoản phù hợp: **phương án**.
- Dịch vụ nền/foreground service: cần kiểm tra giới hạn Android và công bố đúng quyền.
- Cầu ADB/Shizuku (nếu có): chỉ sau chủ máy đồng ý bật và kiểm thử quyền; không yêu cầu root mặc định.
- Định dạng log và cơ chế xuất lỗi cần cân nhắc dữ liệu vị trí xe.

## 8. Nghiệm thu kiến trúc trước code
Dùng một sơ đồ sự kiện để chứng minh mọi nhánh USB/permission/signal/UI/restore có đường lỗi xử lý; xác nhận không cần Firebase hoặc Internet; liệt kê quyền thực cần xin; kiểm tra không buộc phải truy cập hidden API trái nền tảng.
