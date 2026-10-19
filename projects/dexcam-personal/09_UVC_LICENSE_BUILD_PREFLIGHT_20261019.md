# DeXCam Personal — kiểm toán nguồn UVC/JNI và cổng chọn thư viện (19/10/2026)

**Work Order:** https://github.com/newsdayads/tigeriq-ai-lab/issues/4625  
**RESOURCE_SCOPE:** `DEXCAM_PERSONAL_GH4625_SOURCE_AND_BUILD`  
**Loại bằng chứng:** rà **nguồn công khai, chỉ đọc**, độc lập với P01/REA APK riêng và G1/G2/thiết bị.  
**Phạm vi:** nghiên cứu ứng viên thư viện và giấy phép; **không chọn thư viện, không đưa dependency vào app, không khởi tạo D01, không chạy APK, không nghiệm thu thiết bị.**

## 1. Chốt nguồn khảo sát có thể tái kiểm

Ứng viên `saki4510t/UVCCamera` tại commit `c9399e63dfab4b6d260d8cbef92182abc6de0ee0`. Các file bên dưới được đọc trực tiếp từ GitHub bằng `ref` **đúng commit**, blob SHA của từng file đã được đối chiếu với nhánh `master` tại lần khảo sát; repo khác hoặc nhánh mới cần thẩm định lại. Đây **không phải** pin gói thực thi/AAR/NDK hay một bản release được chọn.

