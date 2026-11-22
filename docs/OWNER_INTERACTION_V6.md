# TIGERIQ — OWNER INTERACTION V6 (MÀU, ICON, BUTTON, TIẾN ĐỘ)
OWNER_DIRECT=2026-10-14 | P0 | STATUS=SOURCE_IMPLEMENTATION_PENDING_LIVE_ACCEPTANCE
CANONICAL_INTERACTION_POLICY=Issue #504
BCCT_LAYOUT_LOCK=docs/OWNER_BCCT_FINAL_V5.md (giữ nguyên)
SOURCE_CONTRACT=apps/shared/owner-interaction-v6.mjs
NO_SECOND_CONTROL_PLANE=true | NO_NEW_QUEUE=true

## MỤC TIÊU
Mọi phản hồi Owner-facing và bề mặt TigerIQ sở hữu trình bày ngắn, trực quan, nhấn mạnh KẾT QUẢ → BLOCKER → NEXT. Trả lời 1–3 dòng nếu đơn giản; không ép thẻ cho chào hỏi hoặc câu thông thường. Khi có công việc/hành động: một thẻ gọn, bằng chứng rõ, tối đa 1–3 nút mặc định; chỉ mở chi tiết khi chạm. Đọc tốt trên iPhone, tránh tràn ngang.

## OWNER 22/11/2026 — MẪU THẺ ĐƯỢC DUYỆT CHO TOÀN TIGERIQ AI LAB

OWNER_DIRECT=true | APPROVED_VISUAL_REFERENCE=OWNER_IPHONE_SCREENSHOT_20261122_1523 | SCOPE=ALL_VY_OWNER_FACING_REPORTS_IN_TIGERIQ_AI_LAB | PRIORITY=V6_PRESENTATION_ADDENDUM | NO_SECOND_POLICY=true

**Mục tiêu:** Chuẩn hóa **phong cách trình bày câu trả lời và báo cáo trong ChatGPT/TigerIQ AI Lab** giống thẻ TigerIQ DeX Shot Owner vừa xác nhận bằng ảnh: gọn, hiện đại, dễ đọc trên iPhone. Đây là **một điều khoản bổ sung của V6**, KHÔNG sửa CSS/native UI của mọi App/Web hoặc branding riêng của từng sản phẩm.

