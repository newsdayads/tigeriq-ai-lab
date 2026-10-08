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

## OWNER FINAL SCREENSHOT DISPLAY LOCK
- Strictly match the Owner-approved compact dashboard screenshot: single-line heading, narrow RDC control directly beneath, single-line status metrics, compact clickable task rows, collapsed completed section, and three concise bottom sections.
- Preserve colored vector icons and semantic status colors. Avoid giant metric cards or long Markdown prose.
- Keep uppercase section labels and action buttons. Default all task details and RDC details closed; expand only when clicked.
- Each task must retain filter, progress, blocker, evidence, open issue, and read-only refresh actions.
- Derive tasks, completion states and account quotas from freshly checked sources, never screenshot constants.
- This source policy cannot override ChatGPT native rendering or force preexisting sessions to adopt it.
STATE=OWNER_FINAL_SCREENSHOT_LOCK

## OWNER-APPROVED BCCT ACTIONS V6 — 2026-10-08
OWNER_DIRECT=true
SCOPE=BCCT_ACTION_SURFACE|P1_P5_SAFE_CONTINUATION
STATE=APPROVED_SPEC_PENDING_IMPLEMENTATION_AND_ACCEPTANCE

### Điều khiển bắt buộc
- Giữ nguyên bố cục V5; bổ sung một nút ở đầu danh sách: **TỰ XẾP ƯU TIÊN & XỬ LÝ**. Nút phải kích hoạt một thao tác thực sự lên Core qua backend được ủy quyền; không được chỉ thay nhãn hoặc gửi một tin nhắn giả thành công.
- Danh sách có sắp xếp **ƯU TIÊN** theo P0–P5, tính thực thi hiện hành, lợi ích, phụ thuộc; P0 hiển thị để Owner quyết định nhưng tuyệt đối không tự giao/claim. Không sửa PRIORITY gốc trên GitHub khi người dùng chỉ sắp xếp giao diện. Mỗi lần xếp hiển thị tiêu chí và thời điểm nguồn dữ liệu.
- Từng công việc có: **LÀM NGAY**, **GIAO NHÂN SỰ**, **GỠ ĐIỂM CHẶN**, **KIỂM TRA & CHỐT**, **LỊCH SỬ**, ngoài **HỒ SƠ** và **KIỂM TRA** của V5. Chỉ xuất nút thao tác nếu backend thực sự hỗ trợ. Nếu nền tảng ChatGPT không hỗ trợ mutation/connector tương ứng, đổi thành hành động kiểm tra/điều hướng có ghi rõ, tuyệt đối không hiển thị nút thực thi giả.
- **LÀM NGAY**: làm mới trạng thái Core/GitHub, kiểm tra EXECUTABLE + resource scope + lease + hard gate; nếu hợp lệ chỉ tiếp tục bước an toàn của work order đã tồn tại. Không tạo Work Order mới, không tự sửa P0/OWNER_HOLD, không giành lease của writer đang hoạt động. Sau dispatch, đọc lại receipt/trace mới được hiện ĐANG CHẠY.
- **TỰ XẾP ƯU TIÊN & XỬ LÝ**: thuật toán chọn công việc P1–P5 có bước độc lập thực thi được, kiểm tra chuỗi phụ thuộc, ưu tiên việc có thể xử lý ngay trước việc chờ, tránh vòng lặp; gửi một lượt dispatch được chống trùng cho Core hiện hữu; không thêm scheduler, queue hoặc control-plane song song.
- **GIAO NHÂN SỰ**: chỉ lựa chọn trong registry hiện hành theo capability/health/one-writer, không dùng Codex khi thiếu duyệt rõ tên/phạm vi. **GỠ ĐIỂM CHẶN** chỉ đưa ra chẩn đoán và hành động an toàn; cổng credential/permission/Production/financial/destructive/physical bắt buộc duyệt riêng.
- **KIỂM TRA & CHỐT**: đọc bằng chứng nghiệm thu, chỉ kết thúc khi đủ checklist, phản hồi công khai receipt; **LỊCH SỬ** hiển thị event có nguồn và timestamp, không suy diễn. Mọi hành động có idempotency key, quyền, trạng thái bận, phản hồi lỗi minh bạch và nút đọc lại trạng thái.

### Cổng nghiệm thu trước khi tuyên bố hoạt động
1. Kiểm thử thật: sắp xếp không sửa priority GitHub; lọc chờ không phát dispatch; P0/OWNER_HOLD không bị claim; lease hợp lệ không bị chiếm; action bị chặn không phát job; thao tác lặp không tạo job trùng.
2. Kiểm thử nút LÀM NGAY và TỰ XẾP ƯU TIÊN & XỬ LÝ: trace Core + idempotency + readback phản ánh trạng thái thật. Kiểm thử màn hình iPhone và desktop cho các nút, bộ lọc, mở rộng.
3. Rà soát độc lập, CI, kiểm tra an toàn đạt; branch → PR → merge, phát hành web/runtime theo đúng cổng riêng. GitHub main merge KHÔNG đồng nghĩa Production đã phát hành.
4. Ghi riêng trạng thái UI_CHATGPT_NATIVE=NOT_ENFORCEABLE_FROM_REPO. Không khẳng định đã khóa mọi phiên AI chỉ bằng thay đổi GitHub. Không đụng App Chrome LOCAL-only; RDC chỉ dùng đọc hạn mức theo yêu cầu; không dùng Codex mặc định.
