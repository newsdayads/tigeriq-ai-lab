# DeXCam P01 — Quyết định chẩn đoán REA Windows native DACL (19/10/2026)

WORK_ORDER=GH-4625 | RESOURCE_SCOPE=DEXCAM_PERSONAL_GH4625_SOURCE_AND_BUILD
RECORD_TYPE=SOURCE_ONLY_ROOT_CAUSE_TRIAGE_AND_SAFE_FALLBACK
ACCEPTANCE_SCOPE=DOCUMENTATION_ONLY | P01=BLOCKED | ANDROID_APK_BUILT=false
PRIVATE_ARTIFACTS_IN_GITHUB=FORBIDDEN | DRIVE_SYNC=NOT_REQUIRED

## 1. Sự thật đã xác minh

1. APK UltraCar v240 riêng tư đã được đối chiếu SHA-256 trên PC01; REA `inspect-android-package` thực tế exit 1 trước khi JADX phân tích. Phản hồi: `capability_unavailable`, `provider_id=jadx`, `Private DACL contains unexpected trustees ... (Win32 5)`. Bản sao APK tạm sau lượt thử đã được xóa; Drive gốc không đổi. Biên nhận: https://github.com/newsdayads/tigeriq-ai-lab/issues/4625#issuecomment-6257021547 và https://github.com/newsdayads/tigeriq-ai-lab/issues/4625#issuecomment-6257484696
2. Đã thử TEMP/TMP thuộc vùng SYSTEM/Administrators theo biến môi trường cấp tiến trình, không nới quyền; REA vẫn thất bại cùng chuỗi lỗi. Không chạy lặp lại cùng cấu hình.
3. REA `rea-agents@6.5.0` là bản ghi nhận cài trên PC01. Nguồn `rea-agents-6.5.0` có `verifyPrivate()`: `GetSecurityInfo(... OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION)` rồi `require(acl->AceCount == 2, "Private DACL contains unexpected trustees", ..., ERROR_ACCESS_DENIED)`. Nguồn: https://github.com/morluto/rea/blob/rea-agents-6.5.0/native/windows/src/filesystem.cc
4. REA 6.7.0 phát hành ngày 18/10/2026; cùng điều kiện `AceCount == 2` vẫn còn ở nguồn `rea-agents-6.7.0`. Nguồn: https://github.com/morluto/rea/blob/rea-agents-6.7.0/native/windows/src/filesystem.cc và https://github.com/morluto/rea/releases/tag/rea-agents-6.7.0 . Không suy rằng nâng cấp sẽ chữa lỗi.
5. Nguồn upstream mô tả chính sách: current user và SYSTEM, không mở cho principal khác; đọc bảo mật bằng handle, DACL bảo vệ. https://github.com/morluto/rea/blob/main/native/windows/README.md
6. TigerIQ đã hợp nhất mã phân loại lỗi có 10 bài thử: https://github.com/newsdayads/tigeriq-ai-lab/pull/5025 . Đây là kiểm thử tĩnh, **không** phải biên nhận REA hay nghiệm thu P01.

## 2. Ranh giới nguyên nhân gốc

**Đã xác định tại cấp nguồn:** Nếu module native đang chạy đúng phiên bản nguồn nêu trên, thông báo chính xác `Private DACL contains unexpected trustees` phát ra khi **số ACE thực tế khác 2**. Đây là lỗi do điều kiện xác nhận DACL nội bộ chủ động tạo, mã Win32 5 được dùng làm mã báo lỗi; không tự động chứng minh Windows từ chối thao tác `GetSecurityInfo`.

**Chưa xác minh trên PC01:** SHA/bản dựng native addon đang chạy so với nguồn; số ACE và SID trong security descriptor của đúng `rea-native-probe-*` tại lần lỗi; token/SID/integrity/AppContainer của tiến trình thực sự chạy REA; DACL đang được bảo vệ hay bị biến đổi trên đĩa. Không thể chốt vì sao ACE lệch nếu thiếu các số đo này.

**Giả thuyết cần kiểm chứng:** Khi process SID trùng SYSTEM, REA vẫn dựng hai ACE cùng SID; Windows hoặc mã nền có thể biểu diễn khác dự kiến. Nhưng mã REA cũng có điều kiện `user && system` phía sau; giả thuyết SID trùng **không đủ** để kết luận chính là lỗi `AceCount != 2`. Phải xác minh bằng số ACE đọc lại theo handle cùng phiên.

**Không nhập nhằng lỗi:** `Delete owned object by handle failed` là vấn đề quyền chia sẻ/xóa khác, đã được upstream đóng trong https://github.com/morluto/rea/issues/2196 . Vấn đề này không chứng minh thông báo `Private DACL contains unexpected trustees` được chữa. Vấn đề Android native tự kiểm tra có liên hệ lịch sử: https://github.com/morluto/rea/issues/3111 (nhưng là lỗi delete-by-handle, không phải cùng chuỗi DACL).

## 3. Quy trình thực hiện an toàn — có điều kiện quyền