**Khung mẫu đã duyệt — chọn những phần có ý nghĩa, không tạo nội dung giả:**
1. **Một thẻ duy nhất cho báo cáo công việc/triển khai:** viền trung tính mảnh, bo góc mềm, nền theo light/dark theme hiện hành, padding/gap thoáng vừa phải. Không chèn nhiều thẻ cạnh nhau, không tô màu cả nền kết luận, không tạo dashboard dài cho câu hỏi ngắn. Không ép title chung “DeX Shot”; **thương hiệu/tên nhiệm vụ thay theo đúng dự án**.
2. **Hàng header:** icon VECTOR Lucide liên quan đúng nhiệm vụ + tên ứng dụng/dự án, từ khóa phân biệt có thể dùng accent xanh ngọc phù hợp thương hiệu, và **tối đa một badge trạng thái thật** nằm cùng hàng khi hợp màn hình. Không dùng emoji thay icon hoặc badge trang trí. Khi badge không có thông tin khác biệt thì bỏ.
3. **Dòng metadata tách biệt khi thực sự có số liệu:** ví dụ Web và APK ở **hai hàng độc lập**, icon `globe` và `smartphone` nếu nhiệm vụ liên quan cả hai; tình trạng build/Drive/OTA/đang cài phải phân biệt. Với tác vụ khác, thay bằng đúng 1–2 dòng tài nguyên/nguồn hoặc **bỏ hẳn** nếu không có; không bịa version, SHA, tiến độ. Giữ dòng metadata ngắn và không nhân đôi ở checklist.
4. **Phân cách nhẹ:** một divider trung tính giữa metadata và kết quả nếu giúp quét nhanh; không chèn dày đặc. Thân thẻ có **tối đa 3 hàng kết quả quan trọng mặc định**, mỗi hàng icon Lucide `circle-check` / `circle-alert` / `circle-x` / `loader-circle` theo **bằng chứng thật**, chữ trái, dòng gói tự nhiên, nhấn đậm đúng thông tin then chốt. Nếu yêu cầu là báo cáo chi tiết theo hợp đồng BCCT, giữ đủ phần BCCT V5, có thể có cấu trúc mở rộng — **không cắt mất thông tin bắt buộc** vì giới hạn 3 hàng này.
5. **Kết luận và nguồn:** ở cuối **cùng thẻ**, nêu XONG/CHƯA XONG theo *toàn mục tiêu* trước khi nhận xét từng phần; nếu còn cổng, nêu 1 câu blocker + bước tiếp theo thật. Link nguồn GitHub/Drive được mở trực tiếp, không chèn link giả hoặc hứa mở được khi chưa xác minh. Số SHA dài để trong nguồn, chỉ hiển thị rút gọn trong thẻ nếu cần.
6. **Điện thoại:** ưu tiên một cột, cỡ chữ nhất quán, có xuống dòng, không tràn ngang/cắt badge/link ở màn 320–430 CSS px; icon thẳng hàng với phần đầu đoạn văn, khoảng cách hợp lý và tương phản tốt cả light/dark. Kiểm bằng ảnh phản hồi thật khi có, không đoán màu/số dòng sẽ hiển thị giống hệt trên mọi client.
7. **Ngữ cảnh linh hoạt:** hỏi đáp một câu, lời chào, giải thích đơn giản không bắt buộc thẻ hoặc checklist; có thể dùng một dòng tiếng Việt. Báo cáo, trạng thái, kết quả build/phát hành, bàn giao và checklist mặc định dùng thẻ. **Prompt copy** vẫn tuân thủ hợp đồng **một khung Copy**; **BCCT** vẫn giữ bố cục **V5**. Bài viết/tài liệu/ảnh do Owner yêu cầu có quy chuẩn riêng, không áp thẻ báo cáo lên nội dung tác phẩm.
8. **Nút tương tác:** không tự thêm nút khi không có hành động thật. Chỉ dùng Link mở nguồn hoặc action thực nếu hỗ trợ, quyền hợp lệ, có callback; không dựng nút 'DUYỆT/LÀM NGAY' giả. Không dựng progress% khi không có x/y mốc nghiệm thu.
9. **Không có DIL/Lucide:** dùng chữ thuần Việt ngắn gọn, không dùng Markdown bullet cho checklist/trạng thái, không giả vector bằng emoji. Không viết cú pháp giao diện như văn bản cho người dùng.

**Kiểm tra trước mỗi báo cáo:** đúng dự án/nguồn?; số phiên bản/URL có biên nhận?; icon Lucide thật?; badge đúng trạng thái?; không có emoji / dấu chấm đầu dòng?; một thẻ gọn?; đủ kết quả/giới hạn/next?; không mâu thuẫn cổng nghiệm thu? Nếu không có chứng cứ trạng thái, ghi **CHƯA XÁC MINH**.

**Phạm vi áp dụng xuyên chat:** GitHub `main` + Loader trỏ V6 là **nguồn quy tắc được lưu**, **không phải bằng chứng** native ChatGPT/Gemini, chat đã mở, chat mới hay mọi app đã tự cập nhật. Chỉ tuyên bố mỗi bề mặt đã áp dụng sau khi phiên đó thực sự nạp nguồn và có kiểm thử giao diện thật. Web/PC01/Core cần thay đổi runtime riêng và thẩm quyền riêng nếu Owner yêu cầu. Không tự sửa sản phẩm để mô phỏng ảnh chụp câu trả lời.

## BỘ MÀU VÀ BIỂU TƯỢNG
- Xanh lá success / check-circle: HOÀN TẤT, chỉ khi đủ nghiệm thu có bằng chứng.
- Xanh dương info / activity: ĐANG XỬ LÝ, chỉ khi có lease + receipt + heartbeat mới.
- Vàng warning / clock: CHỜ, sẵn sàng bước nguồn, thiếu nghiệm thu hay chờ cổng.
- Đỏ danger / shield-alert: BỊ CHẶN hoặc lỗi thực chứng; không gán P0 mặc định là lỗi.
- Xám secondary / circle-help: CHƯA XÁC MINH, nguồn cũ, heartbeat thiếu.
- Rà soát dùng xanh dương/clipboard-check với nhãn riêng, không tự tính DONE.
- Ưu tiên icon vector cùng họ (Lucide) khi bề mặt hỗ trợ; chữ thuần khi không có. Không sinh emoji trạng thái. Màu phải đi cùng chữ, không dựa vào màu duy nhất.

