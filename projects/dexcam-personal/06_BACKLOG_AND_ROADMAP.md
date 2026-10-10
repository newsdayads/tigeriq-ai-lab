# 06 — Kế hoạch dự án, danh sách việc và điều kiện chuyển giai đoạn

> **CHỈ LẬP KẾ HOẠCH.** Mọi việc lập trình, cài đặt trên xe hoặc cấp quyền vượt mặc định đều **CHỜ LỆNH OWNER**. Không có nhân sự AI nào đang thực thi ngầm.

## 1. Cấu trúc dự án độc lập
- **Mã dự án:** `TIGERIQ_DEXCAM_PERSONAL`
- **Hồ sơ điều hành:** [Issue #4625 — Dự án DeXCam Personal](https://github.com/newsdayads/tigeriq-ai-lab/issues/4625)
- **Tài liệu:** `projects/dexcam-personal/`
- **Mã nguồn ứng dụng:** **chưa có kho mã riêng**. Khi chuyển sang triển khai, ưu tiên tạo repository **riêng, riêng tư nếu chứa dữ liệu/driver thông tin chủ xe**, không dùng chung build pipeline TigerIQ Core.
- **Môi trường:** Android/Samsung DeX; không liên quan App Chrome, không thay đổi Core/PC01.
- **Điều hành hiện hành (Owner 2026-10-10):** P1, NV02 được tiếp tục rà soát và bổ sung tài liệu trong phạm vi có sẵn; chưa có bằng chứng Core tự giao việc và `AUTO_QUEUE=EXCLUDED` vẫn giữ. Chưa cấp quyền lập trình APP, không dùng Codex/RDC hoặc sửa App Chrome.

## 2. Giai đoạn và kết quả bàn giao dự kiến
| Giai đoạn | Trạng thái | Đầu ra cần có | Điều kiện kết thúc |
|---|---|---|---|
| P0-0: Ghi nhận mục tiêu | HOÀN THÀNH (hồ sơ) | Issue + tài liệu phân tích | GitHub ghi và đọc lại được |
| P0-1: Khảo sát thiết bị | CHƯA THỰC HIỆN | USB descriptor, Android/DeX, trigger R, log 5 lượt | Owner cho phép đo/thu log |
| P0-2: Khóa đặc tả | CHỜ KẾT QUẢ KHẢO SÁT | Chốt phạm vi giao diện, mode camera, quyền task, độ trễ | Quyết định Owner |
| P0-3: Bắt đầu xây dựng | CHƯA ĐƯỢC PHÉP | Repository độc lập, mã nguồn và thử mô phỏng | Lệnh Owner rõ ràng `LÀM APP` |
| P0-4: Tích hợp với thiết bị | CHƯA ĐƯỢC PHÉP | APK thử, log USB/DeX, 5 chu kỳ đầu | Thiết bị và quyền thật |
| P0-5: Ổn định, kiểm thử | CHƯA ĐƯỢC PHÉP | 50 chu kỳ R, độ trễ, lỗi khôi phục | Số liệu kiểm thử |
| P0-6: Phát hành cá nhân | CHƯA ĐƯỢC PHÉP | Bản ký chính chủ và hướng dẫn phục hồi | Owner duyệt cài/phát hành |

**Lưu ý:** P0-0 chỉ là hoàn tất **khâu ghi nhận**, không phải hoàn thành phát triển. Tất cả tỷ lệ dự án phải dựa trên danh sách hạng mục đã nghiệm thu, không gán % cho phần chưa kiểm thử.

## 3. Danh sách đầu việc theo mức độ ưu tiên và phụ thuộc

### NHÓM A — NGHIÊN CỨU / ĐẶC TẢ
| ID | Ưu tiên | Công việc | Phụ thuộc | Đầu ra |
|---|---|---|---|---|
| A-01 | P0 | Xác nhận kiến trúc camera lùi từ Owner | Đã có | Sơ đồ trạng thái có nguồn |
| A-02 | P0 | Đối chiếu APK tham khảo và video ở mức tĩnh | Đã có | Dấu vết tính năng, giới hạn hiểu biết |
| A-03 | P0 | Điều tra USB VID/PID/UVC interface và mode | Thiết bị thật | Thông số driver thực |
| A-04 | P0 | Thử 5 lượt R thành công/thất bại, đối chiếu log | Owner thao tác an toàn | Phân biệt attach/signal/race |
| A-05 | P0 | Kiểm tra DeX OS/model/display/permission | Thiết bị thật | Bảng khả năng window control |
| A-06 | P0 | Khóa tiêu chí độ trễ, logic hiện/ẩn | A-03..A-05 | Tiêu chuẩn hiệu năng có số đo |
| A-07 | P1 | Duyệt đề xuất module mở rộng | Owner yêu cầu tính năng | Danh sách tính năng đã duyệt |

### NHÓM B — CAMERA CORE (chỉ sau lệnh làm app)
| ID | Ưu tiên | Công việc | Phụ thuộc | Điều kiện nghiệm thu |
|---|---|---|---|---|
| B-01 | P0 | USB discovery + reconcile + identify | A-03 | Không bỏ qua USB sau resume |
| B-02 | P0 | USB permission flow | B-01 | Ghi grant/deny/retry đúng |
| B-03 | P0 | Mở/đóng UVC preview | B-02 | Có frame live và trạng thái |
| B-04 | P0 | State machine R/USB/signal | A-04, B-03 | Auto-open có ack, tránh mất sự kiện |
| B-05 | P0 | Camera window visibility controller | B-04 | Có `window_shown` thật |
| B-06 | P0 | Recovery bounded + anti-stale-frame | B-03..B-05 | Không treo/khung hình cũ |
| B-07 | P1 | Flip/rotate/fit/color/guidelines | B-03 | Chỉ làm khi phần cứng cho phép |

### NHÓM C — QUẢN LÝ CỬA SỔ DEX (chỉ sau lệnh làm app)
| ID | Ưu tiên | Công việc | Phụ thuộc | Điều kiện nghiệm thu |
|---|---|---|---|---|
| C-01 | P0 | Capability + display/insets/density probe | A-05 | Có khả năng đo bounds |
| C-02 | P0 | Chọn app, preset và X/Y/W/H | C-01 | Lưu/đọc đúng dữ liệu |
| C-03 | P0 | Launch app vào vùng | C-02 | Xác nhận Android áp hay từ chối |
| C-04 | P0 | Resize task tùy quyền hợp lệ | C-03, Owner gate nếu cần | Tọa độ thật có readback |
| C-05 | P0 | Layout snapshot & restore sau camera | B-05, C-03 | Không phá bố cục app hiện hữu |
| C-06 | P1 | Multi-display, DPI migration | C-02..C-05 | Không mở cửa sổ sai display |
| C-07 | P1 | Tự khởi động/khôi phục trên DeX | C-03..C-06 | Hoạt động khi OS thực cho phép |

### NHÓM D — VẬN HÀNH / AN TOÀN
| ID | Ưu tiên | Công việc | Điều kiện nghiệm thu |
|---|---|---|---|
| D-01 | P0 | Logger theo session R/USB/task | Có correlation ID |
| D-02 | P0 | Thử nghiệm emulator/mock USB/event | Có kiểm thử kịch bản lỗi, không coi như test xe |
| D-03 | P0 | Thử USB hub/xe thật tại nơi an toàn | 5/5 ban đầu có log |
| D-04 | P0 | Thử 50 chu kỳ R | Mục tiêu 50/50, lưu từng lượt |
| D-05 | P0 | Kiểm thử app kill/restart/USB disconnect | Không deadlock; báo lỗi rõ |
| D-06 | P0 | Kiểm thử từ chối quyền/Android hạn chế UI | Không giả thành công |
| D-07 | P1 | Xuất nhập config offline, cơ chế backup | Không lộ dữ liệu định danh xe |
| D-08 | P1 | Báo cáo chất lượng và nghiệm thu | Chỉ công bố số đo có bằng chứng |

## 4. Các hạng mục KHÔNG được mặc định giao Core tự động
- Viết APK/app, sửa quyền thiết bị, thay đổi cài đặt USB debugging, cài ứng dụng vào máy anh.
- Thực thi trên PC01 bằng RDC, gọi Codex, thay đổi App Chrome.
- Phát hành/triển khai, thay đổi nhánh main, tạo tài khoản hoặc sử dụng dịch vụ có phí.

## 5. Tiêu chuẩn chuyển sang lập trình
1. Có lệnh riêng của anh Sơn cho phép lập trình, chỉ rõ phạm vi tính năng.
2. Đã xác định đường xử lý camera thực hoặc chấp nhận thử nghiệm có giám sát.
3. Phân tách repository riêng cho code, không nhét vào TigerIQ Core mặc định.
4. Có backlog P0 khả thi, quy trình kiểm thử mock và thực địa.
5. Có cơ chế quyền, bảo mật, quyền riêng tư; không động đến license ứng dụng tham khảo.
6. Đặt chuẩn bằng chứng và báo cáo minh bạch, không khẳng định xong khi chưa chạy thật.

## 6. Tổ chức liên lạc
- Mỗi bổ sung tính năng của Owner được thêm vào yêu cầu và gán ID, xác định có thay đổi kiến trúc hay không.
- Quyết định được ghi trong [07_DECISIONS_RISKS_EXTENSIONS.md](07_DECISIONS_RISKS_EXTENSIONS.md); không tự điền quyết định chưa có.
- Không tạo backlog con/issue hàng loạt chỉ để nhìn có tiến độ; Issue chính + đặc tả là hồ sơ chuẩn của phiên này.
