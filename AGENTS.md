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

## Non-negotiable rules
- Coding agents never self-declare DONE.
- No evidence means no PASS and no merge.
- No single agent may implement, review, and judge the same work order when an independent gate applies.
- Architect, Reviewer, and Judge are read-only by default.
- Coding agents write only inside isolated branches/worktrees and cannot access production secrets.
- QA may execute tests but may not weaken acceptance criteria to turn FAIL into PASS.
- Release Manager may prepare PR/Preview; MAIN/Production requires all applicable gates plus an explicit privileged release action.
- Golden expected outputs are version-controlled and cannot be auto-edited after a failing run.
- Preserve stable functionality and data.
- Prefer free/low-cost capable models/services before paid options.
- Never commit secrets or restricted/private Owner context.
- `04_TIGERIQ_OWNER_PROFILE_v1.md` must not be added to this general repository.
- An off-MAIN CI/reviewer/judge PASS means only the scoped off-MAIN gate passed. It does not mean merged, released, live, or Production.
- NO YAPPING for Owner-facing operational responses.

## Owner reporting runtime rule
When the Owner enters `báo cáo`, `bc`, or `tiến độ`, return a one-screen TigerIQ dashboard in this exact order:
1. 📊 Tổng tiến độ — progress bar + percentage.
2. 🚦 Hạng mục chính — item + progress + status icon.
3. 🔴 P0 BLOCKER — only the highest-priority real blocker.
4. 🔄 Đang xử lý — current priority work + progress.
5. 👥 Nhân sự AI — working / reviewing / waiting-blocked / idle; keep each assignment extremely short and aggregate idle workers when useful.
6. 🎯 Mốc kế tiếp — one concrete next outcome.

Do not fall back to the legacy bullet-report format. Do not surface SHA/PR/commit/log/history unless it is itself the blocker or the Owner asks. Progress must be evidence-based; if it is only a management estimate, label it as such.

## Owner prompt / Work rule
When the Owner asks for `prompt`, `promt`, `đưa prompt`, `qua Work`, or `giao NV`:
- Output exactly one complete copyable prompt block.
- Start it with `LÀM — NO YAPPING.`
- Do not split one job across multiple prompts and do not add long explanation around the prompt.
- Include enough goal, context, constraints, and DONE criteria for the receiving AI/Work/NV to AUDIT → EXECUTE CONTINUOUSLY → VERIFY → RECORD EVIDENCE → finish at DONE or REAL BLOCKER.
- Do not stop for “continue?” when the next safe step is known.
- Default to no MAIN/Production mutation, no paid service, and no irreversible action unless explicitly authorized.
- If a Work handoff is unavailable or rejected, do not waste quota retrying; immediately provide the single prompt for a fresh Work chat.
- Batch related changes into one prompt / one Work session when safe to minimize quota usage.

## Required execution loop
AUDIT → SPEC/WORK ORDER → ARCHITECTURE → IMPLEMENT → STATIC → UNIT → INTEGRATION → E2E → GOLDEN → INDEPENDENT REVIEW → JUDGE(EVIDENCE) → CI → PREVIEW → SMOKE → RELEASE ELIGIBLE → STATE/EVIDENCE.

On failure: capture evidence → root cause → fix → retest → continue. End only at DONE, REAL BLOCKER, or EXTERNAL WAIT.

## Runtime target
Owner → Chief of Staff → Work Order → AI Employee/Department → Model Router → Execution → Independent Review → Judge/Gate → Evidence → State/Memory → Owner Report.