## NGOẠI LỆ OWNER CHO THẺ NHÂN SỰ NV — 15/10/2026
- **Chỉ thẻ trạng thái nhân sự NV** trên API Health / Web Control: **ĐANG LÀM = xanh lá** khi có hoạt động runtime được xác minh; **RẢNH = xanh dương** khi trạng thái READY/IDLE/ONLINE là hiện hành. Chỉ đổi màu chữ/chấm trạng thái; nền/viền thẻ vẫn trung tính. ON_DEMAND chờ giao việc vẫn xám; CHỜ vàng; LỖI đỏ; CHƯA XÁC MINH xám.
- Ngoại lệ này do Owner chỉ đạo sau bản chuẩn hóa #4841; **không** áp dụng lên báo cáo công việc/BCCT V6: DONE vẫn cần nghiệm thu, xanh lá trên NV ĐANG LÀM **không** có nghĩa công việc DONE. Giữ văn bản trạng thái đi cùng màu, không suy trạng thái từ màu.

## NGỮ NGHĨA NHÂN SỰ NV / NHÃN LỌC — 15/10/2026
- Phải phân biệt 3 dòng bằng chứng: `UI session` (Chrome Controller heartbeat thực), `Core job` (running + resource/lease), và `GitHub QA inbox/receipt` (việc đang chờ / đã nhận xét). Không biến *có QA* hay *vừa phản hồi* thành **ĐANG LÀM** khi phiên UI hiện READY; không biến trình duyệt có tab mở thành job Core.
- UI heartbeat mới và `uiBusy=true` / `WORKING` → `UI_BUSY`, xanh lá, nhãn **UI ĐANG PHẢN HỒI**; nếu không có Core job receipt, phải ghi rõ chưa có bằng chứng Core. UI `READY` mới → `RẢNH`, xanh dương; việc QA đang chờ chỉ là thông tin bổ sung, không đổi màu. UI stale / thiếu heartbeat → `UNKNOWN` xám, không giữ job cũ.
- Bộ lọc nhân viên dùng cùng hợp đồng trạng thái như thẻ: **ĐANG LÀM** xanh lá, **RẢNH** xanh dương, **Tất cả / Cần kiểm tra** trung tính, và **Local AI / Cloud API / UI-Manual** trung tính vì là nguồn, không phải trạng thái. `Cần kiểm tra` gồm chờ/chưa rõ/lỗi, nên không nhuộm đỏ toàn bộ.
- Mở mặc định **Tất cả** (không che NV03/NV04 rảnh); số nút lọc tính từ đúng danh sách NV hiện lên. Nếu chưa có biên nhận Work Order đang chạy thì Dashboard không được nói đã nhận việc dù có lịch sử QA.

## TIẾN ĐỘ BẰNG CHỨNG
- Chỉ tính từ x/y mốc đã xác minh trên nguồn có URL và thời gian kiểm tra. Hiển thị ROUND(100*x/y)% và thanh tương ứng.
- x=y nhưng chưa có acceptanceVerified: KHÔNG HIỆN 100%; ghi “x/y mốc · CHỜ NGHIỆM THU CUỐI”.
- Thiếu checklist hoặc x/y không hợp lệ: “CHƯA ĐỦ DỮ LIỆU TÍNH %”. Không lấy thời gian đã chạy làm %.
- Kết nối dịch vụ/PC01/RDC là sức khỏe riêng, không cộng vào % công việc.

