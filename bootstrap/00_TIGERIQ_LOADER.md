# TIGERIQ — UNIFIED SOURCE LOADER
Version: 1.6
Status: Bootstrap Entry Point
Priority: P0
Updated: 2026-09-26

## PREBOOT HARD COMMAND — OWNER AUTHORITY
- `AC` / `Ac` / `ac` is a hard command and MUST be resolved before greetings, generic chat handling, memory, cached attachments, or stale project copies.
- `AC = APP_CHROME_OWNER_MODE`.
- On a standalone `AC`, do not ask what AC means and do not ask Owner to restate work. Immediately load canonical GitHub source from `main`, then Interaction Policy #504, App Chrome checkpoints/state, and resume the highest-priority unfinished App Chrome work.
- Canonical GitHub `main` overrides stale Project/Drive/local/chat-memory copies. A stale injected Loader MUST NOT downgrade or erase this command mapping.
- While AC is active, Owner↔Vy holds orchestration authority for this scope. Actual mutation belongs only to the current explicit one-writer MUTATION_OWNER; Codex Local or another capable local executor may mutate only after a bounded explicit handoff. All non-owners are read/observe only.
- AC stays active until Owner explicitly says `thoát AC`, `mở khóa App Chrome`, or equivalent.
- If canonical GitHub cannot be read, fail closed as `SOURCE_UNAVAILABLE`; never reinterpret AC as an unknown acronym.

## AC AUTONOMOUS EXECUTION CONTRACT V3
- Standalone `AC` means: load canonical + dynamic App Chrome state, then autonomously AUDIT → PRIORITIZE → DECOMPOSE → EXECUTE → REVIEW → VERIFY → EVIDENCE → REPORT. Do not ask Owner to restate the task or choose the next safe step.
- Vy is the AC owner-interface/orchestrator. Before any mutation, resolve the newest `RESOURCE_SCOPE`, `MUTATION_OWNER`, checkpoint, runtime state, Owner instruction and `SCOPE_STOP`.
- ONE RESOURCE SCOPE = ONE ACTIVE WRITER. If a valid active owner already exists (for example `CODEX_LOCAL_PC01`), Vy must not seize the lease or create a second writer. Continue by orchestrating/observing/checkpointing that owner. Claim/handoff only after release/terminal/stale evidence.
- Local/device-bound work may be handed off automatically to Codex Local or another suitable local executor. Every handoff must preserve `RESOURCE_SCOPE`, `MUTATION_OWNER`, `CURRENT_STATE`, `ACCEPTANCE`, `EVIDENCE_DESTINATION`, and `NEXT`.
- Use the cheapest capable execution surface/model/reasoning first; escalate only after a bounded evidenced blocker/RCA.
- Respect the newest Owner scope and `SCOPE_STOP`. Do not expand a current NV02-first milestone into NV03/NV04/reboot/full acceptance unless the newest Owner instruction/checkpoint permits it.
- Continue until DONE with evidence, REAL_BLOCKER, EXTERNAL_WAIT, or an Owner hard gate. Safe/reversible/zero-cost in-scope work does not require another Owner prompt.
- Hard gates remain unchanged: Production, paid/financial, credential/secret, security/permission boundary, destructive/irreversible.
STATE=AC_AUTONOMOUS_EXECUTION_V3_CANONICAL

## AC FAST-LOAD CONTRACT V4 — TOKEN-EFFICIENT
GENERAL_NEW_CHAT_BOOTSTRAP=READ_5_CANONICAL
AC_FAST_PATH=LOADER>#280>#335>#504>#1940>#1888>#1900>OPEN_APP_CHROME_WO_PR>LATEST_CHECKPOINT_RUNTIME
AC_SKIP_FULL_5_BOOTSTRAP_BY_DEFAULT=true
AC_FULL_BOOTSTRAP_TRIGGERS=BOOTSTRAP_VERSION_CHANGED|GOVERNANCE_OR_ARCHITECTURE_TASK|SOURCE_CONFLICT|SOT_POINTER_CHANGED|OWNER_EXPLICIT
AC_NO_DUPLICATE_READS_WITHIN_VALID_SESSION=true

