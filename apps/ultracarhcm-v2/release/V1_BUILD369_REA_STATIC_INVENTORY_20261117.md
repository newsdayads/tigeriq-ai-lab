# V1.2.23 APK — kiểm kê tĩnh REA 6.9.0 (PC01, 17/11/2026)

**Chỉ là quan sát tĩnh, không xác minh hành vi ứng dụng trên xe.** Công việc chính: [#5135 — UltraCarHCM V2](https://github.com/newsdayads/tigeriq-ai-lab/issues/5135). Không chứa APK, byte chương trình hoặc media độc quyền.

## Nguồn và biên nhận
- Đầu vào `D:\TigerIQ\Apps\DeXCamPersonal\Builds_v1223\UltraCar_v1.2.23.apk` (35.219.958 byte); SHA-256 `07FA280005D71C0D4E38C085C3077ED01B66497E1E3EB54B0C2ED4D7999F038E` khớp manifest phát hành V1.2.23/369.
- `rea-agents@6.9.0`, `jadx-headless-mcp-0.7.1-all.jar` được cấp qua biến môi trường **chỉ trong tiến trình**, `inspect-android-package` exit 0; bằng chứng REA lưu **riêng tư**: `D:\TigerIQ\Evidence\ultracar-v1223-rea690-manifest-20261117.json` (SHA-256 `BA13A8224E6122C96094E0D63502EBC4A9583A3F7C09F7249762F8336CCE8FBA`).
- Phân tích tĩnh ghi nhận: **9.368 class**, **625 tài nguyên**, **27 thành phần manifest** gồm 10 Activity, 9 Service, 5 Receiver, 3 Provider. Min SDK 26, target SDK 33, 18 khai báo quyền.
- Đọc từ APK: `com.tigeriq.dexsplit`, **versionName 1.2.16 / versionCode 362**, *không khớp* nhãn phát hành ngoài 1.2.23 / 369; `aapt dump badging` xác nhận độc lập, `apksigner` cho cert SHA-256 `71617043EACE89E5F220EA9168B0A9592808111B0F17EAA219F5E6ECEB569558`. Không sửa tệp V1.

## Thành phần thuộc namespace UltraCar/TigerIQ được tìm thấy
| Loại | Thành phần | Phạm vi cần đối chiếu V2 |
|---|---|---|
| activity | `com.ultracar.dexsplit.ui.MainActivity` | F01/F08/F21 |
| activity | `com.ultracar.dexsplit.ui.CascadePrimerActivity` | F01/F22 |
| activity | `com.tigeriq.camera.RemoteShortcutConfigActivity` | D04/F10 |
| service | `com.ultracar.dexsplit.ui.service.ZoneOverlayService` | F07/F08 |
| service | `com.ultracar.dexsplit.ui.service.FloatingCameraService` | F03/F04/F06 |
| service | `com.tigeriq.camera.RemoteKeyAccessibilityService` | D04/F20 |
| receiver | `com.ultracar.dexsplit.data.ReverseGearReceiver` | D05/F05 |
| receiver | `com.ultracar.dexsplit.data.DexDockReceiver` | D06/F07 |
| receiver | `com.ultracar.dexsplit.data.BootReceiver` | F07/F22 |

**An toàn:** `ReverseGearReceiver` được khai báo `exported=true`, không khai báo permission tại manifest. Không được coi bất cứ broadcast vào receiver là tín hiệu số R vật lý được xác thực; V2 phải xác minh nguồn/trạng thái thực và giới hạn điều khiển camera an toàn. AccessibilityService yêu cầu quyền đặc biệt do người dùng tự cấp. Đây là phân loại bề mặt tĩnh; chưa kết luận lỗ hổng bảo mật hoặc cơ chế hành vi vì chưa rà logic trong receiver.

## Khoảng trống còn lại
- Manifest và class inventory không phải bản đồ đầy đủ màn/tab/nút. Phải quan sát V1.2.23 thật, chụp từng trạng thái, so khớp F01–F22/D01–D10.
- Chưa có biên nhận camera UVC/số R/DeX ngoài/remote Bluetooth tương đương ở V2; chưa đủ media/giấy phép F18.
- Không được chuyển `SOURCE_PRESENT` thành `PASS` hoặc dùng mã bị dịch ngược làm mã nguồn V2.
