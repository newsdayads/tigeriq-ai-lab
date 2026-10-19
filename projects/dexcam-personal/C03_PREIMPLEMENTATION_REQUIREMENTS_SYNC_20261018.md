# C03 — Đồng bộ yêu cầu FR/NFR và mở rộng trước lập trình

Work Order: https://github.com/newsdayads/tigeriq-ai-lab/issues/4625
Resource scope: DEXCAM_PERSONAL_GH4625_SOURCE_AND_BUILD

## Ranh giới nghiệm thu
Chỉ chốt **đồng bộ hồ sơ đặc tả hiện có** từ PRD, ma trận kiểm thử và quyết định. Không tạo yêu cầu mới, không cấp quyền đặc biệt, không tuyên bố G1/G2, C01, REA v240 hoặc ứng dụng Android đã chạy.
Mọi ca CAM/DEX là **thiết kế bài kiểm thử**, chưa có bằng chứng thực thi. Trạng thái của từng hàng trong tệp JSON luôn NOT_RUN.

## Ma trận truy vết chức năng (18 FR)
| ID | Ưu tiên | Cổng chưa đạt | Ca kiểm thử dự kiến |
| --- | --- | --- | --- |
| FR-001 | P0 | C01_P01_REAL_USB_R_EVIDENCE_PENDING | CAM-01, CAM-02, CAM-07 |
| FR-002 | P0 | C01_P01_REAL_USB_R_EVIDENCE_PENDING | CAM-06, CAM-07, CAM-20, CAM-21, CAM-22 |
| FR-003 | P0 | C01_P01_REAL_USB_R_EVIDENCE_PENDING | CAM-03, CAM-04, CAM-05 |
| FR-004 | P0 | C01_P01_REAL_USB_R_EVIDENCE_PENDING | CAM-02, CAM-12, DEX-12 |
| FR-005 | P0 | C01_P01_REAL_USB_R_EVIDENCE_PENDING | CAM-13, CAM-18, DEX-08 |
| FR-006 | P0 | C01_P01_REAL_USB_R_EVIDENCE_PENDING | CAM-08, CAM-09, CAM-17 |
| FR-007 | P0 | C01_P01_REAL_USB_R_EVIDENCE_PENDING | CAM-07, CAM-09, CAM-11 |
| FR-008 | P0 | C02_SOURCE_CONTRACT_DONE_OS_READBACK_PENDING | DEX-01, DEX-02, DEX-04 |
| FR-009 | P0 | C02_SOURCE_CONTRACT_DONE_OS_READBACK_PENDING | DEX-03, DEX-06, DEX-10 |
| FR-010 | P0 | C02_SOURCE_CONTRACT_DONE_OS_READBACK_PENDING | DEX-11 |
| FR-011 | P0 | C01_P01_REAL_USB_R_EVIDENCE_PENDING | CAM-19 |
| FR-012 | P0 | C01_P01_REAL_USB_R_EVIDENCE_PENDING | CAM-14 |
| FR-013 | P1 | G2_AND_IMPLEMENTATION_PENDING | Cần bổ sung sau khi Owner xác nhận |
| FR-014 | P1 | G2_AND_IMPLEMENTATION_PENDING | Cần bổ sung sau khi Owner xác nhận |
| FR-015 | P1 | G2_AND_IMPLEMENTATION_PENDING | Cần bổ sung sau khi Owner xác nhận |
| FR-016 | P1 | G2_AND_IMPLEMENTATION_PENDING | Cần bổ sung sau khi Owner xác nhận |
| FR-017 | P1 | G2_AND_IMPLEMENTATION_PENDING | Cần bổ sung sau khi Owner xác nhận |
| FR-018 | P2 | OWNER_EXTENSION_APPROVAL_REQUIRED | Cần bổ sung sau khi Owner xác nhận |

