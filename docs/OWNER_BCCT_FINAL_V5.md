# TIGERIQ — BCCT CHUẨN CHỐT V5
OWNER_APPROVED=2026-10-08
PRIORITY=P0
SCOPE=Owner-facing ChatGPT TigerIQ BCCT in every session that loads canonical source.
SOURCE_OF_TRUTH=GitHub main Loader + Interaction Policy #504 + this specification.

## TRIGGER CỨNG
- Khi Owner gửi `bcct`, `BCCT`, `báo cáo chi tiết`: xuất báo cáo theo bố cục chuẩn bên dưới. Không dùng một báo cáo Markdown dài thay thế khi thành phần giao diện tương tác có sẵn.
- Mọi tiêu đề mục, tên nút và nhãn điều khiển VIẾT HOA. Nội dung giải thích ngắn gọn tiếng Việt bình thường.
- Icon vector thống nhất; không emoji tiêu đề, không các thẻ số liệu khổng lồ; không bỏ nút thao tác.
- Nếu giao diện tương tác không được nền tảng hỗ trợ: bản chữ dự phòng thật gọn, vẫn theo thứ tự và có đầy đủ đường dẫn hồ sơ.

## BCCT BỐ CỤC — STRICT ORDER
1. Header duy nhất `TIGERIQ / BCCT`, giờ/nguồn kiểm tra, nhãn FRESH / SNAPSHOT (ghi tiếng Việt).
2. Thanh RDC RẤT GỌN NGAY DƯỚI HEADER: nút `RDC 5/5`, nhãn tài khoản ưu tiên và % còn lại, nút `CẬP NHẬT`. Không tự bung 5 thanh; nhấn RDC mới hiện đủ 5 thanh phần trăm, trực tuyến/ngoại tuyến, dữ liệu từ `who_am_i` và `list_devices` cho mỗi tài khoản.
3. Một dòng chỉ số nhỏ: tổng số VIỆC THEO DÕI / ĐANG CHẠY CÓ BẰNG CHỨNG (hoặc CHƯA XÁC MINH) / TIẾN ĐỘ TOÀN HỆ THỐNG có nguồn (hoặc —). Tránh bố cục 3–4 thẻ to.
4. DANH SÁCH CÔNG VIỆC CẦN CHỐT — ưu tiên bước thực thi có thể làm ngay, sau đó blocked/waiting theo P0–P5; có lọc TẤT CẢ / CÓ THỂ LÀM / CHỜ-CHẶN; mỗi hàng tên ngắn, issue #, priority, trạng thái, vector icon, bấm để mở/thu chi tiết. Không gộp OPEN với RUNNING.
5. Chi tiết mở khi bấm: tab `TIẾN TRÌNH` / `ĐIỂM CHẶN` / `BẰNG CHỨNG`; trạng thái nghiệm thu và % chỉ khi có bằng chứng; 2 nút `HỒ SƠ` mở GitHub issue tương ứng, `KIỂM TRA` kích hoạt lượt đối chiếu chỉ đọc mới khi Owner bấm. Nếu có số liệu tốt hơn: timeline/tiến trình giai đoạn, mở rộng chỉ khi được yêu cầu.
6. HẠNG MỤC ĐÃ HOÀN TẤT — một hàng thu gọn, bung mới liệt kê, chỉ khi GitHub/runtime có bằng chứng DONE.
7. Cuối cùng 3 hàng ngắn: `P0 · CẦN CHÚ Ý`, `NHÂN SỰ AI`, `MỐC KẾ TIẾP`.

## SÁU NHÓM NỘI DUNG BẮT BUỘC KHÔNG ĐƯỢC MẤT
- TỔNG TIẾN ĐỘ: ở dòng chỉ số + trạng thái thật.
- HẠNG MỤC CHÍNH: danh sách việc.
- P0 BLOCKER: cuối trang.
- ĐANG XỬ LÝ: phân loại việc có bằng chứng đang chạy với việc đang mở/chờ.
- NHÂN SỰ AI: trạng thái thực chứng, không gán chạy từ GitHub.
- MỐC KẾ TIẾP: hàng cuối.
- RDC 5 tài khoản là tiện ích thứ bảy, luôn nằm trên cùng, chỉ dùng để quan sát.

## CHẤT LƯỢNG VÀ PHẠM VI
- Mọi số liệu mới phải đọc nguồn hiện hành, ghi timestamp; chưa đọc thì `BẢN CHỤP`. Không copy % RDC cũ làm mới.
- Phần trăm nghiệm thu chỉ dùng tử số/mẫu số tiêu chí thực chứng; không tự chế.
- Tên đầy đủ #issue/PR xuất khi xem hồ sơ hoặc trong bằng chứng; hàng danh sách được rút ngắn để dễ quét.
- Không claim READY, RUNNING, DONE thiếu evidence. Tách nguồn GitHub, PC01 RDC và Core worker state.
- Khuyến nghị dùng interactive layout: row, pressable, segmented-control, conditional details, compact bars. Không tạo các nút vô hiệu hay dùng icon như phần trang trí.
- BCCT cấp phép RDC 5TK đọc `who_am_i`, `list_devices` duy nhất; không thực thi lệnh PC01. Giữ Codex explicit-only, App Chrome LOCAL-ONLY, security/payment/production gates.
- Quy định này là hợp đồng nội dung nạp qua TigerIQ; **không thể thay đổi ChatGPT native renderer hoặc ép các phiên chưa tải nguồn**. Chỉ khẳng định xuyên-chat PASS sau nghiệm thu phiên mới có thật.

## CỔNG NGHIỆM THU V5
- Source loader trỏ tới V5; Workflow section 10 trỏ tới V5; #504 dynamic policy trỏ tới V5.
- Kiểm tra chính xác: RDC dưới header, compact one-line metrics, việc và thao tác đầy đủ, nhãn IN HOA, sáu nhóm phủ đủ, no invented %, P0 cổng giữ nguyên.
- CI và Queue Hygiene PASS, main readback PASS.
- Nghiệm thu thực tế một CHAT MỚI với lệnh `bcct` là cổng riêng, CHƯA PASS nếu chưa có test trực tiếp; không đánh tráo source merge với runtime enforcement.
STATE=BCCT_FINAL_V5_CANONICAL_SPEC
