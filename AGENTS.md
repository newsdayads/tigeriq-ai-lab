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

## Required execution loop
AUDIT → SPEC/WORK ORDER → ARCHITECTURE → IMPLEMENT → STATIC → UNIT → INTEGRATION → E2E → GOLDEN → INDEPENDENT REVIEW → JUDGE(EVIDENCE) → CI → PREVIEW → SMOKE → RELEASE ELIGIBLE → STATE/EVIDENCE.

On failure: capture evidence → root cause → fix → retest → continue. End only at DONE, REAL BLOCKER, or EXTERNAL WAIT.

## Runtime target
Owner → Chief of Staff → Work Order → AI Employee/Department → Model Router → Execution → Independent Review → Judge/Gate → Evidence → State/Memory → Owner Report.
