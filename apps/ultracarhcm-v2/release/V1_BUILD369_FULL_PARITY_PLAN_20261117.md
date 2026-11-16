# UltraCarHCM V2 — Chuẩn tương đương V1.2.23 Build 369 (17/11/2026)

**Công việc duy nhất:** [#5135 — UltraCarHCM V2 — xây dựng lại ứng dụng gốc](https://github.com/newsdayads/tigeriq-ai-lab/issues/5135). Kế thừa F01–F22 từ `tests/ultracarhcm-v2/f01-f22-source-matrix.json`, KHÔNG lập hàng đợi khác. Bản V1: [#5129 — V1.2.23 Build 369 đã nghiệm thu](https://github.com/newsdayads/tigeriq-ai-lab/issues/5129).

## Bản gốc không được ghi đè
- V1: `com.tigeriq.dexsplit`, `UltraCar_v1.2.23.apk`, Build `369`, SHA-256 `07FA280005D71C0D4E38C085C3077ED01B66497E1E3EB54B0C2ED4D7999F038E`; ngày 15/11/2026 đã nghiệm thu trên Z Fold 2/DeX.
- PC01: tệp `D:\TigerIQ\Apps\DeXCamPersonal\Builds_v1223\UltraCar_v1.2.23.apk` đọc trực tiếp ngày 17/11/2026: **35.219.958 byte, SHA256 khớp**. V1 và toàn bộ cấu hình là bất biến.
- V2: `ai.tigeriq.ultracarhcm.v2`, tiếp tục mã Kotlin/Gradle hiện hữu, không tái dựng từ đầu. Không phát hành TEST/Production chỉ vì CI đạt.

## Chuẩn đầy đủ = F01–F22 + D01–D10 + mọi thao tác thực tế phát hiện thêm
Với từng nút/nhấn giữ/tab/luồng/khởi động lại/hỏng mạng/USB: `ID → thao tác → kỳ vọng V1.2.23 → thực tế V2 → APK SHA → thiết bị → ảnh/video/logcat → kiểm thử → người nghiệm thu`. Trạng thái nguồn, mô phỏng hoặc điểm ảnh **không được** tự đổi thành PASS.

| ID | Nội dung bắt buộc | Phải kiểm chứng |
|---|---|---|
| F01 | Home, cockpit, tỷ lệ/nền/sidebar | So hình và chạm toàn bộ nút |
| F02 | Xe, màu, biển số, trạng thái | Chọn/lưu/khôi phục, media có quyền |
| F03 | USB/UVC video, quyền, phục hồi | Camera vật lý và rút/cắm |
| F04 | Cửa sổ Camera nổi | Bật/tắt/đổi màn hình |
| F05 | Số R và vạch lùi 0,5/1/1,5 m | Tín hiệu thật, hiệu chuẩn |
| F06 | Một nút Camera [R] kéo/thả | Kéo, chạm, không lặp |
| F07 | DeX ngoài/đa cửa sổ | Dock/undock/density/tọa độ |
| F08 | Lưu bố cục/5 nút lưu/9 ô | Nhấn/giữ, reset, khôi phục |
| F09 | Nền video/hình, ngày/đêm | Mọi trạng thái và lưu URI |
| F10 | Lối tắt, Maps, tác vụ dưới | App ngoài, nút Camera và BT |
| F11 | GPS/pin/thời tiết | Quyền, nguồn số liệu thật |
| F12 | OBD Bluetooth | Adapter/PIDs/kết nối lại |
| F13 | Đồng hồ cước/tuyến/giá | Kiểm số và dữ liệu lịch sử |
| F14 | Hồ sơ/tên/giấy phép | Hành vi đầy đủ, API có quyền |
| F15 | Cập nhật/thông báo | Kênh V2 TEST, ký/hash |
| F16 | Sao lưu và phục hồi | Cấu hình/ảnh, lỗi, hoàn tác |
| F17 | Ngôn ngữ/theme/palette | Danh mục V1.2.23 thực |
| F18 | Quản trị/kích hoạt | Backend chính chủ xác minh |
| F19 | Báo cáo/xuất dữ liệu | Định dạng/số thực |
| F20 | Quyền riêng tư/xử lý lỗi | Android permission/recovery |
| F21 | UI dọc/ngang/DeX | 1/2/3 cột, không cắt |
| F22 | Crash/ANR/offline/rollback | Cài song song V1/V2 |

## Phát hiện G0 — metadata APK không khớp nhãn phát hành (17/11/2026)
- Hash tệp chuẩn V1.2.23 trên PC01 trùng manifest phát hành: `07FA280005D71C0D4E38C085C3077ED01B66497E1E3EB54B0C2ED4D7999F038E`. **REA 6.9.0/JADX 0.7.1** `inspect-android-package` thành công với artifact riêng tư (không đẩy byte APK lên GitHub).
- Hai phép kiểm tra độc lập **REA** và **Android aapt dump badging** cùng đọc AndroidManifest của chính file này: `packageName=com.tigeriq.dexsplit`, `versionName=1.2.16`, `versionCode=362`, trong khi manifest phát hành bên ngoài ghi `1.2.23 / 369`. Chữ ký được đọc riêng bằng `apksigner` và khớp chứng chỉ công bố.
- Đây là **sai lệch định danh phát hành**; không được suy các chức năng mới đã mất hoặc đã có. Không sửa lại/bỏ chữ ký V1, không đổi OTA Production trong việc V2. Cần kiểm chứng bản V1 thực tế trên thiết bị và sửa đường build/release ở việc V1 nếu được giao riêng. Ma trận V2 giữ cả **nhãn phát hành** và **định danh nhúng trong APK** để đối chiếu.
- Bằng chứng REA được giữ riêng tại PC01: `D:\TigerIQ\Evidence\ultracar-v1223-rea690-manifest-20261117.json`, SHA-256 `BA13A8224E6122C96094E0D63502EBC4A9583A3F7C09F7249762F8336CCE8FBA`. Chỉ chia sẻ kết luận dạng siêu dữ liệu, không đưa mã/asset riêng tư vào GitHub.

## 10 chênh lệch KHÔNG ĐƯỢC mất từ các bản V1 mới
Các ca D01–D10 và F được gắn trong `tests/ultracarhcm-v2/v1-build369-regression.json`. Nội dung ca:
- **D01** (F05) — Vạch lùi Vector Canvas, 0.5/1/1.5 m, cong theo đánh lái, đảo chiều, hiệu chuẩn. **Nghiệm thu:** Ghi video V1.2.23 và V2, chứng minh hình vạch động và khoảng cách trên camera UVC thật.
- **D02** (F05) — 3 mẫu vạch Sport Racing, Luxury OEM, Minimalist Modern. **Nghiệm thu:** Chuyển/lưu/khởi động lại từng mẫu, xác minh sự khác biệt hình thực tế.
- **D03** (F04/F06/F10) — Nút camera [R] chạm ngắn bật/tắt, giữ lâu mở cài đặt. **Nghiệm thu:** Không tắt app chính, không tạo cửa sổ/nút nổi trùng.
- **D04** (F04/F10) — Phím điều khiển Bluetooth vô lăng bật/tắt cửa sổ camera. **Nghiệm thu:** Đúng thời gian giữ của V1, thử khi ứng dụng ngoài đang có tiêu điểm.
- **D05** (F05/F07) — Tín hiệu số R mở camera ưu tiên, thoát R đóng đúng điều kiện. **Nghiệm thu:** Đo tín hiệu R thật trên xe đứng yên; USB attached không được đồng nghĩa vào R.
- **D06** (F01/F07/F21) — Mật độ màn hình DeX bên ngoài, không thừa viền trái; tỷ lệ 0.18, half-gap. **Nghiệm thu:** Ảnh cùng DPI ngoài DeX theo V1.2.23; so tọa độ và mật độ thực.
- **D07** (F04/F07/F21) — FloatingQuickBar không che đáy khi cửa sổ con lấy tiêu điểm. **Nghiệm thu:** Đo dock/resize/focus/minimize/maximize 10 lượt với cửa sổ thực.
- **D08** (F08/F10/F16) — 5 nút cấu hình đã lưu, 9 ô ứng dụng, áp dụng bố cục, sao lưu. **Nghiệm thu:** Thử bấm/giữ/cập nhật/xóa/khởi động lại/khôi phục, đúng dữ liệu V1.
- **D09** (F03/F04/F20) — Camera UVC trong một UltraCar, không tạo xung đột chọn app khi cắm USB. **Nghiệm thu:** Kết nối, rút/cắm, quyền USB, không giả preview, không mất frame.
- **D10** (F14/F15/F22) — Phiên bản trong Hồ sơ, kênh OTA và ký riêng V2, V1 không bị ghi đè. **Nghiệm thu:** Xác nhận package/version/SHA/cert, cập nhật đúng kênh TEST, không đổi V1.

## Áp dụng phương pháp REA + Replica chọn lọc
1. **REA:** kiểm tra APK V1.2.23 trong sandbox riêng tư; chỉ thu cấu trúc/hành vi có quyền, không xuất byte mã/asset độc quyền lên GitHub. REA PC01 v6.9.0 `mcp doctor` đã đạt 255/255 công cụ; **thử APK 17/11 bị chặn**: thiếu biến `REA_JADX_MCP_JAR` trỏ đến `jadx-headless-mcp 0.7.1`. Không sửa DACL/quyền để né cổng; dùng nguồn APK/ảnh hợp pháp nếu bộ phân tích chưa sẵn sàng.
2. **Replica (không cài cả pack):** kiểm kê màn/luồng, kiến trúc, bộ thành phần, phát triển từng luồng thật, kiểm thử lỗi trước khi sửa, đối chiếu ảnh và hành vi. Không lấy điểm `parity.py` làm bằng chứng camera/R/BT.
3. **TDD:** mỗi lỗi có ID + APK SHA + video/log tái hiện; tạo ca đỏ trước, sửa tối thiểu, kiểm tra xanh và hồi quy. Không tự đánh dấu PASS dựa vào chuỗi trong mã.
4. **An toàn:** ký V2 bằng quyền/cơ chế của V2; không lấy chứng chỉ V1 hoặc bí mật Windows để vượt khóa; tài khoản local PC01 có cổng DPAPI riêng. Không sửa Production, V1, dữ liệu và các app khác.

## 11 cổng thực thi
| Cổng | Việc | Biên nhận cần |
|---|---|---|
| G0 | Khóa V1.2.23 và SHA | **Đã kiểm hash PC01, phần tác vụ này đạt** |
| G1 | REA 6.9 phân tích APK | REA doctor đạt; phân tích APK **chặn thiếu JAR** |
| G2 | Quét V1 thật từng màn/nút/BT/DeX | Danh mục ảnh/video và trạng thái |
| G3 | Ma trận F01–F22/D01–D10 | Expected/actual/test/evidence riêng |
| G4 | Phân tích chênh lệch mã V2 | Danh sách thiếu và phụ thuộc |
| G5 | Hoàn thiện Kotlin | Mỗi luồng chức năng hoạt động thật |
| G6 | Android CI/lint/unit/instrumentation | Đúng commit, không chỉ thử web |
| G7 | Ký APK V2 TEST | Cần DPAPI cục bộ và chứng chỉ đúng |
| G8 | R08 trên S10/Z Fold 2 | APK mới ký, logcat, video F/D |
| G9 | R09 DeX ngoài/UVC/BT/số R | Test thiết bị/xe đứng yên, lặp 50 lần |
| G10 | Nghiệm thu, bàn giao | Không còn lỗi mức nghiêm trọng, Owner chấp nhận |

**Thứ tự:** phân tích trước; không vá từng chức năng ngẫu nhiên. Ưu tiên UVC/R/vạch → DeX/BT → layout/persistence → dữ liệu → giao diện. Các bước độc lập được làm song song nhưng một nguồn/một người ghi.

## Điểm chặn hiện hành và tiếp tục
- Bản unsigned V2 dev.11 đã có trên PC01, **chưa ký**; hồ sơ [#5135](https://github.com/newsdayads/tigeriq-ai-lab/issues/5135) ghi cổng DPAPI cần đăng ký tương tác chính chủ, không gửi bí mật vào chat.
- Cần DeX ngoài, camera UVC, phím BT và tín hiệu R thật; không tự nhận các thử nghiệm mô phỏng là đạt.
- F18 backend hợp pháp, tài sản hình/âm/clip V1 chưa xác minh đầy đủ. Nếu không có quyền: để CHỜ, tạo tài nguyên riêng, không sao chép công khai.
- Source-only PR này **không đồng nghĩa APK đã được cập nhật**. V2 DONE chỉ khi mọi ca F/D đã nghiệm thu trên bản APK được ghim rõ bằng chứng.

**Nguồn:** [V1 #5129](https://github.com/newsdayads/tigeriq-ai-lab/issues/5129), [V2 #5135](https://github.com/newsdayads/tigeriq-ai-lab/issues/5135), [REA #4780](https://github.com/newsdayads/tigeriq-ai-lab/issues/4780), [Replica](https://github.com/Jakeschincariol/replica-skill).