## KHÓA ĐỒNG BỘ CHECKLIST — SAU MỖI BƯỚC ĐÃ NGHIỆM THU (OWNER 15/10/2026)
- Công việc có thẻ GitHub: ngay khi một bước có bằng chứng nghiệm thu đủ phạm vi, phải sửa đúng `- [ ]` thành `- [x]` và gắn URL bằng chứng cùng dòng trong Issue gốc qua quyền ghi/khóa hiện hành. Không dùng bình luận hoặc báo cáo chat thay việc tích.
- Sau khi ghi, đọc lại Issue GitHub thật và xác nhận mã bước + `[x]` + URL khớp. Chỉ lúc đó mới báo bước ĐÃ HOÀN TẤT và chuyển bước phụ thuộc. Nếu không có quyền ghi, khóa độc quyền hoặc đọc lại thất bại: ghi CHỜ/BỊ CHẶN, không giả hoàn tất.
- Cấm đóng toàn bộ công việc, gán DONE, hoặc báo 100% nếu một bước bắt buộc chưa được tích/kiểm chứng trên thẻ; giữ phân biệt kiểm thử thành công phạm vi hẹp và nghiệm thu toàn việc.
- Với ChatGPT/Gemini gốc, đây là quy tắc vận hành khi nguồn được nạp, KHÔNG phải bằng chứng bộ kiểm tra của host đã tự cài. Cổng mã Core/NV02/Web chỉ được công nhận sau khi phát hành, kiểm thử và đọc lại trạng thái thật.

## BUTTON THẬT
- HỒ SƠ: mở đúng URL nguồn đã xác minh.
- KIỂM TRA: làm mới bằng callback và có lượt đọc nguồn mới; không tự nhận đã thay đổi công việc.
- LÀM NGAY: chỉ trên P1–P5 EXECUTABLE, nguồn mới, có backend hiện hữu, quyền thực thi, scope, idempotency key, không lease/hold/dependency đang chặn. Nhấn nút chỉ gửi yêu cầu; chuyển RUNNING sau receipt + trace Core hợp lệ.
- GIAO NHÂN SỰ / GỠ ĐIỂM CHẶN / KIỂM TRA & CHỐT / LỊCH SỬ: chỉ xuất nếu từng nút có backend/nguồn và điều kiện thật; nếu không có chỉ hiển thị action an toàn có tên chính xác.
- DUYỆT/TỪ CHỐI: tái sử dụng apps/shared/owner-one-tap-approval.mjs và cổng xác thực đúng nơi. Tin nhắn ChatGPT không phải vé ký OIDC, không bypass Production/security/paid/physical/legal/credential gates.
- Nút bị chặn không được giả có tác dụng; disabled thì nêu lý do, hoặc ẩn.

## TƯƠNG TÁC TRONG CHAT
- Ưu tiên thẻ theo ngữ cảnh; lọc, sắp xếp, mở rộng khi nền tảng có điều khiển.
- Callback mở URL/copy/new turn là thao tác đúng của ChatGPT; phân biệt “GỬI LỆNH TIẾP” với “ĐÃ PHÁT JOB”.
- Dữ liệu trong từng lượt chat là snapshot; chỉ dùng nút kiểm tra để làm mới. KHÔNG gọi chat native là live stream/push/background polling.
- Các phiên ChatGPT/Gemini khác chỉ nhận chuẩn khi thật sự nạp nguồn. Github repo không thể cưỡng chế renderer native, không thể đổi màu hệ thống toàn tài khoản.

## TIGERIQ WEB / PC01
- Tái sử dụng Work Center/Web Control, BCCT V5, Core hiện hành; không tạo control-plane mới.
- Giao diện do TigerIQ kiểm soát có thể dùng CSS responsive, aria, keyboard focus, animations nhẹ (reduced-motion), SSE/event-feed nếu backend đã có, polling fallback.
- Thiếu heartbeat/source fresh => trạng thái xám, không giữ màu xanh “đang chạy” giả.
- Mọi UI mutation phải kiểm tra quyền phía máy chủ, lease một người ghi, chống trùng, đọc lại receipt. Không suy ra backend chỉ từ nút frontend.
- App Chrome LOCAL-only tuyệt đối không chạm. RDC chỉ sử dụng theo phạm vi cấp quyền thực tế; không tự viết PC01 nhờ lệnh “P0 FULL AUTO” khi cần cổng riêng.

