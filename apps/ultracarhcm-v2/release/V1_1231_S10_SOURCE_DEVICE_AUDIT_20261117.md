# UltraCar V1.2.31 trên S10 — bằng chứng phụ đối chiếu V2 (17/11/2026)

## Chuẩn Golden chính thức — KHÔNG dùng nhãn tệp S10 thay thế
- **Nguồn chuẩn Owner accepted:** `apps/ultracarhcm-v1/release/current-release.json` trên GitHub `main`, [Issue #5129](https://github.com/newsdayads/tigeriq-ai-lab/issues/5129), V1 `v1.2.23`, Build `369`, SHA256 `07FA280005D71C0D4E38C085C3077ED01B66497E1E3EB54B0C2ED4D7999F038E`; đã nghiệm thu Z Fold 2/DeX 15/11/2026.
- **Bằng chứng riêng Samsung S10:** tệp mang tên `UltraCar_v1.2.31.apk` nhưng AndroidManifest thật vẫn `1.2.16`/Build `362` và SHA256 `D8B8DE0A454ACB88E911AD11331EFF91884714466EF8B4554807D8D3447F82FC`. Tệp này **KHÔNG phải** bản V1 chính thức mới hơn Build369.
- Chỉ dùng APK S10 Build362 làm nguồn so sánh phụ cho màn hình/luồng thực tế đã quan sát; tiêu chí nghiệm thu cuối và fail-closed release gate V2 phải dùng **Golden Build369**. Không khẳng định local file chỉ có tên `v1.2.23` chứa version369 nếu chưa xác minh hash thật.


**Công việc gốc:** [#5135](https://github.com/newsdayads/tigeriq-ai-lab/issues/5135). **Trạng thái:** V2 CHƯA FULL-PARITY; KHÔNG phát hành thêm APK. File kiểm chứng đọc-được-bằng-máy: `tests/ultracarhcm-v2/v1-2-31-evidence.json`.

## Chứng cứ có thể xác minh
- `UltraCar_v1.2.31.apk` hiện ở Drive, 35.166.511 byte, SHA256 `D8B8DE0A454ACB88E911AD11331EFF91884714466EF8B4554807D8D3447F82FC`.
- **APK V1 đang cài trên S10** được trích qua ADB ở chế độ đọc từ `pm path` và có SHA **trùng chính xác** với V1.2.31 trên Drive (không phải V1.2.23). Do đó ảnh V1 chụp thực tế thuộc đúng V1.2.31.
- AndroidManifest **nhúng trong V1.2.31 trên S10** là `com.tigeriq.dexsplit`, `1.2.16` / `362`. Bản V1 Golden được nghiệm thu thực tế có Build `369`/`1.2.23` và checksum riêng trong `current-release.json`. Phần thay đổi ZIP V1.2.23 → V1.2.31: `classes.dex` thay đổi (tăng 1.896 byte giải nén), 3 `META-INF` old-JAR-signature files không còn. Các asset còn lại không thêm/xóa, không khẳng định tính năng đã tăng theo nhãn.
- Android `apksigner` V1.2.31 PASS v2/v3; chứng chỉ SHA256 `71617043EACE89E5F220EA9168B0A9592808111B0F17EAA219F5E6ECEB569558`.
- REA 6.9.0 / JADX 0.7.1 đọc V1.2.31 trong thư mục Evidence riêng tư: **9.369 classes, 622 resource entries, 27 manifest components, 18 permissions**. Biên nhận REA SHA `D9F73DCD1C7D6044FB678E1C2C74B6DEA0F9F22F43DEEDA8D41DB3F132B511C9`; KHÔNG đưa APK/decompile/asset độc quyền lên GitHub.

## Gap thực tế (ảnh S10 trên đúng bản APK)
- **V1**: nền đường phố ban đêm, xe trên màn HOME, widget thời tiết và phím chức năng, Camera USB nổi đè cửa sổ chính. **V2 QA**: nền đậm đơn sắc, ô SPORT và nhiều phần media/xe chỉ là placeholder; thiếu đối chiếu giao diện đầy đủ.
- V1 có `RemoteKeyAccessibilityService`, `RemoteKeyShortcutEngine` với hành vi *phím giữ mở popup / bấm ngắn replay*. Bản V2 độc lập trong [PR #5731](https://github.com/newsdayads/tigeriq-ai-lab/pull/5731) bổ sung học phím, preset media, nhấn giữ, short-press replay, cấu hình user-initiated và long-press icon DeX. **Chưa có thử remote Bluetooth vật lý**, không PASS.
- V1 `ReverseGearReceiver` chỉ ghi log và **phớt lờ thông báo lùi khi tín hiệu vật lý chưa xác minh**. Không giả luồng nhận số R tự động khi xe chưa gắn nguồn tín hiệu.
- Popup V2 đang được sửa thành mở/đóng nguyên cửa sổ thay vì chỉ ngắt hình USB; tính tọa độ từ màn DeX đích, **chưa test DeX màn ngoài**.

## Kiểm thử có biên nhận, không lấy mock thay phần cứng
- QA riêng `ai.tigeriq.ultracarhcm.v2.rqa` cài trên S10 **không thay đổi V1/V2 cũ**.
- PC01 Gradle assembleDebug + assembleDebugAndroidTest + JVM unit **PASS**.
- Android Instrumentation **OK (15 tests)**: **14 màn Activity mở được**, **1 ca kiểm tra khai báo/trạng thái quyền CAMERA**. Đây là test mở màn, **không phải 15 chức năng parity**.
- Hệ thống còn hiển thị `CAMERA: granted=false`; không tự cấp quyền hoặc giả UVC đã chạy. Biên nhận Android Instrumentation SHA256 `7C65B9E5CC031A951A03A373CC66ED76CBE5C5AC96EB882C13D28FDC44A5DE95`.
- DeX external/UVC thực/remote vô lăng/số R/xe và F18 backend/license chưa nghiệm thu. Chỉ chạy full hardware khi có thiết bị vật lý và cổng quyền thật.

## Quy tắc xuất APK
Không đẩy thêm bản `UltraCarHCM-V2.MM.NN.apk` cho người dùng chỉ vì build/JUnit/15-smoke PASS. Trước khi xuất phải có nguồn V1 hiện hành đã kiểm, bảng hành vi chi tiết F01–F22+D01–D10, chứng cứ media/license hợp lệ, kiểm thử device thật, đúng source SHA + cert ký, kiểm tra toàn bộ tính năng bắt buộc và nghiệm thu cuối. Nếu thiếu bằng chứng, trạng thái phải là CHƯA ĐẠT.

**Các nguồn:** [V1 cũ đã nghiệm thu #5129](https://github.com/newsdayads/tigeriq-ai-lab/issues/5129), [V2 #5135](https://github.com/newsdayads/tigeriq-ai-lab/issues/5135), [PR #5731](https://github.com/newsdayads/tigeriq-ai-lab/pull/5731).
