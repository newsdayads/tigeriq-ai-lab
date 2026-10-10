# DeXCam Personal — hồ sơ dự án độc lập (CHỈ ĐẶC TẢ)

> PROJECT_ID: `TIGERIQ_DEXCAM_PERSONAL` · Nguồn quản lý: [Issue #4625 — dự án Android/DeX riêng](https://github.com/newsdayads/tigeriq-ai-lab/issues/4625)
>
> **TRẠNG THÁI: DISCOVERY / ĐẶC TẢ. CHƯA LẬP TRÌNH, CHƯA BUILD, CHƯA KIỂM THỬ APK CÁ NHÂN.**
>
> **HOLD:** Chỉ nghiên cứu, viết yêu cầu và lập kế hoạch cho tới khi anh Sơn ra lệnh rõ ràng **LÀM APP** hoặc tương đương.

## I. Sứ mệnh

Tạo ứng dụng Android **mới, độc lập, dùng cá nhân**, kết hợp:
1. **Quản lý cửa sổ ứng dụng Samsung DeX** theo tọa độ/kích thước do người dùng định nghĩa; lưu bố cục và tái khôi phục đúng vị trí.
2. **Camera lùi tích hợp trong cùng ứng dụng**: camera analog → hộp điều khiển/chuyển đổi → USB hub → Samsung DeX. Khi vào số R, ưu tiên cửa sổ camera nổi bật; khi rời số R, trả lại bố cục các ứng dụng.
3. **Mở rộng linh hoạt** cho nhu cầu cá nhân tương lai, không bị ràng buộc bởi giấy phép sử dụng theo thời gian của nhà cung cấp ứng dụng tham khảo.
4. **Hoạt động cục bộ, không tài khoản/không Firebase/không phí thuê bao/không máy chủ điều khiển**.

**Không phải** dự án bẻ khóa, sửa APK, xóa bảo vệ license của UltraCar hoặc sao chép mã/nhãn hiệu độc quyền. UltraCar v240 là **đối tượng tham khảo về chức năng và nghiên cứu tương thích**, không là source code để fork.

## II. Xác nhận từ Owner
- UltraCar gốc có cả quản lý nhiều cửa sổ và camera lùi.
- Camera qua cục điều khiển, ra USB và cắm vào hub đang phục vụ DeX.
- Dây đỏ nối với mạch/kích hoạt R của xe; dây đen nối với dây đen cục điều khiển; chưa có bản đo mạch.
- Khi R, camera đáng lẽ tự nổi lên, nhưng thường bị lỡ kích hoạt; bấm icon camera thủ công thường cho phép hiển thị.
- Khi không R, các cửa sổ ứng dụng đang hoạt động phải giữ bố cục bình thường.
- Owner yêu cầu trước tiên phân tích sâu và đăng ký thành dự án riêng; **chưa giao làm app**.

## III. Bằng chứng và mức tin cậy
- **[O] Đã xác nhận bởi Owner:** dây kích hoạt R, hub, triệu chứng lỗi, mục tiêu kinh doanh/kỹ thuật.
- **[A] APK tĩnh:** bản UltraCar v240 người dùng đã cung cấp có `classes.dex`, thư viện `libUVCCamera.so`, `libuvc.so`, `libusb1.0.so` trên ARM. Bằng chứng về khả năng UVC trong APK, **không chứng minh chipset phần cứng thực tế**.
- **[V] Video/ảnh:** đã được Owner cung cấp trong chat để quan sát bố cục/camera; chưa có log USB, ảnh USB descriptor, dữ liệu điện áp R.
- **[H] Giả thuyết:** nguyên nhân auto-open là race condition, bỏ lỡ sự kiện, quyền USB, vấn đề lifecycle, mất tín hiệu, nguồn hub; chưa có RCA trên thiết bị thật.
- **[T] Chưa kiểm thử:** không có lần chạy build cá nhân nào được nghiệm thu.

**Bảo vệ riêng tư:** Kho GitHub TigerIQ là **public**. Chỉ tài liệu yêu cầu gốc/chính chủ được phép đưa vào đây; **không tải APK, video, ảnh xe, mã hóa/credential, license, định danh phần cứng, khóa cá nhân, dữ liệu lái xe lên kho công khai**.

## IV. Mục lục tài liệu
1. [01_PRODUCT_REQUIREMENTS.md](01_PRODUCT_REQUIREMENTS.md) — mục tiêu, hành trình dùng, yêu cầu FR/NFR và phạm vi.
2. [02_SYSTEM_ARCHITECTURE.md](02_SYSTEM_ARCHITECTURE.md) — kiến trúc, vòng đời, trạng thái camera, xử lý lỗi, dữ liệu.
3. [03_CAMERA_DIAGNOSTICS.md](03_CAMERA_DIAGNOSTICS.md) — điều tra đường tín hiệu R, USB UVC, phân loại lỗi, phương pháp đo thực tế.
4. [04_DEX_WINDOW_ENGINE.md](04_DEX_WINDOW_ENGINE.md) — quản lý cửa sổ, ràng buộc quyền, tọa độ màn hình, thiết kế bố cục.
5. [05_QUALITY_ACCEPTANCE.md](05_QUALITY_ACCEPTANCE.md) — ma trận kiểm thử, định nghĩa đạt, tiêu chuẩn ghi bằng chứng.
6. [06_BACKLOG_AND_ROADMAP.md](06_BACKLOG_AND_ROADMAP.md) — tiến trình đề xuất, phụ thuộc, phân tách hạng mục.
7. [07_DECISIONS_RISKS_EXTENSIONS.md](07_DECISIONS_RISKS_EXTENSIONS.md) — quyết định, rủi ro, ý tưởng mở rộng, quy tắc thay đổi.
8. [08_PROGRESS_TRACKING.md](08_PROGRESS_TRACKING.md) — cách theo dõi 30 mốc, bằng chứng và tiến độ trên TigerIQ.
9. [project.yaml](project.yaml) — định danh và nhánh việc để hệ thống nhóm thành dự án riêng.

## V. Cổng điều hành / phạm vi ủy quyền
```
OWNER=SON
ORCHESTRATOR=VY
PRIORITY=P1_OWNER_OVERRIDE_20261010
RESOURCE_SCOPE=DEXCAM_PERSONAL_SPEC_20261009
STAGE=SPEC_ONLY
APP_IMPLEMENTATION=HOLD_UNTIL_EXPLICIT_OWNER_COMMAND
REPO_CODE=NOT_YET_CREATED
AUTO_QUEUE=EXCLUDED
RDC=NOT_AUTHORIZED
CODEX=NOT_AUTHORIZED
APK_INSTALL_OR_RELEASE=NOT_AUTHORIZED
MAIN_DIRECT_WRITE=FORBIDDEN
PAYMENT_OR_PAID_SERVICE=FORBIDDEN
DRIVE_SYNC=NOT_REQUIRED
```
Dự án được **tách riêng bằng hồ sơ, phạm vi tài nguyên, yêu cầu và tiến trình** bên trong repository điều hành TigerIQ. Đây **chưa phải repository mã nguồn Android riêng**; quyết định kho mã riêng phải hoàn tất trước khi viết ứng dụng.

**Đối chiếu nguồn động 2026-10-10:** Issue #4625 đã được Owner chuyển sang P1, NV02 có thể tiếp tục phần tài liệu trong đúng phạm vi. `AUTO_QUEUE=EXCLUDED` và `APP_IMPLEMENTATION=HOLD` vẫn áp dụng cho phần lập trình cho đến khi có lệnh rõ ràng; không khẳng định nhân sự đang chạy.

## VI. Điều kiện đổi trạng thái
- `DISCOVERY` → `SPEC_APPROVED`: Owner xác nhận phạm vi, camera/hub và các tiêu chí đo đã được thống nhất.
- `SPEC_APPROVED` → `IMPLEMENTATION_AUTHORIZED`: Có lệnh Owner giao lập trình app.
- `IMPLEMENTATION_AUTHORIZED` → `PROTOTYPE`: Có nguồn mã và kiểm thử; không khẳng định khi chỉ có bản mô tả.
- `PROTOTYPE` → `ACCEPTED`: kiểm thử thật trên điện thoại/DeX/camera; có bằng chứng các tiêu chí an toàn và chất lượng.
- `ACCEPTED` → `RELEASED`: Owner chấp thuận đúng phạm vi phát hành/cài đặt.

## VII. Điểm bị chặn (đối với việc lập trình, không chặn lập tài liệu)
USB VID/PID, điện áp/tín hiệu R, chuẩn video, phiên bản Android/One UI/DeX, khả năng ép cửa sổ, log attach khi vào R, quy trình xử lý người lái. **Không suy đoán các giá trị này.**
