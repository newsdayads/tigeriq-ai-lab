# 05 — Kế hoạch kiểm thử, nghiệm thu và bằng chứng

## 1. Nguyên tắc
Không đánh đồng **có mã nguồn** với **chạy được**, **mở thủ công** với **tự mở**, **USB thấy thiết bị** với **có hình sống**. Mọi chỉ tiêu chưa đo là mục tiêu đề xuất, không phải kết quả.

## 2. Giai đoạn kiểm chứng
1. **G0 — Hồ sơ:** yêu cầu, phạm vi, bảng rủi ro và chốt dữ liệu cần đo; **chưa cho phép code**.
2. **G1 — Thiết bị:** lập bộ hồ sơ camera/hub/Android/DeX thực tế, có chứng cứ USB và mốc R.
3. **G2 — Khả thi:** xác minh UVC stream, quyền USB, cửa sổ DeX và hướng hiển thị phù hợp.
4. **G3 — Chức năng:** cam kết P0 FR-001..FR-012 có testcase tối thiểu.
5. **G4 — Tin cậy:** kiểm tra chu kỳ R, mất USB/preview, chuyển app, khởi động lại.
6. **G5 — Nghiệm thu của Owner:** thử thật trên xe dừng ở điều kiện an toàn, ký nhận; **không có nghiệm thu ngầm**.

## 3. Ma trận kiểm thử camera
| ID | Thử nghiệm | Điều kiện đầu | Bằng chứng cần |
|---|---|---|---|
| CAM-01 | USB attach lúc app đang foreground | App mở, R off→on | descriptor, log attach, stream, UI |
| CAM-02 | USB attach khi app chạy nền | DeX đang hiển thị app khác | log + hình camera có nổi không |
| CAM-03 | 5 lần R thử ban đầu | Dừng xe, lặp R/D | bảng từng lần, không chỉ số trung bình |
| CAM-04 | 50 lần R nghiệm thu | Bộ phần cứng chuẩn | 50 lượt riêng biệt; mục tiêu 50/50 |
| CAM-05 | Chuyển R nhanh | R↔D theo quy trình an toàn | không race, không cửa sổ ma |
| CAM-06 | Từ chối quyền USB | permission=deny | trạng thái rõ, không vòng lặp |
| CAM-07 | Rút cắm USB | xe dừng, thiết bị an toàn | reconnect hoặc cảnh báo đúng |
| CAM-08 | USB được nhận nhưng không có frame | tái hiện lỗi | thông báo "không có hình sống" |
| CAM-09 | Frame đứng/lag | mô phỏng nguồn lỗi an toàn | không hiển thị khung cũ như live |
| CAM-10 | Thay đổi chuẩn analog/mode | khi thiết bị cho phép | ghi format và hành vi recovery |
| CAM-11 | App bị kill / Activity tái tạo | Android kill/restart | không phụ thuộc một instance UI |
| CAM-12 | Đổi app khi camera đang mở | app thứ ba | không bỏ lỡ yêu cầu mở |
| CAM-13 | Hết R | camera đang hiển thị | trả bố cục không đóng app |
| CAM-14 | Bấm icon thủ công | tự mở thất bại có log | phân biệt lỗi auto và lỗi stream |
| CAM-15 | Phát hiện màu/nhiễu | điều kiện có sự cố | error + mode + xử lý rõ |
| CAM-16 | PD/hub yếu (chỉ quan sát an toàn) | nguồn hub thay đổi | phân biệt disconnect phần cứng và lỗi app |

## 4. Ma trận kiểm thử cửa sổ
| ID | Bài thử | Tiêu chí |
|---|---|---|
| DEX-01 | Preset 50/50 | Cài đặt lưu và áp được hoặc báo giới hạn |
| DEX-02 | Preset 65/35 | Không chồng/ra ngoài diện tích hợp lệ |
| DEX-03 | Kéo đổi X/Y/W/H | Lưu giá trị và áp dụng nhất quán |
| DEX-04 | App đích bị đóng | Khôi phục đúng hoặc hiển thị lỗi xác thực |
| DEX-05 | Multi-display | Chọn display ID hợp lệ, không mở nhầm |
| DEX-06 | Thay DPI/độ phân giải | Dùng profile phù hợp hoặc fallback |
| DEX-07 | Sau khi camera nổi | Cửa sổ bản đồ không bị kill |
| DEX-08 | Sau khi rời R | Snapshot trước camera được khôi phục |
| DEX-09 | Thiếu quyền resize | Có thông báo "OS không cho phép" |
| DEX-10 | App đích có minWidth | Không retry vô hạn, báo lý do |

