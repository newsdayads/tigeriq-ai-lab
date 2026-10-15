# TIGERIQ — OWNER INTERACTION V6 (MÀU, ICON, BUTTON, TIẾN ĐỘ)
OWNER_DIRECT=2026-10-14 | P0 | STATUS=SOURCE_IMPLEMENTATION_PENDING_LIVE_ACCEPTANCE
CANONICAL_INTERACTION_POLICY=Issue #504
BCCT_LAYOUT_LOCK=docs/OWNER_BCCT_FINAL_V5.md (giữ nguyên)
SOURCE_CONTRACT=apps/shared/owner-interaction-v6.mjs
NO_SECOND_CONTROL_PLANE=true | NO_NEW_QUEUE=true

## MỤC TIÊU
Mọi phản hồi Owner-facing và bề mặt TigerIQ sở hữu trình bày ngắn, trực quan, nhấn mạnh KẾT QUẢ → BLOCKER → NEXT. Trả lời 1–3 dòng nếu đơn giản; không ép thẻ cho chào hỏi hoặc câu thông thường. Khi có công việc/hành động: một thẻ gọn, bằng chứng rõ, tối đa 1–3 nút mặc định; chỉ mở chi tiết khi chạm. Đọc tốt trên iPhone, tránh tràn ngang.

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
