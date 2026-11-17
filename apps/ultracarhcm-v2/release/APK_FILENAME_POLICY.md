# Quy tắc tên APK UltraCarHCM V2 — Owner chốt 17/11/2026

Công việc duy nhất: [GH-5135](https://github.com/newsdayads/tigeriq-ai-lab/issues/5135). Áp dụng cho **tên tệp APK người dùng tải trên Google Drive**, không ghi đè bản V1 hoặc thay chứng chỉ Android.

- Tên DUY NHẤT: `UltraCarHCM-V2.MM.NN.apk` với `MM` và `NN` là đúng hai chữ số từ `00` đến `99`.
- **Bản đầu tiên:** `UltraCarHCM-V2.00.00.apk` (đã đổi tên trên Google Drive, vẫn giữ nội dung APK ký ban đầu).
- **Bản tiếp theo:** `UltraCarHCM-V2.00.01.apk`, `UltraCarHCM-V2.00.02.apk`, …, `UltraCarHCM-V2.00.99.apk`, `UltraCarHCM-V2.01.00.apk`, …, `UltraCarHCM-V2.99.99.apk`.
- Chọn số chưa dùng kế tiếp trên **thư mục chuẩn Drive V2**, không dùng lại số và **không ghi đè**. Khi đã tới `99.99`, dừng, không tự quấn về `00.00`. Tiện ích: `release/v2-apk-filename.mjs`.
- **CẤM** hậu tố như `_dev11`, `_MAIN_`, `_SIGNED_TEST`, SHA, thời gian, `-backup`, `(1)`, hoặc các nội dung không thuộc cấu trúc trên **tên APK tải về**.
- **Chỉ APK** nằm ở [Google Drive UltraCarHCM_V2_TEST](https://drive.google.com/drive/folders/1XJpW-nLOwbQwht-68Ip7hyNuiRSsNRT6). JSON biên nhận (source SHA, signed APK SHA-256, chứng chỉ, Android versionCode/versionName) lưu ở [UltraCarHCM_V2_Evidence](https://drive.google.com/drive/folders/1bYQruqvYFQlS-4BBDDaaWvxhG6bbWBCg), **không để cạnh APK làm người dùng nhầm là hai bản cài**.
- Quy tắc tên tệp không thay đổi `applicationId`, Android `versionName`/`versionCode`, byte APK, hoặc chữ ký; phải xác minh ký và SHA trước khi đưa Drive. Không quảng cáo đã cập nhật phiên bản bên trong khi chỉ đổi tên tệp.
- Mỗi lần xuất bản: liệt kê các tệp APK hiện có trên Drive thật, dùng tiện ích tính tên, kiểm lại tên chưa tồn tại, tải APK ký đã xác minh, đọc lại Google Drive API, ghi link và checksum vào Issue #5135. Không tự xưng hoàn tất chức năng V2 khi chưa nghiệm thu thiết bị.
