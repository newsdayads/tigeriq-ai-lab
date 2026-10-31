# Agent Governance

TigerIQ AI Lab is an evidence-gated control plane for replaceable AI workers.

## Decision precedence
When sources conflict, follow this order:
1. Explicit current Owner instruction.
2. `docs/company/01_TIGERIQ_COMPANY_CONSTITUTION_v1.md`.
3. Approved architecture/security constraints.
4. `docs/company/02_TIGERIQ_WORKFLOW_v1.md`.
5. `docs/company/03_TIGERIQ_AI_EMPLOYEE_MODEL_v1.md` for bounded role/orchestration rules that do not conflict with higher sources.
6. `docs/CURRENT_STATE.md` and `docs/company/05_TIGERIQ_DECISION_LOG_V1.md`.
7. Agent assumptions.

README reading order is navigational only; it does not override decision precedence.

## GitHub-only engineering boundary
- The canonical engineering path is **GitHub → CI**; hosted Web/UI goes to **Vercel** when deployment is required.
- PC01 is runtime/local-integration infrastructure, not a normal coding machine.
- Do not use PC01 CMD/PowerShell/Desktop Commander to edit repository source, create development worktrees, implement fixes, commit/push code, or run ordinary web/code build pipelines.
- Desktop Commander on PC01 is limited to runtime operations, diagnostics, and genuinely device/hardware/local-runtime-bound verification.
- If an implementation task would otherwise require PC01 shell access, fail closed on that path and use GitHub/CI/Vercel instead.
- See `docs/EXECUTION_BOUNDARY.md` for the authoritative execution boundary.

## Owner command semantics
- `apdung` / `áp dụng` / `duyệt` = **thực hiện ngay yêu cầu hiện tại đến khi sửa xong và xuất bản luôn**. Với thay đổi code/web/app: tự audit/root-cause → fix → test/CI → merge MAIN → deploy Production khi áp dụng; không dừng ở phân tích, TEST, Preview hay báo tiến độ giữa chừng.
- Vẫn phải giữ các gate an toàn/evidence hiện hành. Chỉ dừng khi DONE, REAL BLOCKER, EXTERNAL WAIT, hoặc thiếu quyền bắt buộc không thể tự hoàn tất.

## Autonomous End-to-End Execution (Owner Approved 2026-10-20)
- **Full-Cycle Autonomy:** When assigned a Work Order or project task, the executor agent is authorized and expected to execute the full lifecycle: inspect, code, test, fix environment/runtime dependencies, self-verify with automated tests, and merge/deploy when tests pass.
- **Auto-Merge on Green CI:** For solo-owner repositories (`newsdayads/*`), independent non-author human review is permanently waived when exact-head CI automated tests pass. The executor may merge PR into MAIN and trigger production deployment without waiting for external human or secondary AI review.
- **Autonomous Unblocking:** Agents must attempt direct resolution of environment/build/runtime issues (e.g. starting sandbox services, fixing configuration, installing dependencies in scope) before declaring a blocker. Do not record `EXTERNAL_WAIT` for non-existent external reviewers or phantom gates.

## Non-negotiable rules
- Coding agents self-verify via automated CI/test suites before declaring DONE.
- No evidence means no PASS and no merge; green automated CI test evidence is authoritative for source merge.
- Architect, Reviewer, and Judge are read-only by default.
- Coding agents write only inside isolated branches/worktrees and cannot access production secrets.
- QA may execute tests but may not weaken acceptance criteria to turn FAIL into PASS.
- Golden expected outputs are version-controlled and cannot be auto-edited after a failing run.
- Preserve stable functionality and data.
- Prefer free/low-cost capable models/services before paid options.
- Codex is a quota-protected Owner-gated resource: default DENY. Do not request Codex review, route work to Codex, hand off to Codex Local, or invoke any Codex-backed action unless the Owner explicitly names Codex and authorizes the exact bounded scope. Generic commands such as `LÀM`, `TIẾP TỤC`, `02`, `LÀM TIẾP`, `TỰ HOÀN TẤT`, or `ÁP DỤNG` never imply Codex approval. P1–P5 standing authorization does not include Codex. Without matching approval, use another eligible zero-cost resource or wait; lack of an alternate reviewer is not permission to consume Codex quota.
- Never commit secrets or restricted/private Owner context.
- `04_TIGERIQ_OWNER_PROFILE_v1.md` must not be added to this general repository.

## Required execution loop
SPEC → IMPLEMENT → TEST/CI → AUTO-FIX ON FAILURE → GREEN CI → MERGE TO MAIN → PRODUCTION DEPLOY → EVIDENCE REPORT.

On failure: capture evidence → root cause → auto-fix → retest → continue until GREEN. End only at DONE, or REAL BLOCKER (irreversible credential/payment boundary).

## Runtime target
Owner → Chief of Staff → Work Order → AI Employee/Department → Model Router → Execution → Independent Review → Judge/Gate → Evidence → State/Memory → Owner Report.

<!-- entire-agent:begin -->
Read .entire/agent-guide.md for this repository's workflow, source inspection, and verification guidance.
@.entire/agent-guide.md
<!-- entire-agent:end -->
