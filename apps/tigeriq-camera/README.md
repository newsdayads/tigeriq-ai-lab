# TigerIQ Camera (ai.tigeriq.camera)

Ứng dụng Camera Lùi chuyên dụng độc lập dành cho Samsung DeX trên màn hình phụ xe ô tô. Tách rời hoàn toàn khỏi launcher UltraCar HCM để đảm bảo độ tin cậy và tốc độ kích hoạt tuyệt đối.

---

## 1. Mục tiêu và Kiến trúc Độc lập
- **Vấn đề giải quyết**: Trước đây trên nền UltraCar HCM, việc mở camera bị phụ thuộc vào vòng đời launcher phức tạp, thường xuyên gặp xung đột khi nhận diện số Lùi (R) hoặc treo giao diện.
- **Giải pháp**: `TigerIQ Camera` được xây dựng dưới dạng ứng dụng độc lập, chỉ tập trung xử lý kết nối USB UVC, nhận tín hiệu số R và hiển thị vạch căn lùi động.

---

## 2. Các Tính năng Cốt lõi (V1.0.3)

### A. Tự động Kích hoạt khi vào Số Lùi (Deterministic Reverse Triggering)
1. **Chỉ bật khi về số R**: Lắng nghe trực tiếp các broadcast `ACTION_REVERSE_GEAR` (hỗ trợ `com.tigeriq.dexsplit`, `com.ultracar.dexsplit`, `android.intent.action`, v.v.).
2. **Tự ẩn/tắt ngay lập tức khi về P hoặc D**: Đóng cửa sổ tức thì (0 giây) khi rời số R để không chiếm màn hình hoặc che khuất Google Maps, Be, Grab.
3. **Cửa sổ dạng nổi (Freeform Window)**: Trên Samsung DeX, ứng dụng tự động mở dạng cửa sổ nổi bên phải màn hình (74% chiều rộng, 88% chiều cao) giúp giữ bố cục tổng thể.

### B. Vạch Lùi Động Bẻ Cong Chuẩn Kích Thước & Đúng Chiều Lái
- **Cắt bỏ viền trong suốt**: Tối ưu vùng hiển thị vạch lùi thực tế (từ file gốc `reverse_guidelines.png`), phủ rộng 86% - 92% bề ngang và kéo dài sát cản sau của xe.
- **Tùy chỉnh kích thước**: Hỗ trợ 3 mức kích thước (Chuẩn 1.0x, To rõ 1.25x, Cực đại 1.45x) ngay trên giao diện cài đặt.
- **Sửa hướng bẻ lái**: Đã đảo chiều đánh lái theo đúng góc quay cua thực tế của xe; kèm công tắc "Đảo chiều bẻ lái" tùy chỉnh tức thì.

### C. Bộ Nhận Diện & Avatar Xe Chữ R Chuyên Nghiệp
- **Biểu tượng ứng dụng (Launcher Icon)**: Thiết kế xe thể thao nhìn từ trên xuống, viền Neon Cyan ánh kim loại, huy hiệu tròn đỏ chữ R thể thao chuyên nghiệp (xuất đầy đủ định dạng PNG ở mọi độ phân giải `mdpi` đến `xxxhdpi` và chuẩn adaptive-icon v26).
- **Nút nổi Thao tác Nhanh**: Avatar xe thể thao chữ R nổi trên màn hình DeX, hỗ trợ bật/tắt camera tức thì.

### D. Bố Cục Cài Đặt Lưới Gọn Gàng (2 Hàng x 3 Thẻ)
- Bố trí 6 thẻ chức năng khoa học trên màn hình ngang DeX:
  1. Cấp quyền Hệ thống (Camera, Nút nổi, Chạy nền)
  2. Thiết bị Camera USB (AFN_CAP VID: `ff02`, PID: `afa1`)
  3. Tự động hóa Số Lùi (Bật khi vào R, tắt khi về P/D, nút test mô phỏng)
  4. Vạch Căn Lùi & Đánh Lái (Bật/tắt, đảo chiều, chỉnh cỡ to rõ)
  5. Nút Camera Nổi (Bật/tắt, khởi động lại, đặt lại vị trí)
  6. Trạng Thái Hệ Thống & Bản dựng

---

## 3. Bản phát hành (Artifacts)
- **File cài đặt**: `TigerIQ_Camera_v1.0.3.apk` (và `TigerIQ_Camera_Latest.apk`)
- **Vị trí lưu trữ**: `G:\Drive của tôi\TigerIQ UltraCar\TigerIQ_Camera_v1.0.3.apk`
- **Package ID**: `ai.tigeriq.camera`
- **VersionCode**: `4` | **VersionName**: `1.0.3`
- **SHA-256**: `EDB824DA7DD1FEC5B8064F58142513889F8FCF5DECFFE337808E39E3206BB31C`
- **Keystore**: `D:\TigerIQ\Tools\debug.keystore` (SHA-256 cert: `71:61:70:43:EA:CE:89:E5:F2:20:EA:91:68:B0:A9:59:28:08:11:1B:0F:17:EA:A2:19:F5:E6:EC:EB:56:95:58`)