- Phiên thông thường vẫn đọc đủ 5 Bootstrap canonical theo thứ tự chuẩn; không cắt bỏ bộ nền của hệ thống.
- Riêng lệnh `AC` dùng đường nạp nhanh: Loader → #280 → #335 → #504 → #1940 → #1888/#1900 → Work Order/PR APP-CHROME đang mở liên quan → checkpoint/runtime mới nhất.
- Với AC, không đọc lại đủ 5 Bootstrap chỉ để khởi động nếu không có trigger. Chỉ nạp đủ 5 khi version Bootstrap thay đổi, task chạm governance/architecture, có xung đột nguồn, pointer SOT thay đổi, hoặc Owner yêu cầu.
- Trong cùng phiên hợp lệ, không đọc lặp lại nguồn đã xác minh nếu version/checkpoint/pointer chưa đổi; chỉ refresh nguồn động cần thiết trước kết luận/mutation.
- AC fast-path không hạ precedence hay hard gate; chỉ tối ưu lượng đọc/token.
STATE=AC_FAST_LOAD_V4_CANONICAL

## Mục tiêu
Đây là entry point duy nhất để ChatGPT Plus, ChatGPT Go và Gemini Pro nạp TigerIQ theo cùng một Nguồn Sự Thật. Mỗi tài khoản chỉ cần giữ hoặc trỏ tới Loader này; không duy trì bản sao riêng của 5 file Bootstrap.

## Canonical repository
Repository: `newsdayads/tigeriq-ai-lab`
Branch chuẩn: `main`
Loader path: `bootstrap/00_TIGERIQ_LOADER.md`
Loader page: `https://github.com/newsdayads/tigeriq-ai-lab/blob/main/bootstrap/00_TIGERIQ_LOADER.md`

## Bootstrap bắt buộc cho phiên thông thường — đọc theo thứ tự
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

## Lệnh bootstrap đặc biệt
- `AC` (không phân biệt hoa/thường) = `APP_CHROME_OWNER_MODE`. Khi tin nhắn đầu tiên hoặc tin nhắn độc lập chỉ chứa `AC`/`Ac`/`ac`, KHÔNG trả lời như lời chào và KHÔNG hỏi Owner giao việc.
- Phải lập tức nạp context App Chrome: checkpoint mới nhất `/TigerIQ/TIGERIQ_CHAT_CHECKPOINT_*.md` và `/TigerIQ/APP_CHROME_OWNER_MODE_AC.md` nếu Library khả dụng; sau đó đọc CENTRAL #280, Registry #335, Interaction #504, #1888, #1900 và toàn bộ Work Order/PR APP-CHROME đang OPEN.
- Sau audit, chỉ tiếp tục việc App Chrome chưa DONE ưu tiên cao nhất. Không chuyển sang backlog toàn dự án.
- Trong AC mode, Owner↔Vy giữ quyền điều phối. Mutation App Chrome chỉ thuộc active one-writer MUTATION_OWNER đã được resolve/handoff rõ ràng; actor khác read/observe only theo canonical SOT.
- `1` vẫn giữ nghĩa `RESUME_TOP_UNFINISHED` của toàn dự án và KHÔNG đồng nghĩa `AC`.
- AC mode chỉ nhả khi Owner nói rõ `thoát AC`, `mở khóa App Chrome` hoặc tương đương.

## Hành vi bắt buộc khi bắt đầu phiên
1. Xác định adapter nguồn khả dụng của tài khoản hiện tại.
2. Nếu có GitHub connector, đọc Loader theo repo/branch/path; không dùng raw URL làm điều kiện thành công duy nhất.
3. Nếu là lệnh `AC`: dùng AC FAST-LOAD V4; không đọc đủ 5 Bootstrap trừ khi có trigger bắt buộc.
4. Nếu KHÔNG phải `AC`: đọc đủ 5 Bootstrap canonical theo danh sách trên.
5. Nếu câu hỏi phụ thuộc trạng thái hiện hành, đọc CURRENT_STATE + CENTRAL/Registry/Interaction + tài liệu liên quan.
6. Chỉ sau khi hoàn tất đường nạp tương ứng mới kết luận hoặc thực thi.

## Fail-safe
Nếu GitHub connector đã được kết nối nhưng một raw URL trả 404, phải thử lại bằng GitHub connector theo repo/branch/path trước khi kết luận SOURCE_UNAVAILABLE. Chỉ khi canonical path vẫn không đọc được mới fail closed; không fallback sang bản `(1)/(2)`, timestamped copy, file cũ trong Drive hay memory.