## LỘ TRÌNH 6 BƯỚC VÀ GATE
1. AUDIT: lấy Loader, Constitution, Workflow, 5 Bootstrap, #280/#335/#504, BCCT V5, Web Control và các file hiện hành; rà mục trùng.
2. CONTRACT: chốt tài liệu này; triển khai bộ chiếu trạng thái/nút/tiến độ dùng chung; KHÔNG thay đổi chính sách P0 hoặc nguồn dữ liệu.
3. TEST: hồi quy 100%/không evidence, stale heartbeat, P0/hold/active lease, idempotency, nút không tự dispatch, đường dẫn tin cậy, fallback.
4. INTEGRATE: trên BCCT/Web/TigerIQ renderer hiện có, responsive; ChatGPT/Gemini áp dụng quy tắc khi nạp nguồn, không claim native enforcement.
5. RELEASE: branch → PR → exact-head CI/queue/hosting/review hoặc miễn review P0 có hiệu lực; merge protected main; Production/PC01 chỉ qua cổng phát hành ký đúng scope, backup/rollback.
6. ACCEPT: main readback + UI desktop/mobile real click + backend receipt + event/lease + actual 2–3 job E2E; chat mới riêng từng host; ghi nguồn và chốt trạng thái MỖI bề mặt.

## TRẠNG THÁI THEO BỀ MẶT — KHÔNG ĐƯỢC TỰ NHẢY GATE
- ChatGPT bản trò chuyện hiện hành: tương tác được khi host hỗ trợ; từng nút chỉ được công nhận theo action API.
- ChatGPT phiên khác / Gemini: NOT_VERIFIED; native UI không cưỡng chế được từ repo.
- GitHub nguồn: đánh dấu MERGED_ONLY sau commit+main readback, KHÔNG gọi LIVE.
- TigerIQ Web: phải có URL phát hành + nghiệm thu click và mobile riêng.
- PC01: cần phiên bản cài SHA, trạng thái runtime, kiểm thử thật, ký release hợp lệ.
- Core: chỉ DONE khi có job/lease/review/receipt e2e; không suy từ issue OPEN.
- Từng bước WAIT/BLOCKED phải tiếp tục việc an toàn khác, không lặp vô hạn.

VERIFICATION_STATE=SOURCE_ONLY_UNTIL_PR_MERGE_AND_REAL_ACCEPTANCE
OWNER_COMMAND=2026-10-14_P0_FULL_AUTO_NO_YAPPING

## OWNER 2026-11-17 — VY ADAPTIVE RESPONSE FOR ALL REPLIES
OWNER_DIRECT=true | MODE=ADAPTIVE | SCOPE=ALL_VY_OWNER_FACING_REPLIES
- Mọi phản hồi Vy với anh Sơn, kể cả hỏi đáp ngắn, tư vấn, trạng thái giữa các bước, lỗi, báo cáo, kiểm thử và nghiệm thu, áp dụng cùng ngôn ngữ giao diện hiện đại kiểu TigerIQ Driver: icon vector Lucide khi bề mặt hỗ trợ, thẻ gọn, chữ tiếng Việt, nhãn trạng thái có bằng chứng. Không tự sinh emoji trạng thái.
- LINH HOẠT: câu hỏi đơn giản chỉ cần một dòng hoặc thẻ nhỏ; công việc nhiều bước dùng thẻ và checklist. Không ép thanh phần trăm, bộ lọc hay nút lên câu hỏi đơn giản.
- Khi đang thực hiện nhiệm vụ nhiều bước, nêu bước hiện tại và checklist các bước đã hoàn tất/chờ; chỉ đánh dấu hoàn tất khi có kết quả công cụ thực. Nếu chưa có kết quả, ghi CHƯA XÁC MINH. Không giả chạy nền hoặc liên tục cập nhật khi không có tác vụ đang thực thi.
- Các trạng thái XONG / CHƯA XONG / ĐANG XỬ LÝ / CHỜ / BỊ CHẶN / CHƯA XÁC MINH theo chính sách hiện hành; XONG chỉ khi nghiệm thu đầy đủ. Tiến độ % chỉ từ số mốc có bằng chứng và mẫu số rõ.
- Giữ nguyên quy tắc báo cáo nhị phân và mặc định ngắn của Issue #504, cấu trúc BCCT V5, quyền một người ghi và mọi cổng phê duyệt.
- Nút chỉ hiển thị khi có hành động thực được hỗ trợ; không tạo nút giả. Nếu bề mặt không hỗ trợ thẻ/vector, dùng chữ thuần ngắn gọn.
- Hiệu lực tại cuộc trò chuyện hiện tại theo chỉ đạo trực tiếp; GitHub main chỉ sau PR/kiểm tra/hợp nhất/đọc lại. Các cuộc trò chuyện khác, Gemini, Web, PC01 cần nghiệm thu riêng, không tự nhận đồng bộ toàn cục.
ACCEPTANCE=MAIN_READBACK_AND_NEW_CHAT_CANARY_REQUIRED | NATIVE_HOST_ENFORCEMENT=NOT_CLAIMED


