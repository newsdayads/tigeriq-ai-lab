# LIVE STATE OVERRIDE — 2026-11-12 — ULTRACAR HCM V1.2.13 (BUILD 359) PUBLISHED & SYNCED
Authority: Direct Owner Instruction ("Cập nhật trạng thái mới nhất của App lên Github và Dashbroad TigerIQ. Đã là bản mới 1.2.13 rồi mà trên này vẫn còn trạng thái V73") + Issue #5129 + Issue #504.

1. **Phát hành UltraCar HCM v1.2.13 (Build 359) trên Drive, GitHub & OTA:**
   - Package: `com.tigeriq.dexsplit` | `versionCode`: `359` | `versionName`: `1.2.13`
   - File Drive: `G:\Drive của tôi\TigerIQ UltraCar\UltraCar_v1.2.13.apk` (35,203,574 bytes)
   - SHA-256: `8D2142788569B5E158456415A6ABC30A7BFF4667A99796429D1847CBFF3BDC00`
   - Chữ ký: `debug.keystore` chuẩn (cert SHA-256 `71617043eace89e5f220ea9168b0a9592808111b0f17eaa219f5e6eceb569558`), APK Signature v2/v3 PASS.
   - OTA & GitHub: `version.json` trên `main`, nhị phân `UltraCar_latest.apk` trên nhánh `apk-dist`, mã nguồn & unit test tại `apps/ultracarhcm-v1/src` & `apps/ultracarhcm-v1/tests`.

2. **Nội dung kỹ thuật chính từ V74 → v1.2.13 (Build 359):**
   - **Vạch lùi OEM Vector Canvas (`NativeGuideWarpView`, `ReversePathGeometry`, `MotionSteeringEstimator`):** dải bánh chuyển sắc xanh lá → vàng → đỏ theo kích thước 0.5m / 1.0m / 1.5m sát mép lề đường, lọc rung động khi đánh lái.
   - **Remote Bluetooth vô lăng (`RemoteKeyAccessibilityService`, `RemoteKeyShortcutEngine`):** nhấn giữ phím < 2 giây bật/tắt trực tiếp Camera Popup giống nút nổi Camera `[R]`, không còn ẩn nhầm app UltraCar.
   - **Đồng bộ tự động GitHub ↔ Dashboard TigerIQ (`#5129`):** workflow `.github/workflows/ultracar-version-dashboard-sync.yml` + `apps/ultracarhcm-v1/release/sync-ultracar-status.mjs` tự cập nhật Issue `#5129` (và Dashboard `ai.tigeriq.io.vn`) mỗi khi `version.json` / `current-release.json` cập nhật lên `main`.
   - **Trạng thái QA thiết bị thật:** Unit test Java (`GuideEngineUnitTest`, `RemoteKeyShortcutUnitTest`) PASS; kiểm thử thực tế trên Z Fold 2 / Samsung DeX đang ở trạng thái **CHỜ ANH SƠN** nghiệm thu.

---

# LIVE STATE OVERRIDE — 2026-11-02 — ULTRACAR HCM V1.0.74 (BUILD 315) VERIFIED & PUBLISHED
Authority: Direct Owner Instruction ("Gộp lại là 1 App. Duyệt thực hiện đi. Tôi cần App chuyên nghiệp") + Issue #504.

1. **Hợp nhất thành 1 App duy nhất: UltraCar HCM v1.0.74 (Code 315):**
   - File Drive: `UltraCar_v1.0.74_TEST.apk`
   - Đường dẫn Drive: `G:\Drive của tôi\TigerIQ UltraCar\UltraCar_v1.0.74_TEST.apk`
   - Dung lượng: 35,187,101 bytes | SHA-256: `82D07423353E25FF4BCBC5742BAB0E6650C8B2AC7B69CDF94878EEE706BA837E`
   - Chữ ký: `debug.keystore` chuẩn (SHA-256 cert `71617043eace89e5f220ea9168b0a9592808111b0f17eaa219f5e6eceb569558`), APK Signature v2/v3 PASS.
   - VersionCode: `315` | VersionName: `TigerIQ_HCM_v1.0.74`.

2. **Các cải tiến kỹ thuật toàn diện trong V74 theo đúng 5 yêu cầu từ anh Sơn:**
   - **1. Gộp làm 1 App duy nhất:** Hợp nhất toàn bộ Camera UVC, vạch kẻ căn lùi, nút nổi và màn hình cài đặt trực tiếp vào UltraCar HCM (`com.tigeriq.dexsplit`). Chuyển toàn bộ các bản APK dư thừa (`TigerIQ_Camera_*.apk`, V73 cũ) vào thư mục `Backup` trên Google Drive. Khi cắm USB không còn bị Android hỏi chọn app.
   - **2. Sửa triệt để lỗi bấm icon gây tắt App:** Thay thế cơ chế reflection Compose cũ bằng `CameraBridge` điều phối chuẩn xác:
     + Chạm nhanh (Tap < 0.5s): Bật / Tắt cửa sổ Camera an toàn, không crash launcher.
     + Bấm giữ (Long-press >= 0.5s): Mở trực tiếp Bảng Cài Đặt Camera (`CameraSettingsActivity`).
   - **3. Động cơ Vạch Căn Lùi Vector Canvas 100%:** Loại bỏ hoàn toàn phương pháp cắt 44 lát raster (`reverse_guidelines.png`) gây răng cưa, nham nhở và cắt khúc. Chuyển sang vẽ trực tiếp bằng `Path` và `Paint` (Anti-aliasing) với đường cong Bézier mượt mà, sắc nét tuyệt đối ở mọi độ phân giải (DeX / Fold 2).
   - **4. Cung cấp 3 Mẫu Vạch Kẻ Chuyên Nghiệp & Tùy Chỉnh:**
     + **Mẫu 1 (Sport Racing):** Dải neon cyan & đỏ thể thao, cánh khí động học, nhãn khoảng cách 0.5m / 1.0m / 1.5m nổi bật.
     + **Mẫu 2 (Luxury OEM):** Phong cách Mercedes / BMW với đường ray vàng đôi tinh tế và vạch phân đoạn.
     + **Mẫu 3 (Minimalist Modern):** Đường nét thanh mảnh hiện đại, tối đa hóa tầm nhìn mặt đường ban đêm.
     + **Bẻ lái động & Đảo chiều:** Uốn cong mượt mà theo góc đánh lái / cảm biến, tích hợp công tắc đảo chiều bẻ lái trong Cài đặt.
   - **5. Tự động hóa Số Lùi (Gear R):**
     + Về số R: Bắt buộc mở cửa sổ Camera nằm trên cùng (z-order top, `FLAG_KEEP_SCREEN_ON`).
     + Về P, D, N: Lập tức ẩn/tắt cửa sổ ngay (0 giây), trả lại toàn màn hình cho Google Maps / Launcher.
   - **6. Giao diện Cài đặt Camera dạng Lưới 2-3 thẻ / hàng:** Bố cục thẻ cân xứng trên màn hình ngang DeX, đầy đủ công tắc tự động hóa, tùy chọn mẫu vạch, đảo chiều lái và cấp quyền USB.

---

# LIVE STATE OVERRIDE — 2026-11-02 — TIGERIQ CAMERA V1.0.3 VERIFIED & PUBLISHED
Authority: Direct Owner Instruction + Samsung DeX Z Fold 2 In-Car Verified + Issue #504.
