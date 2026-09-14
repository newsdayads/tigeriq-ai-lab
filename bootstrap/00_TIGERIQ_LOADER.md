# TIGERIQ — UNIFIED SOURCE LOADER
Version: 1.0
Status: Bootstrap Entry Point
Priority: P0
Updated: 2026-09-14

## Mục tiêu
Đây là entry point duy nhất để ChatGPT Plus, ChatGPT Go và Gemini Pro nạp TigerIQ theo cùng một Nguồn Sự Thật. Các tài khoản chỉ cần giữ/trỏ tới file Loader này; không duy trì bản sao riêng của 5 file Bootstrap trong từng tài khoản.

## Canonical repository
Repository: `newsdayads/tigeriq-ai-lab`
Branch chuẩn: `main`

## Bootstrap bắt buộc — đọc theo thứ tự
1. `bootstrap/01_TIGERIQ_COMPANY_CONSTITUTION.md`
2. `bootstrap/02_TIGERIQ_WORKFLOW.md`
3. `bootstrap/03_TIGERIQ_AI_EMPLOYEE_MODEL.md`
4. `bootstrap/05_TIGERIQ_BASELINE_DECISIONS.md`
5. `bootstrap/06_TIGERIQ_SOURCE_INDEX.md`

## Dynamic Source of Truth — đọc khi task phụ thuộc trạng thái hiện hành
1. `docs/CURRENT_STATE.md`
2. CENTRAL Issue `#280`
3. Registry Issue `#335`
4. Interaction Policy Issue `#504`
5. Work Order / Issue / PR / evidence liên quan trực tiếp tới task.

## Quy tắc nạp nguồn
- Explicit current instruction của anh Sơn có ưu tiên cao nhất.
- Không dùng chat history, memory, Drive copy hoặc file local làm Nguồn Sự Thật nếu xung đột với repository `main`.
- 5 file Bootstrap trên GitHub là canonical; Drive chỉ là mirror/tham chiếu nếu cần cho giao diện Gemini, không phải authority độc lập.
- Mọi trạng thái runtime, ưu tiên, nhân sự, command mapping, model/provider, issue/PR phải đọc từ nguồn động hiện hành trước khi kết luận.
- Nếu không truy cập được GitHub hoặc không xác minh được file/issue cần thiết: fail closed, báo `BỊ CHẶN / SOURCE_UNAVAILABLE`; không suy đoán từ bản copy cũ.
- Không sửa trực tiếp `main`; thay đổi source phải đi branch → review/gate → merge.

## Quy tắc đồng nhất 3 tài khoản
- ChatGPT Plus: chỉ giữ Loader này trong Project Source hoặc trỏ tới URL raw của Loader nếu giao diện hỗ trợ nguồn web.
- ChatGPT Go: dùng cùng Loader, không tạo bản Bootstrap riêng.
- Gemini Pro: dùng cùng Loader làm nguồn web; Drive không cần giữ 5 bản canonical riêng sau khi migration hoàn tất.
- Khi source thay đổi trên GitHub `main`, cả 3 tài khoản tự đọc cùng phiên bản mới ở lần nạp tiếp theo; không tải lại 5 file thủ công.

## Fail-safe
Nếu Loader hoặc bất kỳ Bootstrap file canonical nào không đọc được, không được tự fallback sang bản `(1)/(2)`, timestamped copy, file cũ trong Drive hay memory. Báo rõ chưa xác minh nguồn.