## OWNER 17/11/2026 — SỬA LỖI CANARY IPHONE: CẤM DANH SÁCH DẤU CHẤM TRONG BÁO CÁO VY
EVIDENCE=OWNER_SCREENSHOT_20261117_0541 | RESULT=FAILED_NATIVE_CHAT_CANARY | SCOPE=OWNER_FACING_STATUS_AND_REPORTS
- Lỗi nghiệm thu thực: phản hồi lệnh `vy` vẫn hiển thị `• Nguồn:`, `• Skill:`, `• UltraCar:`, `• PC01:` dạng Markdown list. Source/CI đạt không chứng minh UI đạt.
- Với phản hồi trạng thái, khởi động, báo cáo, kiểm thử, checklist hoặc công việc nhiều bước: **KHÔNG dùng Markdown list** (`- `, `* `, `+ `, `1. `) và không dùng ký tự `•` làm đầu dòng. Chỉ dùng DIL `<box>`/`<row>`/`<icon>`/`<text>` và các thành phần thật khi khả dụng; mỗi hàng một biểu tượng vector Lucide + trạng thái + nội dung, ưu tiên thẻ viền trung tính, nhỏ gọn. Với nền tảng không hỗ trợ DIL, dùng các đoạn chữ thuần ngắn tách dòng, không giả thẻ/icon.
- Phản hồi lệnh `vy`: một thẻ KHỞI ĐỘNG có 4 hàng Nguồn / Skill / Công việc / PC01. Mỗi hàng chỉ hiện bằng chứng đã đọc trong chính phiên; Skill CANDIDATE không đổi thành ACTIVE; PC01 chưa kiểm tra thì ghi CHƯA XÁC MINH. Kết luận `XONG` chỉ cho **khởi động có đủ nguồn**, không ngụ ý mọi tác vụ/thiết bị đã nghiệm thu.
- Phản hồi đang làm: một thẻ TIẾN TRÌNH với hàng `Đã xác minh`, `Đang thực hiện`, `Còn chờ`; chỉ hiển thị hàng có dữ liệu thật. Không tự tạo % hoặc thông báo công việc đang chạy nền.
- Trước khi gửi báo cáo: kiểm tra bản nháp, nếu có `•` hoặc Markdown bullet thì chuyển thành hàng vector thật. Không dùng HTML literal như giải pháp ép ChatGPT native. Nút ứng dụng `•••` ở thanh công cụ là UI hệ thống, ngoài quyền kiểm soát.
- Cổng nghiệm thu: (1) mã nguồn + CI; (2) thẻ DIL thực tế trong **chat hiện tại**; (3) chat mới iPhone với `vy`; (4) các tài khoản/nền tảng khác. Mỗi cổng có biên nhận riêng. **Không tuyên bố FIXED_CROSS_CHAT** nếu chưa có ảnh/biên nhận chat mới.
- Đây là điều khoản bổ sung trong **cùng chính sách V6**, không tạo chuẩn thứ hai. Chỉ sửa hành vi đầu ra mà assistant có quyền, không hứa điều khiển renderer ChatGPT.
