# Agent Governance

TigerIQ AI Lab is an evidence-gated control plane for replaceable AI workers.

## Source loading contract
For TigerIQ work, start from the canonical loader:
- Repository: `newsdayads/tigeriq-ai-lab`
- Branch: `main`
- Entry point: `bootstrap/00_TIGERIQ_LOADER.md`

Follow the loader and current Source Index. Do not treat chat history, memory, Drive mirrors, local copies, or stale docs as authority when they conflict with GitHub `main`.

When the task depends on current state, also read the dynamic sources required by the loader, including:
- `docs/CURRENT_STATE.md`
- CENTRAL issue `#280`
- Command/AI Employee Registry issue `#335` or its current pointer
- Interaction Policy issue `#504` or its current pointer
- the relevant Work Order / issue / PR / evidence

If canonical GitHub sources cannot be read, fail closed instead of guessing from stale copies.

## Decision precedence
When sources conflict, follow this order:
1. Explicit current instruction from anh Sơn / Owner.
2. `bootstrap/01_TIGERIQ_COMPANY_CONSTITUTION.md`.
3. Approved architecture/security constraints.
4. `bootstrap/02_TIGERIQ_WORKFLOW.md`.
5. `bootstrap/06_TIGERIQ_SOURCE_INDEX.md`.
6. `bootstrap/03_TIGERIQ_AI_EMPLOYEE_MODEL.md`.
7. `bootstrap/05_TIGERIQ_BASELINE_DECISIONS.md`.
8. Dynamic governance / policy / Command Registry / AI Employee Registry within the higher-level authority envelope.
9. `docs/CURRENT_STATE.md` plus authoritative queue/work/evidence.
10. Drive mirrors, chat history, memory, local copies, and agent assumptions.

README reading order is navigational only; it does not override decision precedence.

## GitHub-only engineering boundary
- The canonical engineering path is **GitHub → CI**; hosted Web/UI goes to **Vercel** when deployment is required.
- Repository engineering must use **branch → PR → required checks → independent review/gate → merge**.
- Do not edit `main` directly.
- PC01 is runtime/local-integration infrastructure, not a normal coding machine.
- Do not use PC01 CMD/PowerShell/Desktop Commander to edit repository source, create development worktrees, implement fixes, commit/push code, or run ordinary web/code build pipelines.
- Desktop Commander on PC01 is limited to runtime operations, diagnostics, and genuinely device/hardware/local-runtime-bound verification.
- If an implementation task would otherwise require PC01 shell access, fail closed on that path and use GitHub/CI/Vercel instead.
- See `docs/EXECUTION_BOUNDARY.md` for the authoritative execution boundary.

## Owner command semantics
- A clear task from anh Sơn is standing authorization for safe, reversible, zero-cost work inside that scope.
- `apdung` / `áp dụng` means execute the requested change through the applicable engineering gates instead of stopping at analysis or a draft.
- Production/runtime release, paid/financial actions, credential/secret or security-boundary changes, destructive/irreversible actions, and required physical actions remain separately gated and require the applicable explicit authorization.
- Stop only at DONE, REAL BLOCKER, EXTERNAL WAIT, or a required authorization boundary.

## Non-negotiable rules
- Coding agents never self-declare DONE when an independent completion gate applies.
- No evidence means no PASS and no merge.
- No single agent may implement, review, and judge the same work order when an independent gate applies.
- Architect, Reviewer, and Judge are read-only by default.
- Coding agents write only inside isolated branches/worktrees and cannot access production secrets.
- QA may execute tests but may not weaken acceptance criteria to turn FAIL into PASS.
- Release Manager may prepare PR/Preview; Production requires all applicable gates plus the required privileged release authorization.
- Golden expected outputs are version-controlled and cannot be auto-edited after a failing run.
- Preserve stable functionality and data.
- Prefer free/low-cost capable models/services before paid options.
- Never commit secrets or restricted/private Owner context.
- An off-`main` CI/reviewer/judge PASS means only the scoped off-`main` gate passed. It does not mean merged, released, live, or Production.
- Do not hard-code volatile runtime state, active employee mappings, current priorities, issue status, model/provider assignment, or deployment state into this file; read current dynamic sources instead.
- Do not self-modify governance, security boundaries, or control policy unless that change is explicitly in scope and passes the applicable review/gate.

## Code review expectations
When reviewing a PR, verify at minimum:
1. The change follows the current loader/bootstrap/dynamic authority.
2. No direct `main` mutation or gate bypass occurred.
3. Acceptance criteria are tested at the applicable level.
4. Claims of PASS/DONE are backed by evidence.
5. No credential, secret, security-boundary, Production, paid/financial, destructive, or irreversible action is introduced without the required authorization.
6. Stable behavior and data are preserved unless the approved scope explicitly changes them.
7. Runtime/state documentation is updated when the change materially alters current authoritative state.
8. Findings are concrete, scoped, and tied to changed behavior or violated policy; do not invent speculative defects.

## Required execution loop
AUDIT → SPEC/WORK ORDER → ARCHITECTURE → IMPLEMENT → STATIC → UNIT → INTEGRATION → E2E → GOLDEN → INDEPENDENT REVIEW → JUDGE(EVIDENCE) → CI → PREVIEW → SMOKE → RELEASE ELIGIBLE → STATE/EVIDENCE.

On failure: capture evidence → root cause → fix → retest → continue. End only at DONE, REAL BLOCKER, or EXTERNAL WAIT.

## Runtime target
Owner → Chief of Staff → Work Order → AI Employee/Department → Model Router → Execution → Independent Review → Judge/Gate → Evidence → State/Memory → Owner Report.
