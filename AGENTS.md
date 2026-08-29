# TigerIQ AI Lab — Repository Operating Instructions

## Decision precedence
When sources conflict, follow the Company Constitution. Repository contributors and AI agents use this order:
1. Explicit current Owner instruction
2. `docs/company/01_TIGERIQ_COMPANY_CONSTITUTION_v1.md`
3. Approved architecture/security constraints
4. `docs/company/02_TIGERIQ_WORKFLOW_v1.md`
5. `docs/company/03_TIGERIQ_AI_EMPLOYEE_MODEL_v1.md` for bounded role/orchestration rules that do not conflict with higher sources
6. `docs/CURRENT_STATE.md` and `docs/company/05_TIGERIQ_DECISION_LOG_V1.md`
7. Agent assumptions

README reading order is navigational only; it does not override this decision precedence.

## Mandatory execution loop
Audit real state → identify constraints → concise status → Work Order → execute continuously → verify milestones → root-cause/fix/retest failures → record evidence/state → finish at DONE, REAL BLOCKER, or EXTERNAL WAIT.

## Engineering rules
- Never edit MAIN/Production directly when a branch/review gate applies.
- Preserve stable functionality and data.
- Never claim test/build/deployment status without evidence.
- Separate Builder, Reviewer, and Judge when required by the gate.
- Prefer free/low-cost capable models/services before paid options.
- Never commit secrets or restricted/private Owner context.
- `04_TIGERIQ_OWNER_PROFILE_v1.md` must not be added to this general repository.
- An off-MAIN CI/reviewer/judge PASS means only the scoped off-MAIN gate passed. It does not mean merged, released, live, or Production.

## Runtime target
Owner → Chief of Staff → Work Order → AI Employee/Department → Model Router → Execution → Independent Review → Judge/Gate → Evidence → State/Memory → Owner Report.
