# 07 — Quyết định, rủi ro, mở rộng và bàn giao

## 1. Nhật ký quyết định (ADR)
| ID | Quyết định | Nguồn/độ chắc chắn | Trạng thái |
|---|---|---|---|
| ADR-001 | App mới dùng cá nhân, độc lập với UltraCar | Owner yêu cầu | ĐÃ CHỐT |
| ADR-002 | Camera và quản lý cửa sổ trong cùng một app | Owner xác nhận | ĐÃ CHỐT |
| ADR-003 | Không cần tài khoản/Firebase/thanh toán/server | Owner xác nhận | ĐÃ CHỐT |
| ADR-004 | Không có thời hạn sử dụng cưỡng chế | Owner xác nhận | ĐÃ CHỐT |
| ADR-005 | Chỉ phân tích, lập dự án; chưa code/cài APK | Owner xác nhận nhiều lần | ĐÃ CHỐT — GIỮ HOLD |
| ADR-006 | Không vá/vượt license APK gốc; tự triển khai kiến trúc/mã độc lập | Thiết kế an toàn/pháp lý | ĐÃ ĐỀ XUẤT |
| ADR-007 | Phát hiện R dựa trên USB attach hay video signal | Thiếu USB log | CHƯA CHỐT |
| ADR-008 | Công cụ ép cửa sổ ADB/Shizuku/khác | Thiếu DeX permission và thử nghiệm | CHƯA CHỐT |
| ADR-009 | Repository mã nguồn riêng và quyền truy cập | TigerIQ hiện public; cần bảo vệ dữ liệu | CHƯA CHỐT |
| ADR-010 | Giao diện/màu sắc thương hiệu của app mới | Chưa có mẫu được duyệt | CHƯA CHỐT |
| ADR-011 | Latency và độ tin cậy công bố | Chưa đo tại thiết bị | CHƯA CHỐT |
| ADR-012 | Chức năng cá nhân mở rộng | Owner sẽ bổ sung | CHƯA CHỐT |
| ADR-013 | Dữ liệu, video, APK tham khảo không đẩy lên GitHub public | Bảo vệ riêng tư/nguồn | ÁP DỤNG TRONG PHẠM VI HỒ SƠ |

## 2. Rủi ro kỹ thuật và kiểm soát
| ID | Rủi ro | Mức quan trọng | Cách giảm rủi ro | Điều kiện gỡ |
|---|---|---|---|---|
| R-01 | Không nhận USB khi R | NGHIÊM TRỌNG | Reconcile + log + đo attach/signal | Tái hiện và giải thích bằng bằng chứng |
| R-02 | Quyền USB chưa sẵn sàng | CAO | Broker trạng thái rõ và retry bounded | Có kết quả thử grant/deny |
| R-03 | Cửa sổ bị Android chặn foreground | NGHIÊM TRỌNG | Test foreground/background + overlay hợp lệ | Có đường hiển thị đã đo |
| R-04 | Resize task Android không cho phép | NGHIÊM TRỌNG | Nhiều cấp capability, fallback | Có thử trên One UI thực |
| R-05 | Hình camera xanh/đen/méo | CAO | Truy vết frame/mode/video input | Xác định mode/chipset |
| R-06 | USB hub thiếu nguồn/chập chờn | CAO | Log detach, đánh giá PD/cáp | Bộ cáp/nguồn đã kiểm |
| R-07 | Sai khác timestamp tạo nhận định lỗi sai | CAO | Monotonic correlation ID | Các mốc đo cùng session |
| R-08 | Gửi nhầm dữ liệu xe/public repo | NGHIÊM TRỌNG | Tách private evidence; review nội dung | Không có thông tin nhận diện trong GitHub |
| R-09 | Thay app nhanh làm mất bố cục | CAO | Snapshot restore idempotent | Test nhiều app/multi-R |
| R-10 | Khung hình cũ gây nhận thức sai khi lùi | NGHIÊM TRỌNG | Live-frame freshness + fail-visible | Chứng cứ thử stream stall |
| R-11 | Tính năng mở rộng ảnh hưởng camera P0 | CAO | Cơ chế ưu tiên camera, modular tests | Regression P0 sau mọi thay đổi |
| R-12 | Phụ thuộc mã/nhãn/thư viện không hợp quyền | CAO | Mã độc lập, audit giấy phép thư viện | Rà soát nguồn bên thứ ba |
| R-13 | Chưa có quyền xây dựng nhưng hệ thống tự chạy | NGHIÊM TRỌNG | `IMPLEMENTATION_AUTHORIZATION=false`, không đưa hàng đợi | Có lệnh Owner thực |
| R-14 | Nhận nhầm "có app" là đã hoạt động an toàn | NGHIÊM TRỌNG | Thử thật và log acceptance | Kiểm thử trên xe thật |

