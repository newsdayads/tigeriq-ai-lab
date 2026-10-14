# TIGERIQ — CHUẨN CỐ ĐỊNH PROMPT COPY MỘT DÒNG V1
OWNER_DIRECT=2026-10-12
SCOPE=OWNER_FACING_PROMPT_HANDOFF
PRIORITY=P0_INTERACTION_POLICY
SOURCE_OF_TRUTH=GitHub main Loader + Workflow §11–12 + Issue #504

## Tín hiệu
Khi anh Sơn yêu cầu `prompt`, `đưa prompt`, `qua Work`, `giao NV` hoặc yêu cầu tương đương để **nhận câu lệnh giao việc có thể sao chép**, phải xuất một khối duy nhất.

## Hình thức không được thay đổi
- **ĐÚNG 01 khung code block native** (Markdown fenced code `text`), có nút **Copy** do nền tảng cung cấp, toàn bộ đầu ra không thêm lời dẫn/chú thích ngoài khung.
- **ĐÚNG 01 dòng vật lý** chứa toàn bộ câu lệnh (không ngắt dòng, không Markdown list, không bảng, không WritingBlock, không nhiều prompt).
- Bắt đầu ngay bằng chuỗi chính xác **`LÀM — NO YAPPING.`**.
- Nội dung sau tiền tố đầy đủ MỤC TIÊU, NGUỒN, THỰC HIỆN, GIỚI HẠN, NGHIỆM THU, BÁO CÁO khi tác vụ cần; có thể dùng dấu chấm phẩy để phân tách trên cùng một dòng.
- Không rút mất điều kiện an toàn, bằng chứng, thẩm quyền hoặc cách nghiệm thu để rút ngắn một dòng. **Trên giao diện TigerIQ tự sở hữu:** bảo đảm CSS `white-space: pre; overflow-x: auto` (không ngắt dòng mềm), khung cao một hàng và cuộn ngang khi dài. Trên ChatGPT native, cách ngắt dòng hình ảnh phụ thuộc trình kết xuất gốc và không thể khóa bằng GitHub.
- Cú pháp bắt buộc phải xuống dòng (ví dụ mã lệnh phụ thuộc newline) là **ngoại lệ theo yêu cầu Owner riêng**, không lén thay đổi luật một-dòng chung.
- Câu hỏi về quy định, thảo luận định dạng hoặc giải thích nội dung prompt **không tự động là yêu cầu xuất prompt**.

## Cổng kỹ thuật trên bề mặt do TigerIQ kiểm soát
- Dùng `validateOwnerPromptCopy` rồi `publishOwnerPromptCopy` từ `apps/shared/owner-prompt-copy-contract.mjs` ở điểm phát câu trả lời trong mỗi ứng dụng thực sự sở hữu renderer; sai hợp đồng phải **không phát xuất**, thay vì phát rồi báo đạt.
- Kiểm thử đúng/vi phạm: dẫn lời trước/sau, nhiều khối, nhiều dòng, sai tiền tố, thiếu nội dung, thiếu emitter.
- Không gắn nhãn ĐẠT / ĐÃ ÁP DỤNG TOÀN HỆ THỐNG khi chưa có đường gọi guard trong renderer, CI trên đúng mã nguồn, bản phát hành thực tế và mẫu kiểm thử prompt của từng bề mặt.
- Trạng thái theo bề mặt: `SOURCE_SPEC`, `GUARD_CODE`, `RUNTIME_WIRED`, `LIVE_CANARY_PASS`; không gộp các trạng thái thành một bằng chứng.
- Đăng ký adapter của các kênh TigerIQ sở hữu riêng (Web/Core, NV02/NV03/NV04, Gemini adapter nếu có quyền điều khiển đầu ra) và thử hai ca thật: prompt ngắn, prompt dài trên iPhone/desktop khi khả dụng.

## Ranh giới nền tảng và quyền
- GitHub/Issue/PR và module JavaScript **không thể ép ChatGPT native render 1 khung/1 dòng trong mọi chat**, không cài tự động lên phiên cũ, không bảo đảm tất cả tài khoản. Phải thêm chỉ dẫn vào Project/GPT/prompt khởi động từng nền tảng được phép, kiểm thử từng phiên/tài khoản, báo rõ FAIL/UNVERIFIED.
- Không thay đổi App Chrome LOCAL-only; không sửa Production, credential, GitHub branch protection, chi phí, hay tự khởi chạy nhân sự/API nếu thiếu thẩm quyền.
- Branch → PR → kiểm thử → review/waiver hợp lệ → hợp nhất có cổng → nghiệm thu trình bày tại môi trường phát hành; không ghi PASS chỉ vì PR tồn tại.

## Mẫu nội dung **trong** một khối Copy (minh họa, không dùng làm dữ liệu nhiệm vụ)
```text
LÀM — NO YAPPING. MỤC TIÊU: [kết quả cần đạt]; NGUỒN: [nguồn thật]; THỰC HIỆN: [bước có thể làm]; GIỚI HẠN: [không vượt quyền]; NGHIỆM THU: [bằng chứng]; BÁO CÁO: KẾT QUẢ → BLOCKER → NEXT ACTION.
```

ACCEPTANCE=NO_CROSS_PLATFORM_RUNTIME_CLAIM_WITHOUT_REAL_CANARY
