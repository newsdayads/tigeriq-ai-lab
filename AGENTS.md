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

## GitHub-only engineering boundary; PC01-only new deployment (Owner 2026-11-05)
- Canonical source and verification: **GitHub → CI**. Default production destination for **every NEW website/app**: **PC01 → Cloudflare Tunnel → `<app>.tigeriq.io.vn`**, never Vercel.
- Cloudflare DNS wildcard `*.tigeriq.io.vn` is provisioned once for tunnel `6e1b0f48-cf73-420b-ba3e-9fbb0efc4e61`. New apps must explicitly opt in to public routing, have a healthy localhost origin, and be registered by `scripts/pc01/register-public-webapp.ps1` after the router is installed and accepted. Unknown hosts return 404.
- No new Vercel project, deploy, Git integration or auto-deploy may be created. Existing legacy Vercel production must NOT be disrupted or deleted until each app is migrated, verified and accepted. Old Vercel CI checks are verification-only.
- PC01 is runtime/local-integration infrastructure and approved runtime deployment destination, **not** a normal coding machine.
- Do not use PC01 CMD/PowerShell/Desktop Commander to edit repository source, create development worktrees, implement fixes, commit/push source, or run ordinary coding/build pipelines. Reviewed artifacts may be installed/operated on PC01 with actual runtime rights and receipts.
- Do not modify production Tunnel config while another writer owns that resource. A wildcard ingress rule comes after explicit host rules and before terminal 404; validate, restart with authorized rights, check public HTTPS and rollback on failure.
- See `docs/EXECUTION_BOUNDARY.md` and `docs/PC01_AUTO_SUBDOMAIN.md`.

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
