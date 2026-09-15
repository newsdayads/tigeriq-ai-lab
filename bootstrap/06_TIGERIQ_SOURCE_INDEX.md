# TIGERIQ — SOURCE INDEX
Version: 3.0
Status: Source Architecture
Updated: 2026-09-14

## 1. Mục tiêu
Đồng nhất ChatGPT Plus, ChatGPT Go và Gemini Pro về một entry point nguồn duy nhất, tránh duy trì 3 bộ file thủ công và tránh lệch phiên bản. Authority canonical nằm trên GitHub; các tài khoản AI chỉ giữ/trỏ tới Loader.

## 2. Single Source Entry Point
Canonical entry point:
- Repository: `newsdayads/tigeriq-ai-lab`
- Branch: `main`
- Loader: `bootstrap/00_TIGERIQ_LOADER.md`

ChatGPT Plus, ChatGPT Go và Gemini Pro phải dùng cùng Loader này. Không tạo bộ Bootstrap riêng cho từng tài khoản.

## 3. Canonical Bootstrap trên GitHub
Loader nạp theo thứ tự:
1. `bootstrap/01_TIGERIQ_COMPANY_CONSTITUTION.md`
2. `bootstrap/02_TIGERIQ_WORKFLOW.md`
3. `bootstrap/03_TIGERIQ_AI_EMPLOYEE_MODEL.md`
4. `bootstrap/05_TIGERIQ_BASELINE_DECISIONS.md`
5. `bootstrap/06_TIGERIQ_SOURCE_INDEX.md`

Tên file cố định; version nằm trong nội dung.

## 4. Dynamic Source of Truth
Repository: `newsdayads/tigeriq-ai-lab`.

Stable locators:
- `docs/CURRENT_STATE.md` — trạng thái hiện hành.
- CENTRAL authoritative queue/router: Issue `#280`.
- Command/AI Employee Registry hiện hành: Issue `#335` hoặc pointer mới do CENTRAL chỉ định.
- Interaction policy: Issue `#504` hoặc pointer mới do CENTRAL chỉ định.
- P0 issues / Work Orders đang mở.
- `docs/evidence/**` và evidence tham chiếu.
- `docs/ADR/**`, architecture, implementation docs.
- CI/review/deployment/release records.

## 5. Precedence
1. Explicit current instruction của anh Sơn/Owner.
2. `bootstrap/01_TIGERIQ_COMPANY_CONSTITUTION.md`.
3. Approved Architecture/Security constraints.
4. `bootstrap/02_TIGERIQ_WORKFLOW.md`.
5. `bootstrap/06_TIGERIQ_SOURCE_INDEX.md`.
6. `bootstrap/03_TIGERIQ_AI_EMPLOYEE_MODEL.md`.
7. `bootstrap/05_TIGERIQ_BASELINE_DECISIONS.md`.
8. Dynamic governance/policy/Command Registry/AI Employee Registry — chỉ bổ sung trong core authority envelope.
9. `docs/CURRENT_STATE.md` + authoritative queue/work/evidence.
10. Drive mirror, chat history, memory, agent assumptions.

Nếu nguồn thấp hơn xung đột nguồn cao hơn, nguồn thấp hơn không được override.

## 6. NEW CHAT loading contract
1. Đọc `bootstrap/00_TIGERIQ_LOADER.md` từ GitHub `main`.
2. Đọc 5 Bootstrap canonical theo Loader.
3. Nếu message chỉ là số nguyên `N`, đọc CENTRAL #280 → registry hiện hành → resolve command trước khi làm.
4. Nếu task phụ thuộc trạng thái hiện hành, đọc `docs/CURRENT_STATE.md`, queue/P0/Work Order và evidence liên quan.
5. Nếu GitHub hoặc registry không truy cập được: fail closed; không dùng bản Drive/file upload cũ để suy diễn trạng thái.

## 7. Chính sách cho 3 tài khoản
### ChatGPT Plus
- Project chỉ cần giữ một Loader ổn định hoặc một nguồn web/link tương đương nếu giao diện hỗ trợ.
- Không giữ 5 bản Bootstrap thủ công sau khi migration hoàn tất.

### ChatGPT Go
- Dùng cùng Loader; không tạo file riêng cho Go.
- Cùng repo, cùng branch, cùng dynamic sources.

### Gemini Pro
- Dùng cùng Loader qua nguồn web.
- Các file Drive Bootstrap cũ được bỏ khỏi Gemini Source sau khi regression đạt.
- Drive có thể giữ mirror để người dùng xem/chỉnh khi cần, nhưng không phải authority.

## 8. Phân loại thay đổi
### KHÔNG cần thay Loader
- trạng thái/tiến độ/P0-P2;
- bug/fix/Work Order/issue;
- model/API/provider/runtime/benchmark/deployment;
- command/employee/mapping/role/capability trong authority envelope;
- lease timeout/takeover policy/UI label/runtime binding;
- thay đổi nội dung bên trong 5 Bootstrap canonical miễn đường dẫn và loading contract không đổi.

### BẮT BUỘC thay Loader
Chỉ khi thay đổi:
1. Repository/branch canonical.
2. Danh sách/đường dẫn Bootstrap canonical.
3. Dynamic-source locator bắt buộc.
4. Generic source-loading/fail-closed contract.
5. Quy tắc single-entry-point cho các tài khoản.

## 9. Migration khỏi mô hình 5 file thủ công
Sau khi PR migration được merge `main` và regression đạt:
1. ChatGPT Plus: bỏ 5 file Bootstrap cũ khỏi Project Source, giữ/thêm 1 Loader.
2. ChatGPT Go: bỏ mọi Bootstrap copy riêng, giữ/thêm cùng 1 Loader.
3. Gemini Pro: bỏ 5 file Drive khỏi Nguồn; giữ 1 Loader web. Có thể giữ các nguồn web động riêng trong giai đoạn kiểm thử, sau đó Loader chịu trách nhiệm chỉ đường.
4. Không xóa file Drive thật nếu còn dùng làm mirror; chỉ bỏ khỏi nguồn AI để tránh trùng authority.

## 10. Drive mirror policy
- Drive `TigerIQ AI Lab/00_BOOTSTRAP` chỉ là mirror/reference.
- Không chỉnh Drive rồi coi là đã đổi policy canonical.
- Mọi thay đổi canonical phải đi GitHub branch → review/gate → merge.
- Nếu cần mirror Drive, cập nhật sau merge từ GitHub canonical.

## 11. Source hygiene
- Không dùng `(1)(2)(3)` hoặc timestamp trong canonical filename.
- Không giữ nhiều authority cho cùng một policy.
- Chat không authoritative.
- Drive không authoritative.
- GitHub `main` là nguồn canonical duy nhất.

## 12. Regression bắt buộc sau migration
Tối thiểu trên mỗi nền tảng/tài khoản có thể kiểm tra:
1. Loader đọc được và nhận đúng repository/branch.
2. `vy` → đúng danh tính/cách xưng hô.
3. `bc` → dashboard 6 phần, trạng thái lấy từ dynamic source.
4. `đưa prompt làm việc` → đúng một khối Copy bắt đầu `LÀM — NO YAPPING.`.
5. Command đã đăng ký resolve đúng registry.
6. Command không đăng ký/disabled fail closed.
7. Câu hỏi trạng thái trả đúng `CURRENT_STATE.md` hiện hành.
