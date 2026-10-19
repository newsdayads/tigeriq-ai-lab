# DeXCam Personal — cổng tương thích thư viện native với trang 16 KB (19/10/2026)

**Work Order:** https://github.com/newsdayads/tigeriq-ai-lab/issues/4625  
**RESOURCE_SCOPE:** `DEXCAM_PERSONAL_GH4625_SOURCE_AND_BUILD`  
**Loại bằng chứng:** nghiên cứu kỹ thuật chỉ đọc, độc lập P01/REA, USB/R thiết bị thật và G1/G2.  
**Trạng thái:** SOURCE_RESEARCH_ONLY | D01_NOT_STARTED | NATIVE_ARTIFACT_NOT_VERIFIED | NO_APK | NO_DEVICE_TEST.

## 1. Nguồn chuẩn và trường hợp áp dụng

- **Nguồn Android Developers:** [Support 16 KB page sizes](https://developer.android.com/guide/practices/page-sizes). AOSP từ Android 15 hỗ trợ thiết bị có trang bộ nhớ 16 KB; ứng dụng dùng thư viện NDK trực tiếp hoặc gián tiếp phải thẩm định và dựng đúng tương thích. Phải kiểm tra **ELF alignment** của từng thư viện `.so`, **ZIP alignment** khi đóng gói thư viện native không nén, và hành vi lúc chạy.
- Quy tắc tương thích Google Play cho ứng dụng nhắm Android 15/API 35+ trên thiết bị 64-bit **không tự động biến thành điều kiện phát hành Play của ứng dụng cá nhân sideload DeXCam**. Tuy nhiên khả năng chạy trên thiết bị 16 KB vẫn là rủi ro kỹ thuật phải kiểm chứng nếu bản dựng có native code.
- **Nguồn ứng viên đã khóa revision:** [kiểm toán UVC/JNI DeXCam](09_UVC_LICENSE_BUILD_PREFLIGHT_20261019.md); [UVCCamera / Application.mk cố định](https://github.com/saki4510t/UVCCamera/blob/c9399e63dfab4b6d260d8cbef92182abc6de0ee0/libuvccamera/src/main/jni/Application.mk); [root build.gradle cố định](https://github.com/saki4510t/UVCCamera/blob/c9399e63dfab4b6d260d8cbef92182abc6de0ee0/build.gradle).
- Tại revision khảo sát, `APP_ABI=armeabi armeabi-v7a x86 mips`, thiếu `arm64-v8a`; Android Gradle Plugin 3.1.4 và Gradle 4.4. Đây là **rủi ro khả năng dựng/tương thích**, chưa phải phép đo ELF hay bằng chứng ứng dụng chạy hoặc không chạy trên Samsung Z Fold 2.

## 2. Ma trận tiền kiểm D01 — chưa chạy

| Cổng | Phải chứng minh khi có quyền dựng | Hiện trạng |
| --- | --- | --- |
| N16-01 — Dependency provenance | Chốt artifact/version/hash, toàn bộ JNI `.so`, giấy phép và phụ thuộc bắc cầu; không tự tin tưởng nguồn HTTP/JCenter lịch sử | CHƯA XÁC MINH |
| N16-02 — ABI | Có thư viện đúng ABI mục tiêu (đặc biệt `arm64-v8a` nếu chọn hướng 64-bit); đối chiếu ABI thực của thiết bị mục tiêu | CHƯA XÁC MINH |
| N16-03 — Công cụ | Phương án build được thẩm định, ưu tiên Android Gradle Plugin **8.5.1+**, NDK **r28+**, và native dependency tương thích 16 KB; không âm thầm nâng plugin trong dự án cũ | CHƯA THỰC HIỆN |
| N16-04 — ELF | Dùng APK Analyzer hoặc `llvm-readelf` kiểm `PT_LOAD` alignment từng `.so`; không đánh đồng khai báo ABI/NDK với bytes binary đạt chuẩn | CHƯA CÓ BINARY |
| N16-05 — APK/AAB ZIP | Kiểm ZIP alignment cho thư viện không nén; xem `bundletool dump config` (`PAGE_ALIGNMENT_16K`) khi có AAB và kiểm APK cuối cùng; không lấy cấu hình Gradle thay kiểm chứng gói | CHƯA CÓ GÓI |
| N16-06 — Runtime | Chạy trên emulator 16 KB **được cấp phép/cô lập** và sau đó thiết bị đích đúng quyền; theo dõi load native library, luồng USB/UVC, vòng đời, frame thật, hồi quy | CHƯA ĐƯỢC CẤP PHÉP / CHƯA CHẠY |
| N16-07 — Mã phụ thuộc kích thước trang | Nếu có mã native, rà chỗ giả định `PAGE_SIZE=4096`, thao tác `mmap` và cấp phát bộ nhớ theo hướng dẫn Android | CHƯA KIỂM |

**Lưu ý:** NDK r28+ và AGP 8.5.1+ là hướng build được Android Developers khuyến nghị; **không** thay được việc kiểm bytes `.so` của bên thứ ba và chạy thử trên môi trường 16 KB.

## 3. Kết luận và điều kiện đánh thức

**QUYẾT ĐỊNH=HOLD_N16_NATIVE_ARTIFACT_SELECTION.** Chưa chọn `saki4510t/UVCCamera` làm dependency thực thi; chưa có ABI/binary/SBOM/ELF/ZIP/runtime evidence. Không chạy Gradle, không tải/cài thư viện, không chạm PC01, APK UltraCar riêng tư, App Chrome hoặc xe.

Chỉ sau khi **G1/G2, C01 và quyền repository/build/thiết bị** được xác minh theo [roadmap](06_BACKLOG_AND_ROADMAP.md) mới bắt đầu D01 và kiểm các cổng tương ứng. Phân tích nguồn này là một bằng chứng kỹ thuật bổ sung, **không phải** mốc nghiệm thu mới: Work Order giữ **13/30**, `P01=BLOCKED`, `D01=NOT_STARTED`, `DONE=false`.

**DRIVE_SYNC=NOT_REQUIRED** — không sửa Loader/Bootstrap.  
