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
| CAM-13 | Hết R có bằng chứng đáng tin cậy | camera đang hiển thị; nguồn R_OFF đã kiểm chứng | trả bố cục không đóng app, ghi nguồn xác nhận R_OFF |
| CAM-17 | Camera mất hình nhưng R vẫn ON | video/USB mất trong R được xác nhận | cảnh báo `CAMERA_UNAVAILABLE`, không hiện khung cũ, không tự suy ra rời R |
| CAM-18 | Camera mất hình khi R không xác định | nguồn R_OFF không đủ tin cậy | ghi `reverse_state=UNKNOWN`, cảnh báo thay vì tự khôi phục bố cục; chỉ đóng theo thao tác có chủ ý |
| CAM-14 | Bấm icon thủ công | tự mở thất bại có log | phân biệt lỗi auto và lỗi stream |
| CAM-15 | Phát hiện màu/nhiễu | điều kiện có sự cố | error + mode + xử lý rõ |
| CAM-16 | PD/hub yếu (chỉ quan sát an toàn) | nguồn hub thay đổi | phân biệt disconnect phần cứng và lỗi app |
| CAM-19 | Nhật ký một lượt R có thể truy vết | 5 lượt R quan sát an toàn, gồm thành công/thất bại nếu phát sinh tự nhiên | 5 `cycle_id` riêng, cùng nguồn đồng hồ, đủ mốc USB/quyền/frame/cửa sổ và trạng thái R kèm bằng chứng; không dùng dữ liệu riêng tư công khai |

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
| DEX-11 | Lưu cấu hình qua khởi động lạnh | Tạo preset, lưu, thoát hẳn ứng dụng rồi mở lại; đối chiếu dữ liệu cục bộ và bounds khi DeX cho phép; không dùng lần quay về Activity làm bằng chứng khởi động lạnh |

## 4A. Truy vết yêu cầu chức năng ưu tiên P0 → ca kiểm thử

Bảng liên kết **thiết kế kiểm thử**, không phải biên nhận đã chạy. Không đánh dấu một yêu cầu đạt chỉ vì có ca kiểm thử hoặc vì camera bật thủ công.

| Yêu cầu | Điều cần xác nhận | Ca kiểm thử tối thiểu |
|---|---|---|
| FR-001 | Phát hiện đúng thiết bị/mode USB | CAM-01, CAM-02, CAM-07 |
| FR-002 | Cấp/từ chối quyền USB và tái kết nối | CAM-06, CAM-07 |
| FR-003 | Kích hoạt tự động theo R thật | CAM-03, CAM-04, CAM-05 |
| FR-004 | Camera nổi trong bối cảnh ứng dụng khác | CAM-02, CAM-12 |
| FR-005 | Trả bố cục **chỉ khi đã xác nhận kết thúc R** | CAM-13, CAM-18, DEX-08 |
| FR-006 | Có hình sống; mất hình phải cảnh báo | CAM-08, CAM-09, CAM-17 |
| FR-007 | Phục hồi có giới hạn khi mất luồng/USB | CAM-07, CAM-09, CAM-11 |
| FR-008 | Preset, ứng dụng đích và giới hạn OS | DEX-01, DEX-02, DEX-04 |
| FR-009 | X/Y/W/H, DPI và kích thước tối thiểu | DEX-03, DEX-06, DEX-10 |
| FR-010 | Cấu hình cục bộ tồn tại qua khởi động lạnh | DEX-11 |
| FR-011 | Nhật ký R/USB/frame/cửa sổ cùng một lượt | CAM-19 |
| FR-012 | Nút mở thủ công khi đường tự động lỗi | CAM-14 |

Cổng G3 chỉ đủ bằng chứng khi **từng yêu cầu** có kết quả thực tế đúng thiết bị, phiên bản và nhật ký riêng. CAM-19 thuộc khảo sát ban đầu khi chưa có ứng dụng mới chỉ là **đánh giá dữ liệu thu thập**, không chứng minh FR-011 đã được lập trình. Thử nghiệm USB/DeX/xe thật chỉ khi được cho phép và thực hiện lúc xe đứng yên an toàn.

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
CYCLE_ID: [one unique ID per R transition]
DEVICE: [model, Android, OneUI, DeX]
USB: [VID, PID, UVC mode]
PROFILE: [display, profile ID, required apps]
CLOCK_SOURCE: [monotonic clock; same origin for all latency timestamps]
REVERSE_STATE: ON|OFF|UNKNOWN
REVERSE_STATE_EVIDENCE: [independent observed source; never infer OFF from video loss]
R_ON: [timestamp or NOT_MEASURED]
USB_PRESENT_BEFORE_R: YES|NO|NOT_MEASURED
USB_PRESENT_DURING_R: YES|NO|NOT_MEASURED
USB_DETECTED: [timestamp or NOT_MEASURED]
PERMISSION_READY: [timestamp or NOT_MEASURED]
FIRST_LIVE_FRAME: [timestamp or NOT_MEASURED]
CAMERA_WINDOW_SHOWN: [timestamp or NOT_MEASURED]
R_OFF: [verified timestamp or NOT_MEASURED]
LAYOUT_RESTORED: [timestamp or NOT_MEASURED]
AUTO_OPEN_SUCCESS: YES|NO|NOT_TESTED
MANUAL_FALLBACK_SUCCESS: YES|NO|NOT_TESTED
ERROR_CLASS: USB|PERMISSION|STREAM|PRESENTATION|LAYOUT|UNKNOWN
LOG_POINTER: [private local-only evidence location]
RESULT: PASS|FAIL|NOT_RUN
NOTES:
```
Bảng chỉ được đánh `PASS` nếu case có bằng chứng đúng phiên bản app và đúng thiết bị. Nếu R không có nguồn xác nhận độc lập, ghi `UNKNOWN`; không cho `CAM-13` hoặc `DEX-08` đạt nhờ mất hình/USB. Không tính độ trễ từ hai đồng hồ khác gốc.

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
