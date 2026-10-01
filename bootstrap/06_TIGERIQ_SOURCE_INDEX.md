# TIGERIQ — SOURCE INDEX
Version: 3.4
Status: Source Architecture
Updated: 2026-10-02

## 1. Mục tiêu
Đồng nhất ChatGPT Plus, ChatGPT Go và Gemini Pro về một entry point nguồn duy nhất, tránh duy trì 3 bộ file thủ công và tránh lệch phiên bản. Authority canonical của TigerIQ nằm trên GitHub, **ngoại trừ App Chrome đã được tách LOCAL-only trên PC01**; các tài khoản AI chỉ giữ/trỏ tới Loader.

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
2. Resolve PREBOOT HARD COMMAND trước generic bootstrap.
3. Nếu message độc lập khớp `LÀM APP CHROME` hoặc alias `APP CHROME` / `APPCHROME` / `AC`: **không tạo/đọc Work Order App Chrome để thực thi**; chuyển sang lane Owner → Vy → PC01 local, đọc marker `D:\TigerIQ\Apps\ChromeController\LocalOnly\LOCAL_ONLY.json` và trạng thái local cần thiết.
4. Với App Chrome, GitHub chỉ cung cấp policy ranh giới và authority công việc/quyền của NV02/NV03/NV04; source/runtime/deploy App Chrome không lấy từ GitHub.
5. Nếu không phải App Chrome: đọc đủ 5 Bootstrap canonical theo Loader.
6. Interaction #504 bắt buộc mọi NEW CHAT: đọc trước phản hồi Owner đầu tiên, kể cả chat thường; đây là authority cho ngôn ngữ + icon + compact layout + mã việc + progress truth.
7. Nếu message chỉ là số nguyên `N`, đọc CENTRAL + registry hiện hành → resolve command trước khi làm.
8. Nếu task phụ thuộc trạng thái hiện hành, đọc `docs/CURRENT_STATE.md`, queue/P0/Work Order và evidence liên quan.
9. Trong cùng phiên hợp lệ, không đọc lặp nguồn tĩnh đã xác minh nếu version/pointer chưa đổi; refresh nguồn động cần thiết trước mutation/kết luận.
10. Nếu GitHub hoặc registry/#504 không truy cập được đối với task TigerIQ thông thường: fail closed; không dùng bản Drive/file upload cũ để suy diễn trạng thái. App Chrome là ngoại lệ LOCAL-only và phải dùng local marker/runtime thay vì fallback sang GitHub App Chrome cũ.

### APP Chrome LOCAL-only policy
`APP_CHROME_PRIMARY_COMMAND=LÀM APP CHROME`
`APP_CHROME_ALIASES=APP CHROME|APPCHROME|AC`
`APP_CHROME_SOURCE_MODE=LOCAL_ONLY`
`APP_CHROME_LOCAL_AUTHORITY=D:\TigerIQ\Apps\ChromeController\LocalOnly\Source`
`APP_CHROME_GITHUB_WORK_ORDER=FORBIDDEN`
`APP_CHROME_GITHUB_DEPLOY=FORBIDDEN`
`APP_CHROME_SYSTEM_MUTATION=FORBIDDEN`

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
- GitHub `main` là nguồn canonical duy nhất của TigerIQ **ngoại trừ App Chrome**; App Chrome dùng local authority đã nêu ở mục 6.

## 12. Regression bắt buộc sau migration
Tối thiểu trên mỗi nền tảng/tài khoản có thể kiểm tra:
1. Loader đọc được và nhận đúng repository/branch.
2. `vy` → đúng danh tính/cách xưng hô.
3. `bc` → dashboard 6 phần, trạng thái lấy từ dynamic source.
4. `đưa prompt làm việc` → đúng một khối Copy bắt đầu `LÀM — NO YAPPING.`.
5. Command đã đăng ký resolve đúng registry.
6. Command không đăng ký/disabled fail closed.
7. Câu hỏi trạng thái trả đúng `CURRENT_STATE.md` hiện hành.
8. `LÀM APP CHROME` và alias `APP CHROME`/`APPCHROME`/`AC` phải resolve sang lane LOCAL-only, không tạo Work Order/PR/deploy GitHub cho App Chrome.