## 5. Chỉ số chất lượng định lượng
- **Auto-open rate:** `successful_auto_open / valid_R_events`; R event phải có mốc quan sát hợp lệ; mục tiêu nghiệm thu đề xuất **50/50**.
- **Success by stage:** `USB_seen`, `permission_granted`, `first_live_frame`, `window_visible` đếm theo cùng một `test_id`.
- **Latency P50/P95/P99:** các bước `R→USB`, `USB→first frame`, `frame→UI visible`, `R off→layout restored`. Chưa chốt ngưỡng ms.
- **Recovery rate:** `recovered_automatically / recoverable_faults`; phải phân loại recoverable thật.
- **False positive:** camera hiện khi R=OFF hoặc video không hợp lệ — ghi riêng, không chỉ tính tỷ lệ mở thành công.
- **Task layout accuracy:** độ lệch requested vs applied bounds; tiêu chí chỉ chốt sau thử OS target.
- **Crash/ANR:** không có crash/ANR trong chu kỳ chuẩn; cần log và điều kiện tái hiện.
- **Memory/CPU/battery:** đo trong khi DeX + UVC + các app cùng chạy; chưa có ngưỡng thực tế.

## 6. Mẫu chứng cứ cho từng lượt
```text
CASE_ID:
DEVICE: [model, Android, OneUI, DeX]
USB: [VID, PID, UVC mode]
PROFILE: [display, profile ID, required apps]
R_TRANSITION: [timestamp relative/monotonic]
USB_DETECTED:
PERMISSION_READY:
FIRST_LIVE_FRAME:
CAMERA_WINDOW_SHOWN:
R_OFF:
LAYOUT_RESTORED:
AUTO_OPEN_SUCCESS: YES/NO
MANUAL_FALLBACK_SUCCESS: YES/NO/NOT_TESTED
ERROR_CLASS: USB|PERMISSION|STREAM|PRESENTATION|LAYOUT|UNKNOWN
LOG_POINTER: private evidence location
RESULT: PASS|FAIL|NOT_RUN
NOTES:
```
Bảng chỉ được đánh `PASS` nếu case có bằng chứng đúng phiên bản app và đúng thiết bị.

## 7. Rủi ro an toàn bắt buộc
- Việc kiểm thử R thực hiện khi **xe dừng ở vị trí an toàn**, quy trình chèn bánh/phanh tùy hoàn cảnh; không vừa lái vừa chạm app.
- Trình xem camera không được quảng bá thay thế quan sát gương và môi trường thực tế.
- Khi mất hình, phải cảnh báo riêng và loại bỏ khả năng dùng frame cũ như video sống.
- Không kiểm thử dây điện bằng đấu tắt/xác định tùy tiện; cần người có kỹ năng nếu đo nguồn R/hub.

## 8. Cổng xác minh bản phát hành sau này
- Source/build/sign có thể tái lập; kiểm tra phiên bản và SHA đúng bản thử.
- Test chức năng P0, 50 chu kỳ R, bật/tắt camera, khôi phục bố cục, restart, event permission.
- Bộ thử độc lập nếu có nguồn lực được Owner/Vy giao; nếu không, ghi thiếu kiểm thử, không giả ĐẠT.
- Owner nghiệm thu chức năng xe thật; không tự cài lên máy hoặc phát hành theo chỉ riêng hồ sơ này.

## 9. Tình trạng kiểm thử hiện tại
**0/0 bài thử sản phẩm đã được chạy** — không quy đổi thành 0% hoặc 100%. Hiện chỉ có chứng cứ quan sát mẫu UltraCar và cấu trúc APK, chưa có sản phẩm cá nhân để kiểm thử.