| Bằng chứng tại commit cố định | Blob SHA Git | Điều xác nhận và giới hạn |
| --- | --- | --- |
| [README.md](https://github.com/saki4510t/UVCCamera/blob/c9399e63dfab4b6d260d8cbef92182abc6de0ee0/README.md) | `a6bdc99dd33a653f87a1db349abc2e1111fc5904` | Mã dự án tự công bố Apache-2.0, **ngoại trừ** các thư mục JNI thuộc giấy phép riêng |
| [libuvccamera/build.gradle](https://github.com/saki4510t/UVCCamera/blob/c9399e63dfab4b6d260d8cbef92182abc6de0ee0/libuvccamera/build.gradle) | `6025fe8c2afddb8ce093ae36e3cc863013db5ec0` | Android library, `ndkBuild` qua `ndk.dir`; support library và `com.serenegiant:common` có version từ root |
| [build.gradle](https://github.com/saki4510t/UVCCamera/blob/c9399e63dfab4b6d260d8cbef92182abc6de0ee0/build.gradle) | `3287a8720b58750e30c1068ad4985f85ddd18d04` | Android Gradle Plugin **3.1.4**, compile/target SDK **27**, build-tools **27.0.3**, support-v4 **27.1.1**, common **2.12.4**; `jcenter()`; URL Maven **HTTP** không xác thực |
| [gradle/wrapper/gradle-wrapper.properties](https://github.com/saki4510t/UVCCamera/blob/c9399e63dfab4b6d260d8cbef92182abc6de0ee0/gradle/wrapper/gradle-wrapper.properties) | `17daf5c3493a5042ff402e423de894531b5e103e` | Wrapper **Gradle 4.4** |
| [jni/Application.mk](https://github.com/saki4510t/UVCCamera/blob/c9399e63dfab4b6d260d8cbef92182abc6de0ee0/libuvccamera/src/main/jni/Application.mk) | `c6f7c2e1bf5d92d7a2528873c72ade1aba1001fc` | `APP_PLATFORM := android-14`, `APP_ABI := armeabi armeabi-v7a x86 mips`; **không liệt kê arm64-v8a** |
| [jni/Android.mk](https://github.com/saki4510t/UVCCamera/blob/c9399e63dfab4b6d260d8cbef92182abc6de0ee0/libuvccamera/src/main/jni/Android.mk) | `eb8ddeec091f52713f26a5454b88a8f841651c1b` | Bao gồm build libjpeg-turbo-1.5.0, libusb và libuvc; cần rà tất cả thư viện được liên kết |

## 2. Ma trận giấy phép — bản *vendored* đúng nguồn, không gộp toàn bộ thành Apache

| Thành phần | Bằng chứng cố định | Nhận định có phạm vi |
| --- | --- | --- |
| UVCCamera app/library wrapper | [README](https://github.com/saki4510t/UVCCamera/blob/c9399e63dfab4b6d260d8cbef92182abc6de0ee0/README.md), [library Gradle](https://github.com/saki4510t/UVCCamera/blob/c9399e63dfab4b6d260d8cbef92182abc6de0ee0/libuvccamera/build.gradle) | Công bố **Apache-2.0** cho mã dự án ngoài các thư mục JNI có giấy phép khác. Chưa chứng minh giấy phép của từng binary phân phối |
| Vendored **libusb** | [jni/libusb/COPYING](https://github.com/saki4510t/UVCCamera/blob/c9399e63dfab4b6d260d8cbef92182abc6de0ee0/libuvccamera/src/main/jni/libusb/COPYING), blob `5ab7695ab8cabe0c5c8a814bb0ab1e8066578fbb`; [jni/libusb Android.mk](https://github.com/saki4510t/UVCCamera/blob/c9399e63dfab4b6d260d8cbef92182abc6de0ee0/libuvccamera/src/main/jni/libusb/android/jni/Android.mk), blob `4952e87fd22e7574200d6c0c9343a27e08d86b99` | **LGPL-2.1 hoặc bản mới hơn** được ghi rõ ở file makefile. Khi đóng gói/link JNI phải phân tích nghĩa vụ thông báo, nguồn tương ứng, quyền thay thế/relink theo cách link thực tế; chưa duyệt phát hành |
| Vendored **libuvc** | [jni/libuvc Android.mk](https://github.com/saki4510t/UVCCamera/blob/c9399e63dfab4b6d260d8cbef92182abc6de0ee0/libuvccamera/src/main/jni/libuvc/android/jni/Android.mk), blob `c7adc634199f1d075ca3b1cb4aed306efa9c321a`; [upstream libuvc LICENSE.txt](https://github.com/libuvc/libuvc/blob/master/LICENSE.txt) | File build vendored ghi **BSD 3 điều khoản**, đồng nhất ý chính với upstream; **chưa kiểm hết từng file vendored hay định danh phiên bản**. Phải giữ thông báo bản quyền/điều kiện phân phối |
| Vendored **libjpeg-turbo 1.5.0** | [LICENSE.md](https://github.com/saki4510t/UVCCamera/blob/c9399e63dfab4b6d260d8cbef92182abc6de0ee0/libuvccamera/src/main/jni/libjpeg-turbo-1.5.0/LICENSE.md), blob `4623e29425071a1151dc4b004d5a241ea93efaba`; [README.ijg](https://github.com/saki4510t/UVCCamera/blob/c9399e63dfab4b6d260d8cbef92182abc6de0ee0/libuvccamera/src/main/jni/libjpeg-turbo-1.5.0/README.ijg) | **IJG + BSD 3 điều khoản + zlib** theo thành phần; cần giữ ghi nhận tác giả/điều kiện riêng khi dùng hoặc phân phối bản JNI |
| `com.serenegiant:common` và các phụ thuộc Maven | [libuvccamera/build.gradle](https://github.com/saki4510t/UVCCamera/blob/c9399e63dfab4b6d260d8cbef92182abc6de0ee0/libuvccamera/build.gradle) + [build.gradle](https://github.com/saki4510t/UVCCamera/blob/c9399e63dfab4b6d260d8cbef92182abc6de0ee0/build.gradle) | Chỉ chứng minh **tọa độ/phiên bản được khai báo**, **CHƯA** xác minh bytes/artifact SHA, SRI/signature, giấy phép gói và phụ thuộc bắc cầu; không chấp nhận tải/build mù |

**Lưu ý pháp lý:** Đây là sổ bằng chứng kỹ thuật, không phải tư vấn pháp lý hoặc kết luận một APK đóng gói đã tuân thủ mọi nghĩa vụ giấy phép.

## 3. Cổng bảo mật/khả năng dựng

- **KHÔNG lấy build cũ chạy nguyên trạng**: tọa độ plugin/toolchain cũ và `jcenter()` cần xác minh lại tương thích, nguồn truy xuất và chuỗi cung ứng trước khi xây môi trường mới.
- **KHÔNG truy cập/tải phụ thuộc từ repository HTTP** được khai báo trong root `build.gradle`; tuyệt đối không âm thầm chuyển sang dịch vụ/trang khác hoặc đổi chính sách bảo mật để cho build qua.
- **KHÔNG suy từ `APP_ABI` sang tương thích điện thoại thật**: tập ABI cũ không nêu `arm64-v8a`, chưa có kiểm thử ứng dụng 64-bit trên Z Fold 2, Android/One UI/DeX hiện hành hoặc camera cụ thể.
- **KHÔNG ghép code/soạn APK từ UltraCar v240**; chỉ dùng yêu cầu chức năng do Owner cung cấp và API công khai theo Work Order.
- Không dùng RDC/PC01 shell/Codex, không cấp quyền USB/camera, không lấy credential, không cài APK và không thay App Chrome.

## 4. Quyết định hiện tại và đầu vào còn thiếu

**KẾT LUẬN = CANDIDATE_ONLY / CHƯA CHỌN LIBRARY.** Mốc `D01`, `C01`, `P01`, `G1/G2` và kiểm thử xe **không có nghiệm thu mới**. Work Order còn `13/30` mốc nguồn đã được xác minh từ trước; **không tăng tử số** vì có tài liệu này.

Để chọn bất kỳ phiên bản UVC dùng thực tế phải có thêm:

1. Bằng chứng thiết bị/đường R/USB/camera UVC thật và kết luận G1/G2 của Owner; **không lấy tài liệu mã nguồn thay phép đo**.
2. Phiên bản/commit/tag chính xác của từng dependency *vendored*, manifest đầy đủ, giấy phép, SBOM/binary provenance và phương án đáp ứng LGPL/JPEG; chọn đường thay thế nếu không kiểm toán được.
3. Quyết định repository mã nguồn độc lập và quyền ghi, phương án Android toolchain/ABI được thử ngoại tuyến, nguồn Gradle được tin cậy và cổng môi trường build an toàn.
4. Khi hợp lệ: branch/PR đúng scope → CI đúng head → kiểm tra main; sau đó mới tính mốc D01 **nếu thực sự có source Kotlin/Gradle và bản dựng được nghiệm thu**. Không dùng GitHub CI tài liệu để giả có APK.

**Điểm tiếp tục hợp lệ ngay:** thẩm định phần giấy phép hoặc bảo đảm nguồn thư viện khác ở chế độ chỉ đọc; chỉ mở giai đoạn build sau khi có đủ cổng độc lập nêu trên.  
**DRIVE_SYNC:** `NOT_REQUIRED` — không sửa Loader hoặc Bootstrap.
