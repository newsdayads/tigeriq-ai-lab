# TigerIQ Phone Farm • bản thử nghiệm nội bộ

Mã nguồn độc lập do TigerIQ xây dựng từ API/ADB công khai. Không sử dụng, vá, hoặc xóa thành phần LAIXI.

## Điều kiện

- Windows PC01: Node.js >= 20.
- Android SDK Platform Tools: \`D:\TigerIQ\Tools\platform-tools\adb.exe\`.
- scrcpy (tùy chọn): \`D:\TigerIQ\Tools\scrcpy\scrcpy.exe\`.
- Điện thoại do chủ sở hữu kiểm soát, đã cho phép USB debugging.

## Chạy thử

Trong thư mục này: \`node --test test.mjs\`, sau đó \`node app.mjs\`.
Trên **chính PC01**, truy cập \`http://127.0.0.1:8765/\`.

Ứng dụng chỉ lắng nghe 127.0.0.1, không có kết nối tới máy chủ bản quyền, không yêu cầu tài khoản hoặc phí duy trì. Có thể dùng khi Internet ngắt, miễn kết nối ADB đang hoạt động. Nếu thay vị trí ADB/scrcpy, chỉnh biến môi trường \`TIGERIQ_ADB\`, \`TIGERIQ_SCRCPY\`.

## Chức năng bản đầu

- Danh sách nhiều thiết bị ADB, tình trạng, model, tìm kiếm, chọn tất cả, đặt tên cục bộ.
- Ảnh PNG theo yêu cầu, chạm/vuốt, phím cơ bản, nhập liệu ASCII.
- Đồng bộ thao tác theo tỷ lệ màn hình, gửi phím/văn bản cho nhóm.
- Mở phiên scrcpy riêng trong Desktop Windows nếu có sẵn scrcpy.
- Giới hạn thiết bị do phần cứng ADB/USB và hiệu năng, không do giấy phép.

## Giới hạn cần nghiệm thu thêm

Chưa có: truyền tệp/APK hàng loạt, quản lý app nâng cao, kịch bản theo lịch/Auto.js, quay phim, điều khiển tập trung nhiều PC, giao diện video liên tục trong lưới, đóng gói EXE, nghiệm thu 20–100 máy. Không được coi phiên bản này là ngang 100% chức năng LAIXI.

## An toàn / quyền

- Mọi thao tác ADB bắt buộc chọn thiết bị đang kết nối, chỉ cho phép danh sách lệnh cố định. Không có đầu vào dòng lệnh ADB tùy ý, không có kết nối ra Internet.
- Chỉ người đang dùng PC01 được truy cập dịch vụ. Không mở cổng LAN, không cấu hình tường lửa.
- Không vô hiệu bảo vệ hệ điều hành, không vượt quyền ứng dụng hoặc bản quyền.
- Chạy kiểm thử trước khi dùng trên điện thoại có dữ liệu quan trọng.
- Để dừng: kết thúc tiến trình \`node app.mjs\`. Để gỡ: dừng ứng dụng rồi xóa thư mục bản thử nghiệm. Không sửa dữ liệu LAIXI.

Nguồn chức năng tham khảo: https://docs.laixi.app/en/docs/product/主要功能介绍/ .