### D01 — Chẩn đoán *chỉ đọc* trên PC01, KHÔNG chạy lại APK
- Chỉ thực hiện qua kênh PC01 được cấp phép rõ ràng cho **bước chẩn đoán này**. Lệnh `Full Auto` không tự xóa `NO_RDC`/`NO_PC01_SHELL` của Work Order, không hợp thức hóa thay đổi bảo mật. Đối chiếu quyền nguồn động, kênh và một người ghi trước khi gọi thiết bị.
- Thu metadata tối thiểu từ tiến trình thực sự gọi REA: phiên bản REA/Node, kiến trúc, token SID, IsAppContainer, restricted SID count, integrity và đường dẫn native addon **đã che đường dẫn riêng tư**.
- Đối chiếu hash/manifest native addon với gói phát hành chính xác phiên bản, không dùng tarball `latest` để kết luận về cài đặt hiện tại.
- Chỉ khi có cơ chế chẩn đoán đọc bằng handle đúng object mới thu `AceCount`, SID/kiểu/mask/flags của từng ACE, owner, `SE_DACL_PROTECTED`. Không suy ACE từ ACL của thư mục cha hoặc ACL sau khi probe đã bị xóa.
- Nhật ký ra GitHub chỉ chứa kết quả rút gọn đã che dữ liệu, không chứa file APK, DEX, đường dẫn riêng tư, SID đầy đủ, khóa/credential hoặc dữ liệu độc quyền.
- Nếu không có số đo trực tiếp, ghi `ROOT_CAUSE_HOST=UNVERIFIED`; không thử cùng cấu hình, không tăng checklist.

### D02 — Đường sửa REA (ưu tiên lâu dài)
- Chuẩn bị báo cáo lỗi tách biệt đúng chữ ký DACL cho tác giả REA với bản tái hiện nguồn mở không tiết lộ máy riêng tư.
- Chỉ đánh giá bản vá chính thức hoặc mã sửa có bảo toàn thuộc tính protected DACL/owner/least privilege, có chứng cứ Windows native thật và hash phiên bản.
- Không tự xóa `AceCount` guard, bỏ qua kiểm tra native, bật Everyone/Authenticated Users, sửa ACL hệ thống, copy binary khác phiên bản, chạy elevated để lách lỗi.
- Cài/đổi bản REA trên PC01 là một thao tác máy chủ riêng cần cổng quyền thực hiện/khôi phục và biên nhận, không tự có bởi tài liệu này.

### D03 — Tiếp tục mục tiêu DeXCam độc lập (đường dự phòng)
- Để không giữ dự án phụ thuộc REA, chuẩn bị phân tích `Android SDK apkanalyzer` + `jadx` độc lập trong sandbox riêng tư với APK đã đối chiếu SHA, công cụ đã được thẩm định và phạm vi chỉ đọc.
- Bắt đầu từ APK mẫu công khai có SHA cố định để xác minh bộ công cụ; chỉ tiếp nhận APK UltraCar riêng tư qua kênh cấp quyền với lưu trữ được bảo vệ. Không sao chép mã độc quyền, không can thiệp bảo vệ, không tải APK riêng tư lên CI/GitHub.
- Thu manifest, permission USB, exported activities/services, tương tác USB Host/UVC, đối chiếu FR/NFR; mọi kết luận hành vi thiết bị giữ `UNVERIFIED` khi chỉ có phân tích tĩnh.
- Phương án này không được tự chuyển `P01 REA` sang ĐẠT: muốn thay tiêu chí cần một thay đổi acceptance minh bạch do Owner duyệt.

## 4. Điều kiện nghiệm thu

- `P01_REA=PASS` chỉ khi REA có kết quả thực đọc APK chính chủ đúng SHA trên PC01, không lỗi native và có biên nhận phân tích đúng phạm vi; nếu thay công cụ phải có thay đổi yêu cầu nghiệm thu được duyệt và ghi bằng chứng.
- `C01/G1/G2` cần chứng cứ USB/UVC và tín hiệu R thiết bị thật; việc phân tích tĩnh không thay thế thử nghiệm an toàn trên xe đứng yên với quyền riêng.
- `D01 Kotlin/Gradle/APK` chỉ chuyển trạng thái sau khi qua các cổng phần mềm/thiết bị và có mã + bản dựng được kiểm thử thực tế.
- Không được sửa `STRUCTURED_PROGRESS_CHECKLIST` hoặc tăng `13/30` bởi riêng tài liệu, PR, CI hay biên nhận chỉ đọc.

## 5. Quyết định

- **Vấn đề:** REA Windows native DACL check chặn `inspect-android-package` trước JADX; nguyên nhân sai lệch ACE trên PC01 chưa được đo.
- **Giải pháp:** Một lượt xác minh DACL/SID và nguồn binary bằng kênh được phép; song song đường phân tích tĩnh Android độc lập có rào chắn dữ liệu riêng tư.
- **Hành động:** Chỉ xuất bản bản ghi nguồn qua branch → PR → exact-head checks → merge → main readback. Các thao tác PC01/cài đặt/camera không nằm trong phạm vi nghiệm thu nguồn này.