## 3. Chế độ dự phòng đề xuất khi sản phẩm đã làm
- `USB_MISSING`: thông báo thiếu bộ camera, không mở cửa sổ giả.
- `USB_PERMISSION_REQUIRED`: hướng dẫn quyền một lần theo chính sách hệ thống.
- `SIGNAL_UNAVAILABLE`: hiển thị mất tín hiệu, không phát khung hình cũ.
- `WINDOW_CONTROL_LIMITED`: trả về bố cục cuối cùng có thể hiển thị, báo thiếu quyền nếu cần.
- `RECOVERY_EXHAUSTED`: dừng tự retry, lưu chẩn đoán và mở chế độ thủ công dự phòng.
- `SAFE_DEFAULT`: trong lỗi camera, tránh che kín màn hình bằng lớp màn hình đen chưa rõ trạng thái.

## 4. Gợi ý module mở rộng (CHƯA PHẢI YÊU CẦU ĐÃ DUYỆT)
| Module | Giá trị khả dĩ | Điều kiện tích hợp |
|---|---|---|
| Hồ sơ lái xe/ngữ cảnh | Chuyển bố cục theo chế độ sử dụng | Owner xác nhận quy tắc chuyển và quyền |
| Bố cục theo màn hình | Chuyển preset khi đổi màn hình HDMI | Cần biết DPI/DeX chính xác |
| Quản lý USB hub | Theo dõi USB camera/device status | Không yêu cầu root mặc định |
| Nhật ký tự chẩn đoán | Xem sự kiện R, USB, frame, cửa sổ | Không lưu tọa độ/vị trí/biển số nếu không cần |
| Cấu hình dự phòng | Xuất/nhập profile tại máy | Chỉ owner-controlled, không server |
| Điều khiển camera nâng cao | Mirror, crop, rotation, guideline | Chỉ sau khi xác định format, chipset |
| Phím tắt/điều khiển nhanh | Mở camera thủ công khi USB đã sẵn sàng | Không làm gián đoạn thao tác lái |
| Tích hợp cảm biến khác | OBD/CAN/nút điều khiển | **Ngoài P0**, yêu cầu cấp phép thiết bị và thử an toàn riêng |

Mọi tính năng mới cần: mã `FR-NEW`, mô tả, điều kiện kích hoạt, quyền, tài nguyên, ảnh hưởng đến camera P0, cách rollback và testcase.

## 5. Cách quản lý bằng chứng và riêng tư
- Hồ sơ GitHub công khai chứa thông tin **do người dùng sở hữu về yêu cầu, mô hình và testcase**, không lưu reverse-engineered proprietary source.
- Ảnh linh kiện/video do Owner gửi: chỉ làm bằng chứng nội bộ của phiên chat; nếu cần lưu lâu dài phải chọn kho riêng tư trước, không suy đoán quyền sử dụng.
- Nhật ký thiết bị có thể lộ serial/IMEI/địa điểm/hành trình: phải xóa định danh trước khi đưa vào issue công khai.
- APK UltraCar v240 chỉ dùng làm **mẫu đối chiếu tính năng**; không tự chia sẻ, tái đóng gói hoặc phát hành APK/mã native của vendor.

## 6. Chính sách thay đổi
- Mọi thay đổi chỉ trên nhánh/tài liệu thuộc `projects/dexcam-personal/`; không chạm TigerIQ Core, App Chrome hoặc module khác.
- Thay đổi trọng yếu: hành vi camera khi R, quyền hệ thống, cấp nguồn xe, dữ liệu riêng tư, release → cần quyết định Owner đúng phạm vi.
- Nếu hệ thống còn quyền ghi, cập nhật Issue gốc và PR liên quan bằng bằng chứng/tình trạng thực; không khẳng định chat khác tự nạp bản cập nhật.
- Nếu sau này tách thành repository mã nguồn riêng, vẫn giữ Issue gốc làm điểm theo dõi điều hành và link sang repository, không tạo dự án trùng nghĩa.

## 7. Trạng thái tại thời điểm đăng ký
```
PROJECT=TIGERIQ_DEXCAM_PERSONAL
OWNER=SON
PHASE=DISCOVERY_SPECIFICATION
REPOSITORY_OF_PROJECT_DOCS=newsdayads/tigeriq-ai-lab
REPOSITORY_OF_APP_CODE=NONE
IMPLEMENTATION_AUTHORIZATION=false
READY_FOR_IMPLEMENTATION=false
TESTED_ON_HARDWARE=false
APP_SOURCE_WRITTEN=false
APK_BUILT=false
INSTALLED=false
RELEASED=false
CORE_QUEUE=EXCLUDED
SOURCE_OF_TRUTH=GITHUB_MAIN_AFTER_PR_MERGE
DRIVE_SYNC=NOT_REQUIRED; no bootstrap/loader or operating policy changes
```
