# TIGERIQ — UNIFIED SOURCE LOADER
Version: 1.2
Status: Bootstrap Entry Point
Priority: P0
Updated: 2026-09-15

## Mục tiêu
Đây là entry point duy nhất để ChatGPT Plus, ChatGPT Go và Gemini Pro nạp TigerIQ theo cùng một Nguồn Sự Thật. Mỗi tài khoản chỉ cần giữ hoặc trỏ tới Loader này; không duy trì bản sao riêng của 5 file Bootstrap.

## Canonical repository
Repository: `newsdayads/tigeriq-ai-lab`
Branch chuẩn: `main`
Loader path: `bootstrap/00_TIGERIQ_LOADER.md`
Loader page: `https://github.com/newsdayads/tigeriq-ai-lab/blob/main/bootstrap/00_TIGERIQ_LOADER.md`

## Bootstrap bắt buộc — đọc theo thứ tự
1. `bootstrap/01_TIGERIQ_COMPANY_CONSTITUTION.md`
2. `bootstrap/02_TIGERIQ_WORKFLOW.md`
3. `bootstrap/03_TIGERIQ_AI_EMPLOYEE_MODEL.md`
4. `bootstrap/05_TIGERIQ_BASELINE_DECISIONS.md`
5. `bootstrap/06_TIGERIQ_SOURCE_INDEX.md`

## Dynamic Source of Truth — đọc khi task phụ thuộc trạng thái hiện hành
1. `docs/CURRENT_STATE.md`
2. CENTRAL: `https://github.com/newsdayads/tigeriq-ai-lab/issues/280`
3. Registry: `https://github.com/newsdayads/tigeriq-ai-lab/issues/335`
4. Interaction Policy: `https://github.com/newsdayads/tigeriq-ai-lab/issues/504`
5. Work Order / Issue / PR / evidence liên quan trực tiếp tới task.

## Quy tắc truy cập nguồn — connector first
- Khi tài khoản đã kết nối GitHub, PHẢI đọc file bằng GitHub connector theo `repository + branch + path`; KHÔNG suy ra 404 chỉ vì `raw.githubusercontent.com` không đọc được qua web fetch.
- ChatGPT Plus/Go: ưu tiên GitHub connector. Với file canonical, dùng repo `newsdayads/tigeriq-ai-lab`, branch `main`, và path nêu trong Loader.
- Gemini Pro: authority vẫn là GitHub `main`; nếu giao diện nguồn không hỗ trợ GitHub connector ổn định thì dùng Google Doc mirror `00_TIGERIQ_GEMINI_SOURCE` được đồng bộ từ GitHub. Mirror không được override GitHub canonical.
- Raw URL chỉ là phương án phụ khi nền tảng xác nhận đọc được; không phải cơ chế bắt buộc để xác minh source.

## Quy tắc nạp nguồn
- Explicit current instruction của anh Sơn có ưu tiên cao nhất.
- Không dùng chat history, memory, Drive copy hoặc file local làm Nguồn Sự Thật nếu xung đột với repository `main`.
- 5 file Bootstrap trên GitHub là canonical; Drive chỉ là mirror/tham chiếu nếu cần cho giao diện, không phải authority độc lập.
- Mọi trạng thái runtime, ưu tiên, nhân sự, command mapping, model/provider, issue/PR phải đọc từ nguồn động hiện hành trước khi kết luận.
- Nếu GitHub connector không truy cập được file/issue cần thiết sau khi thử đúng repo/branch/path: fail closed, báo `BỊ CHẶN / SOURCE_UNAVAILABLE`; không suy đoán từ bản copy cũ.
- Không sửa trực tiếp `main`; thay đổi source phải đi branch → review/gate → merge.

## Quy tắc đồng nhất 3 tài khoản
- ChatGPT Plus: dùng Loader + GitHub connector để đọc canonical source theo path.
- ChatGPT Go: dùng cùng Loader + GitHub connector; không tạo Bootstrap riêng.
- Gemini Pro: dùng mirror `00_TIGERIQ_GEMINI_SOURCE` khi giao diện bắt buộc, nhưng mirror phải được đồng bộ từ cùng GitHub canonical.
- Khi source thay đổi trên GitHub `main`, 3 tài khoản phải quy về cùng canonical content; khác nhau chỉ ở adapter truy cập của từng nền tảng.

## Hành vi bắt buộc khi bắt đầu phiên
1. Xác định adapter nguồn khả dụng của tài khoản hiện tại.
2. Nếu có GitHub connector, đọc Loader theo repo/branch/path; không dùng raw URL làm điều kiện thành công duy nhất.
3. Đọc 5 Bootstrap canonical theo danh sách trên.
4. Nếu câu hỏi phụ thuộc trạng thái hiện hành, đọc CURRENT_STATE + CENTRAL/Registry/Interaction + tài liệu liên quan.
5. Chỉ sau khi hoàn tất bước nạp nguồn mới kết luận hoặc thực thi.

## Fail-safe
Nếu GitHub connector đã được kết nối nhưng một raw URL trả 404, phải thử lại bằng GitHub connector theo repo/branch/path trước khi kết luận SOURCE_UNAVAILABLE. Chỉ khi canonical path vẫn không đọc được mới fail closed; không fallback sang bản `(1)/(2)`, timestamped copy, file cũ trong Drive hay memory.