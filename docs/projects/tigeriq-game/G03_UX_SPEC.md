# G03 — Trải nghiệm Robot Oops! một ngón tay (Mobile Web 2D)

**Work Order:** [GH-5182](https://github.com/newsdayads/tigeriq-ai-lab/issues/5182) · **Ưu tiên:** P2 · **Phụ thuộc đã được nghiệm thu:** [G02 #5181](https://github.com/newsdayads/tigeriq-ai-lab/issues/5181) · **Ngày:** 23/10/2026.

**Trạng thái tài liệu:** `UX_SPEC_DESIGNED`; đây là hợp đồng thiết kế cho G06, **không** phải tuyên bố UI/điện thoại đã triển khai, không phải kết quả thử với người thật. Tham chiếu: [G02 game design](./ROBOT_OOPS_GAME_DESIGN.md), [G01 asset audit](./G01_SCOPE_AND_REPO_AUDIT.md), [master plan](./ROBOT_OOPS_MASTER_PLAN.md).

## 1. Mục tiêu và ranh giới

- Người chưa được hướng dẫn có thể nhận ra **đích**, **lệnh cần thay**, và nút **CHẠY**; thay đúng một lệnh bằng một ngón tay.
- Tối ưu chiều ngang viewport **320–430 CSS px**; chiều dọc co giãn, cuộn nội dung nếu thiếu chỗ, **không** cuộn ngang.
- 3 màn chính: **Chọn màn → Sửa 1 lệnh → Kết quả**, kết quả có quay lại sửa hoặc qua màn sau.
- G03 chỉ chốt flow, cấu trúc, trạng thái tương tác và tiêu chí kiểm thử. G06 thực hiện UI thật; G08 kiểm tra trên trình duyệt/thiết bị. Không copy art, nhân vật, layout hoặc nhạc của game khác.

## 2. User flow và điều kiện chuyển trạng thái

```text
[CHỌN MÀN] --chạm thẻ màn--> [GIẢI ĐỐ]
  [GIẢI ĐỐ] --chạm 1 slot cho phép--> [DANH SÁCH LỆNH THAY]
  [DANH SÁCH LỆNH THAY] --chọn lệnh mới khác lệnh cũ--> [SẴN SÀNG CHẠY]
  [SẴN SÀNG CHẠY] --CHẠY--> [THỰC THI HỮU HẠN]
  [THỰC THI HỮU HẠN] --SOLVED--> [KẾT QUẢ THẮNG] --TIẾP--> [CHỌN/MÀN SAU]
  [THỰC THI HỮU HẠN] --LỖI/GOAL_NOT_MET--> [KẾT QUẢ THUA] --SỬA LẠI--> [GIẢI ĐỐ]
  [GIẢI ĐỐ] --ĐẶT LẠI--> [GIẢI ĐỐ TRẠNG THÁI GỐC]
```

Tất cả trạng thái có nhãn chữ và chỉ dấu icon/hình, không dựa riêng vào màu. CHẠY vô hiệu khi chưa có **đúng một** phép thay `slot` hợp lệ theo G02; trong khi chạy khóa thao tác thay, chờ terminal, không cho chạm gửi lệnh trùng. Kết quả từ engine G05 là nguồn duy nhất để hiện THẮNG/THUA; UI không hard-code đáp án.

## 3. Sơ đồ ba màn — mobile-first

### 3.1. Chọn màn (S01_UI)

- Header: thương hiệu làm việc `Robot Oops!` + nhãn `BẢN THỬ` (tên chưa được thẩm định nhãn hiệu).
- 1 câu hướng dẫn dưới header: **“Chọn một màn và sửa đúng một lệnh cho robot.”**
- 5 thẻ L01–L05 dạng **một cột** ở 320–359px; có thể 2 cột ở 400–430px chỉ khi không làm target nhỏ hơn 44×44px và không có cuộn ngang. Thẻ có số, tên, nhãn `Chưa chơi / Đã qua`; không khóa màn do trả phí.
- Thẻ được focus bằng bàn phím, có vai trò button; Back từ màn giải đố quay về chọn màn không mất khả năng chơi lại.
- Không dùng quảng cáo, login, cookie analytics hoặc yêu cầu PII.

### 3.2. Giải đố (S02_UI)

Theo thứ tự DOM và thứ tự cuộn (từ trên xuống):

1. Thanh tiêu đề: nút `Quay lại`, `Màn N/5`, nút tắt/bật âm nếu có (mặc định không bắt buộc âm).
2. Mục tiêu bằng chữ, ví dụ `Đưa robot tới ô (2,1)` / `Nhấn công tắc` / `Giao gói hàng`.
3. Canvas lưới robot 2D: vuông, `aspect-ratio:1`, tối đa 100% bề ngang vùng nội dung; vùng thay đổi trạng thái có diễn giải text `aria-live`.
4. Dải lệnh đánh số từ 1: nút `Lệnh 1: MOVE`, `Lệnh 2: TURN_LEFT`, ...; **một slot cho phép sửa** được gắn biểu tượng bút và nhãn `Có thể sửa`. Các slot khác có nhãn `Cố định`, không được chọn. Dãy nhiều lệnh được **wrap thành nhiều hàng**, không làm trang tràn ngang.
5. Khi chọn slot: mở danh sách 6 lệnh thay hợp lệ (theo 7-command alphabet G02 trừ lệnh gốc); mỗi nút có tên người đọc hiểu: `Đi tới`, `Quay trái`, `Quay phải`, `Nhặt`, `Đặt`, `Nhấn`, `Đợi`, kèm ký hiệu vector đơn giản hoặc chữ.
6. Hành động chính: nút `CHẠY`; phụ: `Đặt lại`. `CHẠY` chỉ bật sau khi thay đúng một lệnh; không auto-run khi chạm nhầm.
7. Trạng thái kết quả/nhật ký: `Đã chạy N lệnh`, `Không tới đích` hoặc lý do lỗi `Đụng tường`, `Chưa cầm hàng`, `Chưa đứng tại công tắc`. Tránh text mơ hồ kiểu `Lỗi 500`.

**Điều khiển một ngón tay:** chạm slot → chạm lệnh thay → chạm CHẠY (3 lần chạm). Không yêu cầu kéo thả, giữ lâu, vuốt khó chính xác hay xoay điện thoại. Các hành động đều hoạt động bằng touch, chuột, Enter/Space.

### 3.3. Kết quả (S03_UI)

- Khi thắng: tiêu đề `ĐÃ GIÚP ROBOT!`, chi tiết trạng thái cuối và `Màn kế tiếp` (nếu còn), nút `Chơi lại`; không tự mở màn tiếp theo khi người chơi chưa chọn.
- Khi thua: tiêu đề `CHƯA THÀNH CÔNG` và lý do có thể hiểu, ví dụ `Robot rẽ ra ngoài bản đồ`; nút chính `Sửa lại`, phụ `Đặt lại từ đầu`.
- Khi người dùng bật reduced-motion: tắt hiệu ứng nhảy/flash/phóng lớn; mỗi trạng thái vẫn hiện bằng chữ. Âm thanh tắt không làm mất tín hiệu thắng/thua.
- Luôn có nút về Chọn màn; không mất dữ liệu liên quan G02 trong replay, không gửi telemetry ngầm.

## 4. Kích thước, khả năng truy cập và tiêu chuẩn giao diện

| Hạng mục | Quy tắc bắt buộc cho UI triển khai tại G06 | Kiểm chứng tại G08 |
| --- | --- | --- |
| Viewport | 320, 360, 375, 390, 430 CSS px; không có phần tử kéo trang ngang | Browser screenshot + `scrollWidth <= clientWidth` từng width |
| Lề/safe area | Padding nội dung 16px, cộng `env(safe-area-inset-*)` khi có; không che nút ở notch/thanh điều hướng | Mobile viewport và thiết bị |
| Tap target | Các nút tương tác tối thiểu 44×44 CSS px và khoảng cách chống chạm nhầm | Đo bounding box tất cả nút |
| Body text | Phông hệ thống; nội dung tối thiểu 16px, trạng thái/chú thích ngắn không dưới 14px | Zoom 200% không mất CTA |
| Độ tương phản | Chữ thường hướng đến WCAG AA ít nhất 4.5:1; chữ lớn và biểu tượng tác vụ ít nhất 3:1 | Công cụ đo contrast trên CSS thật; G03 không tuyên bố PASS |
| Khác biệt màu | Không gắn nghĩa `đúng/sai` chỉ bằng xanh/đỏ; có chữ hoặc hình | Giả lập grayscale/color blindness |
| Canvas | `role=img` kèm mô tả trạng thái ngắn; không đặt các hành động chỉ bằng click lên canvas | Screen reader và bàn phím |
| Focus | Chỉ một focus indicator rõ; không trap bàn phím; dialog slot có Escape/Đóng | Tab/Shift+Tab, Enter/Space |
| Thời gian | Không tự thua vì hết thời gian; mô phỏng có `maxSteps` nội bộ và nút Thử lại | Test gián đoạn và replay |
| Giảm chuyển động | Tôn trọng `prefers-reduced-motion` | Emulate media query |
| Mạng và quyền | Không tài khoản, quảng cáo, phí, PII hoặc download external asset trong MVP | Network tab, source audit G09 |

**Thiết kế tham chiếu không độc quyền:** color tokens ứng viên nền #091328 / chữ #EEF4FF / CTA #3B68EB của vỏ G04; G06 có thể điều chỉnh để đạt contrast thực tế, **không** dùng số màu này làm bằng chứng đo WCAG đã đạt.

## 5. Hướng dẫn onboarding 3 bước, không phụ thuộc chữ dài

- **Bước A — Thấy mục tiêu:** highlight đích trên lưới, kèm chữ `Hãy đưa robot đến ô màu vàng`; có nút `Tiếp`.
- **Bước B — Sửa một lệnh:** nhấn vào slot có bút và dòng `Sửa lệnh số 2`; menu lệnh thay có giải thích theo chữ. Hướng dẫn một ngón tay, không bắt buộc đọc cả danh sách luật.
- **Bước C — Chạy và xem:** sau khi thay thành công, CTA `CHẠY` nổi rõ. Sai thì đề xuất `SỬA LẠI` không phạt, đúng thì `MÀN TIẾP`.
- Hướng dẫn phải có nút Bỏ qua, có thể xem lại từ menu; khi huấn luyện người mới, đo thời gian thực, không bịa tỷ lệ hiểu luật.

**Chỉ số thử nghiệm G10:** giả thuyết ≥80% người mới hiểu cơ chế trong 30 giây, đo mẫu 30–50 người và định nghĩa `hiểu luật` = tự thay đúng một lệnh rồi nhấn Chạy không có gợi ý thêm. Đây là **ngưỡng mục tiêu**, chưa có dữ liệu thử thực tế.

## 6. Chuyển giao phát triển và nghiệm thu thực tế

- **G03 nghiệm thu tài liệu:** đủ 3 màn, flow one-finger, giới hạn 320–430px, giao diện lỗi/thắng/thua, accessibility, onboarding và test matrix để G06/G08 thực hiện.
- **G06 phải triển khai:** từ contract G02 + engine G05 đến UI thật; không dùng G04 technical preview như bằng chứng 5 màn playable.
- **G08 phải chứng minh:** viewport, tap targets, contrast, screen reader/keyboard, trạng thái replay, reduced motion, iPhone/Android browser thật với biên nhận ảnh/video/log nếu có. Không gọi `PASS` những thử nghiệm này từ tài liệu G03.
- **Điểm dừng:** không biến tên làm việc thành thương hiệu đã đăng ký; không tự thêm asset/PII/analytics/cost/production; riêng 5 màn phải được G05 solver xác minh bằng tests.

## 7. Bảng nghiệm thu UX dạng có thể kiểm tra

| ID | Bước kiểm thử dự kiến | Kỳ vọng |
| --- | --- | --- |
| UX01 | Mới mở, không hướng dẫn dài | Nhìn thấy một mục tiêu, slot có thể sửa, CTA CHẠY có nhãn rõ |
| UX02 | Chạm chọn slot cố định | Không thay được; thông báo `Lệnh cố định` |
| UX03 | Chạm slot cho phép và chọn chính lệnh cũ | Bị từ chối `Hãy chọn lệnh khác` |
| UX04 | Chọn đúng lệnh và nhấn CHẠY | Một lần chạy duy nhất, trạng thái kết thúc phản ánh engine |
| UX05 | Sửa lại sau thua | Quay đúng màn và thử lại, không giữ robot state cũ |
| UX06 | 320 / 360 / 375 / 390 / 430 CSS px | Không tràn ngang, nút chính luôn tiếp cận được |
| UX07 | Tap-only / keyboard-only / grayscale | Không cần kéo thả và không dựa màu duy nhất |
| UX08 | Prefers reduced motion | Không phát hiệu ứng bắt buộc, vẫn có kết quả bằng chữ |
| UX09 | 200% zoom | Không mất chức năng CHẠY, chọn slot, Đặt lại |
| UX10 | 5 màn, mỗi lần chỉ một phép thay | Mục tiêu/slot/lỗi đúng nguồn G02/G05, không hard-code thắng |

**Trạng thái kiểm chứng tại G03:** mười ca là **ACCEPTANCE CRITERIA ĐÃ THIẾT KẾ**, chưa có test UI/browser thật; kết quả đo ở G08 phải được ghi sau. G03 không triển khai Production.

---
Tài liệu chỉ áp dụng cho `TIGERIQ_GAME_ROBOT_OOPS_G03`, target duy nhất `docs/projects/tigeriq-game/G03_UX_SPEC.md`. Không sửa Work Order khác.