## Ma trận phi chức năng (10 NFR)
| ID | Cổng chưa đạt | Ca kiểm thử gợi ý/chưa chạy |
| --- | --- | --- |
| NFR-001 | G2_OR_LATER_DEVICE_ACCEPTANCE_PENDING | CAM-04 |
| NFR-002 | G2_OR_LATER_DEVICE_ACCEPTANCE_PENDING | CAM-19 |
| NFR-003 | G2_OR_LATER_DEVICE_ACCEPTANCE_PENDING | CAM-17, CAM-18 |
| NFR-004 | G2_OR_LATER_DEVICE_ACCEPTANCE_PENDING | Chưa xác lập ca riêng |
| NFR-005 | G2_OR_LATER_DEVICE_ACCEPTANCE_PENDING | Chưa xác lập ca riêng |
| NFR-006 | G2_OR_LATER_DEVICE_ACCEPTANCE_PENDING | Chưa xác lập ca riêng |
| NFR-007 | G2_OR_LATER_DEVICE_ACCEPTANCE_PENDING | DEX-12 |
| NFR-008 | G2_OR_LATER_DEVICE_ACCEPTANCE_PENDING | CAM-05, CAM-11 |
| NFR-009 | G2_OR_LATER_DEVICE_ACCEPTANCE_PENDING | CAM-14 |
| NFR-010 | G2_OR_LATER_DEVICE_ACCEPTANCE_PENDING | Chưa xác lập ca riêng |

## Chính sách mở rộng và quyền quyết định
- FR-018 là chỗ giữ chỗ cho **tiện ích tương lai**; không tự định nghĩa FR-NEW, UI mới, CAN/OBD, hay chế độ xe.
- ADR-007 R trigger, ADR-008 ADB/Shizuku, ADR-009 kho riêng, ADR-010 giao diện, ADR-011 độ trễ, ADR-012 mở rộng **chưa chốt**. C02 đã nghiệm thu kiến trúc nguồn L0 public launch request → L1 manual fallback, không hàm ý chốt quyền L2.
- FR-013..017 hiện là danh mục ưu tiên thấp hơn FR-001..012; chưa có chứng cứ tính năng chạy trên phần cứng.
- Mọi giá trị USB mode, R_OFF độc lập, One UI/DeX capability, first-visible-live-frame, applied_bounds và độ trễ hiện ở trạng thái CHƯA ĐO.

## Điều kiện khởi động D01
Chỉ tiến tới D01 theo 06_BACKLOG_AND_ROADMAP.md khi G1/G2 (dữ liệu thiết bị, quyết định Owner), phương án camera thực và kho nguồn/quyền ghi có biên nhận. Hồ sơ này **không** tự kích hoạt D01.

## Nguồn chính xác
- [projects/dexcam-personal/01_PRODUCT_REQUIREMENTS.md](https://github.com/newsdayads/tigeriq-ai-lab/blob/main/projects/dexcam-personal/01_PRODUCT_REQUIREMENTS.md)
- [projects/dexcam-personal/05_QUALITY_ACCEPTANCE.md](https://github.com/newsdayads/tigeriq-ai-lab/blob/main/projects/dexcam-personal/05_QUALITY_ACCEPTANCE.md)
- [projects/dexcam-personal/07_DECISIONS_RISKS_EXTENSIONS.md](https://github.com/newsdayads/tigeriq-ai-lab/blob/main/projects/dexcam-personal/07_DECISIONS_RISKS_EXTENSIONS.md)
- [C02 — kiến trúc nguồn đã nghiệm thu](https://github.com/newsdayads/tigeriq-ai-lab/pull/5014)

### C03 acceptance (chỉ quy trình hồ sơ)
1. JSON chứa 18 FR, 10 NFR đúng mã và wording từ PRD; không trùng/mất hàng.
2. Các CAM/DEX có dẫn chiếu đều tồn tại trong tài liệu 05; mọi test_status=NOT_RUN.
3. Không có FR-NEW hoặc lựa chọn mở rộng được giả duyệt; các phụ thuộc P01/C01/G1/G2/D01 không được đánh DONE.
4. Có kiểm thử Node + Vitest, CI đúng HEAD, PR bảo vệ và GitHub main readback trước khi tích checkbox C03.

Tiến độ toàn dự án căn cứ checklist 30 mốc trên #4625, không căn cứ số hàng ma trận.
