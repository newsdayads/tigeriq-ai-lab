# TIGERIQ — UNIFIED SOURCE LOADER
Version: 1.1
Status: Bootstrap Entry Point
Priority: P0
Updated: 2026-09-14

## Mục tiêu
Đây là entry point duy nhất để ChatGPT Plus, ChatGPT Go và Gemini Pro nạp TigerIQ theo cùng một Nguồn Sự Thật. Mỗi tài khoản chỉ cần giữ hoặc trỏ tới Loader này; không duy trì bản sao riêng của 5 file Bootstrap.

## Canonical repository
Repository: `newsdayads/tigeriq-ai-lab`
Branch chuẩn: `main`
Loader raw URL: `https://raw.githubusercontent.com/newsdayads/tigeriq-ai-lab/main/bootstrap/00_TIGERIQ_LOADER.md`

## Bootstrap bắt buộc — đọc theo thứ tự
1. `https://raw.githubusercontent.com/newsdayads/tigeriq-ai-lab/main/bootstrap/01_TIGERIQ_COMPANY_CONSTITUTION.md`
2. `https://raw.githubusercontent.com/newsdayads/tigeriq-ai-lab/main/bootstrap/02_TIGERIQ_WORKFLOW.md`
3. `https://raw.githubusercontent.com/newsdayads/tigeriq-ai-lab/main/bootstrap/03_TIGERIQ_AI_EMPLOYEE_MODEL.md`
4. `https://raw.githubusercontent.com/newsdayads/tigeriq-ai-lab/main/bootstrap/05_TIGERIQ_BASELINE_DECISIONS.md`
5. `https://raw.githubusercontent.com/newsdayads/tigeriq-ai-lab/main/bootstrap/06_TIGERIQ_SOURCE_INDEX.md`

## Dynamic Source of Truth — đọc khi task phụ thuộc trạng thái hiện hành
1. `https://raw.githubusercontent.com/newsdayads/tigeriq-ai-lab/main/docs/CURRENT_STATE.md`
2. CENTRAL: `https://github.com/newsdayads/tigeriq-ai-lab/issues/280`
3. Registry: `https://github.com/newsdayads/tigeriq-ai-lab/issues/335`
4. Interaction Policy: `https://github.com/newsdayads/tigeriq-ai-lab/issues/504`
5. Work Order / Issue / PR / evidence liên quan trực tiếp tới task.

## Quy tắc nạp nguồn
- Explicit current instruction của anh Sơn có ưu tiên cao nhất.
- Không dùng chat history, memory, Drive copy hoặc file local làm Nguồn Sự Thật nếu xung đột với repository `main`.
- 5 file Bootstrap trên GitHub là canonical; Drive chỉ là mirror/tham chiếu nếu cần cho giao diện, không phải authority độc lập.
- Mọi trạng thái runtime, ưu tiên, nhân sự, command mapping, model/provider, issue/PR phải đọc từ nguồn động hiện hành trước khi kết luận.
- Nếu không truy cập được GitHub hoặc không xác minh được file/issue cần thiết: fail closed, báo `BỊ CHẶN / SOURCE_UNAVAILABLE`; không suy đoán từ bản copy cũ.
- Không sửa trực tiếp `main`; thay đổi source phải đi branch → review/gate → merge.

## Quy tắc đồng nhất 3 tài khoản
- ChatGPT Plus: Project Source chỉ giữ Loader này hoặc một liên kết web tới Loader nếu giao diện hỗ trợ.
- ChatGPT Go: dùng cùng Loader; không tạo Bootstrap riêng.
- Gemini Pro: dùng đúng Loader raw URL làm nguồn web; không dùng 5 file Drive làm authority sau migration.
- Khi source thay đổi trên GitHub `main`, cả 3 tài khoản đọc cùng phiên bản mới ở lần nạp tiếp theo; không tải lại 5 file thủ công.

## Hành vi bắt buộc khi bắt đầu phiên
1. Đọc Loader hiện hành từ GitHub `main` nếu có web/tool.
2. Đọc 5 Bootstrap canonical theo danh sách trên.
3. Nếu câu hỏi phụ thuộc trạng thái hiện hành, đọc CURRENT_STATE + CENTRAL/Registry/Interaction + tài liệu liên quan.
4. Chỉ sau khi hoàn tất bước nạp nguồn mới kết luận hoặc thực thi.

## Fail-safe
Nếu Loader hoặc bất kỳ Bootstrap file canonical nào không đọc được, không được tự fallback sang bản `(1)/(2)`, timestamped copy, file cũ trong Drive hay memory. Báo rõ chưa xác minh nguồn.
