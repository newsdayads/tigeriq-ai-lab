# G01 — Hồ sơ phạm vi, vị trí mã nguồn, tên và quyền tài nguyên

**Work Order:** [GH-5180](https://github.com/newsdayads/tigeriq-ai-lab/issues/5180) · **Dự án:** TIGERIQ_GAME_ROBOT_OOPS · **Ngày rà soát:** 2026-10-23 (ICT)

**Loại tài liệu:** Hồ sơ quyết định kỹ thuật và danh mục các cổng cần xác minh. Tài liệu này **không** chứng nhận đã được cấp quyền đối với nhãn hiệu, ảnh, âm nhạc hoặc quyền phát hành.

**Nguồn chuẩn:** [Kế hoạch game](./ROBOT_OOPS_MASTER_PLAN.md), [Work Order G01](https://github.com/newsdayads/tigeriq-ai-lab/issues/5180), [chính sách #504](https://github.com/newsdayads/tigeriq-ai-lab/issues/504).

## 1. Quyết định phạm vi và kiến trúc

| Nội dung | Quyết định G01 | Cổng trước khi thực hiện |
| --- | --- | --- |
| Vị trí mã nguồn MVP | `apps/tigeriq-game/` trong `newsdayads/tigeriq-ai-lab`, package/ứng dụng Web 2D độc lập | G04 (#5183) dựng mã/CI và xác minh đường dẫn |
| Công nghệ ứng viên | TypeScript + Phaser + Vite; G04 được quyết định ADR thay thế theo chứng cứ | Pin phiên bản, kiểm tra license/lockfile trước khi đưa vào ứng dụng |
| Repository GitHub mới | **Không tạo lúc G01.** Dùng đường dẫn độc lập trong repo hiện tại là đủ để bắt đầu MVP | Chỉ tách repo về sau nếu có quyền tạo repo, chính sách chuyển mã và quyết định Owner |
| Ranh giới | Không dùng chung source, tài sản, thông tin người dùng, secrets hoặc runtime với Driver, App Chrome, DeXCam, Core | Không sửa các ứng dụng khác; không đụng production |
| Vòng chơi MVP | Người chơi được thay **đúng một lệnh** trong chuỗi lệnh robot; chạy mô phỏng, kiểm tra thắng/thua | G02 (#5181) đặc tả độc lập; G05 (#5184) triển khai solver/test |
| Giao diện/phát hành | Ưu tiên trình duyệt di động Web 2D, không build Android hay Store ở G01 | G03, G06, G08, G12 và cổng xuất bản riêng |
| Dữ liệu và kiếm tiền | Không tài khoản, PII, quảng cáo, analytics bí mật, giao dịch, thanh toán trong MVP | G09/G13 đánh giá lại bằng chứng và quy định |

**Lý do:** `docs/projects/tigeriq-game/` đã chứa hồ sơ dự án và quy trình của G01–G14. Quyết định đặt app tại `apps/tigeriq-game/` bảo đảm phân tách theo package mà không giả định quyền tạo repository mới hoặc chi phí. **G01 chỉ ghi tài liệu này**; mọi mã game, dựng CI, thử nghiệm, asset và triển khai thuộc Work Order tương ứng.

**Giới hạn kiểm kê:** Kế hoạch nguồn hiện tại đã công bố mã dự án riêng, nhưng chưa có biên nhận rà soát toàn bộ repository hoặc database để khẳng định không tồn tại tên/ý tưởng tương tự ở mọi nơi. Không coi quyết định namespace này là chứng nhận tính duy nhất pháp lý hoặc công nghệ.

## 2. Tên sản phẩm và nhãn hiệu

**Tên làm việc:** `ROBOT OOPS! — Chỉ Sửa 1 Lệnh` · **Trạng thái: NAME_NOT_CLEARED.**

Tên chỉ phục vụ bản thiết kế và nội bộ. Không dùng kết quả tìm kiếm thông thường hay việc chưa thấy trùng để kết luận được phép sử dụng nhãn hiệu. Trước **thương mại hóa/phát hành công khai**, cần người có trách nhiệm thực hiện và lưu hồ sơ tra cứu tên trùng/tương tự (cả chữ, phát âm, logo, nhóm sản phẩm/dịch vụ) theo từng vùng tài phán mục tiêu, đánh giá rủi ro và quyết định dùng hoặc đổi tên.

| Nguồn đối chiếu thủ công | Đường dẫn | Kết quả |
| --- | --- | --- |
| Cục Sở hữu trí tuệ Việt Nam | https://ipvietnam.gov.vn/nhan-hieu | CHƯA CÓ BIÊN NHẬN tra cứu tên cụ thể |
| WIPO Global Brand Database | https://www.wipo.int/en/web/global-brand-database/index | CHƯA CÓ BIÊN NHẬN tra cứu cụ thể |
| USPTO (khi nhắm thị trường Hoa Kỳ) | https://tmsearch.uspto.gov/search/ | CHƯA CÓ BIÊN NHẬN tra cứu cụ thể |

**Lưu ý về điều khoản WIPO:** WIPO không cho phép truy vấn tìm kiếm tự động hoặc scraping dữ liệu của Global Brand Database; do đó phải tra cứu theo giao diện/quyền được phép. Nguồn: https://www.wipo.int/en/web/global-brand-database/terms_and_conditions. Kết quả tra cứu một cơ sở dữ liệu không thay thế đánh giá chính thức tại các khu vực mục tiêu.

**Điểm quyết định:** `WORKING_NAME_ONLY`; không nộp đơn, đăng ký hay sử dụng logo chưa được duyệt dưới danh nghĩa đã sở hữu quyền.

## 3. Kiểm kê và kiểm soát tài nguyên

| Hạng mục | Nguồn/giấy phép được phép hoặc cần có | Trạng thái kiểm kê | Công việc tiếp |
| --- | --- | --- | --- |
| Luật chơi, 5 câu đố, lời giải | Thiết kế mới; lưu đặc tả và chứng cứ solver | CHƯA THIẾT KẾ/XÁC MINH | G02, G05 |
| Mã TypeScript, thuật toán, game logic | Mã viết mới, không lấy source của game khác | CHƯA TẠO | G04, G05 |
| Framework Phaser | Phaser game framework được phát hành theo **MIT**, cho phép dùng thương mại nếu giữ copyright/license notice. Nguồn: https://phaser.io/download/license | ĐÃ XÁC MINH CHÍNH SÁCH LICENSE FRAMEWORK; CHƯA KHÓA PACKAGE/PIN PHIÊN BẢN | G04 pin dependency, lưu notice |
| Phaser Editor, launcher hoặc công cụ thương mại khác | **Không mặc định** được bao gồm trong giấy phép MIT của framework; cần kiểm tra điều khoản riêng | KHÔNG ĐƯỢC TỰ ĐỘNG SỬ DỤNG GÓI TRẢ PHÍ | G04 loại khỏi chi phí 0đ trừ khi có phê duyệt |
| Vite, TypeScript, dependency khác | Xác minh thông báo license tại phiên bản thực dùng và lockfile | CHƯA CÀI/PIN | G04 |
| Robot, sprites, hình nền, icon, hiệu ứng, UI | Tự vẽ mới có hồ sơ tác giả hoặc dùng nguồn có giấy phép rõ ràng, cho phép tái sử dụng trong game | CHƯA NHẬP ASSET | G07 |
| Nhạc, SFX, giọng nói | Tự tạo với quyền sử dụng xác định, hoặc nguồn được cấp phép thương mại, kèm attribution nếu buộc phải ghi | CHƯA NHẬP ASSET | G07 |
| Font | Font hệ thống hoặc font có license thương mại và bản ghi attribution | CHƯA QUYẾT ĐỊNH | G03/G07 |
| Tên, logo và nhãn hiệu | Chỉ tên làm việc, không tuyên bố sở hữu | NAME_NOT_CLEARED | G01/G13 trước phát hành |
| Dữ liệu người chơi / đo lường | MVP không thu PII ngầm; mọi sự kiện đo phải qua thiết kế riêng | CHƯA TRIỂN KHAI | G09 |

**Nguyên tắc nhập tài nguyên:** trước khi thêm asset bên ngoài, lưu **tác giả/chủ sở hữu; URL chính xác; phiên bản hoặc thời điểm truy xuất; loại giấy phép và văn bản giấy phép; quyền sửa/đưa vào sản phẩm thương mại/phân phối; nghĩa vụ ghi công; quyết định người nghiệm thu**. `Free download` hoặc `royalty-free` không tự tạo quyền sử dụng. Nếu chưa đủ biên nhận: **không nhập**.

Tại G01 **không thêm bất kỳ ảnh, nhạc, font, mã engine hay game của bên thứ ba**; bảng trên là cổng nhập tương lai, không phải danh sách asset đã được phê duyệt.

## 4. Chi phí và bảo mật

**Mục tiêu chi phí tiền mặt mới của MVP: 0 VND**, sử dụng hạ tầng/tài nguyên đã có và công cụ có giấy phép phù hợp. Đây không phải cam kết rằng chi phí thời gian, điện, mạng, lưu trữ, giấy phép/phát hành về sau đều bằng 0.

**Các việc cấm tự triển khai tại G01:** mua domain, trả phí API/engine/editor, tạo tài khoản billing, thay secret hoặc credentials, đưa game lên Production, mở analytics/thu PII, đăng Store, sửa App Chrome hoặc dịch vụ khác, vượt cổng bảo mật/Production. Cổng pháp lý/đăng ký thương hiệu nằm ngoài quyền quyết định của báo cáo này.

## 5. Phân chia Work Order và thứ tự nghiệm thu

1. **G01 — GH-5180:** xác lập cấu trúc, ghi nhận rủi ro tên/quyền/giấy phép, nghiệm thu tài liệu này qua nhánh → PR → CI của đúng head → merge → readback main.
2. **G02 — GH-5181:** chỉ bắt đầu khi G01 `CLOSED/completed` và có chứng cứ; chốt luật và 5 màn có lời giải.
3. **G04 — GH-5183:** chỉ bắt đầu khi G01 `CLOSED/completed`; dựng `apps/tigeriq-game/` và CI/build/lint/test thật.
4. **G03/G05 và các bước sau:** tuân thủ sơ đồ phụ thuộc trong [master plan](./ROBOT_OOPS_MASTER_PLAN.md). Không báo có game chạy vì chỉ hoàn thành G01.

**Phân biệt kênh:** quyết định và tài liệu source trên GitHub không chứng minh Core job/lease hoặc Coding Lane đã hồi phục. Coding objective cũ của G01 mang mã `CODEOBJ-a66f97d6-baea-4a69-b488-1ff387b7b713` bị `OUTPUT_CONTRACT_EXHAUSTED`; không tạo lại objective đó bằng retry mù. Mọi thao tác qua Core phải có atomic claim/fencing nếu hợp đồng Core yêu cầu. Ghi source bằng kênh GitHub độc lập, nếu được phép, phải tuân thủ một writer ở đúng scope và biên nhận GitHub chính xác; không giả ownership của Core.

## 6. Sổ rủi ro chưa đóng và trigger

| Rủi ro/chốt | Trạng thái | Trigger |
| --- | --- | --- |
| Tên thương mại chưa được clearance | OPEN — ngăn sử dụng tên như nhãn hiệu được xác nhận; không ngăn prototype mang tên làm việc | Tra cứu thủ công/đánh giá quyền sử dụng |
| Asset cụ thể chưa có giấy phép | OPEN — cấm nhập asset không đủ quyền; chưa có asset ngoài trong G01 | Có license + attribution receipt cho từng tài sản |
| Framework và dependency chưa pin | OPEN — không cản hồ sơ G01; bắt buộc ở G04 | G04 tạo lockfile + license inventory |
| Không có repo độc lập bên ngoài | DECIDED — dùng `apps/tigeriq-game/` trong repo hiện tại | Chỉ quyết định tách nếu quyền/nhu cầu thay đổi |
| Core Coding Lane G01 từng thất bại | KNOWN FAILURE — không tự đánh dấu Core chạy/đã hồi phục | Objective mới được cấp hợp lệ hoặc kênh GitHub độc lập có biên nhận source hợp lệ |

## 7. Checklist chốt hồ sơ G01 (đối chiếu issue gốc)

- [x] Quyết định vị trí source `apps/tigeriq-game/`, phạm vi không đụng các ứng dụng khác.
- [x] Có ma trận loại asset, quyền, giấy phép, nguồn tham khảo và cổng nhập.
- [x] Tên được đánh dấu `NAME_NOT_CLEARED`, không có cam kết sở hữu/độc quyền.
- [x] Ghi nhận chi phí 0đ phát sinh cho MVP và cổng riêng cho Production/pháp lý/chi phí.
- [ ] PR, exact-head CI, merge/main readback và cập nhật trạng thái Work Order — thực hiện bằng biên nhận riêng, không được tự tick từ tài liệu nguồn.

**Nguyên tắc kết luận:** báo cáo G01 có thể được nghiệm thu là hồ sơ đánh giá phạm vi **mà không** tuyên bố tên đã đăng ký hoặc asset tương lai đã được cấp phép. G01 không tạo mã game, không phải chứng nhận pháp lý, và không mở G02/G04 khi issue G01 chưa CLOSED/completed có bằng chứng.
