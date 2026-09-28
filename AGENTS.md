# Agent Governance

TigerIQ AI Lab is an evidence-gated control plane for replaceable AI workers.

## Canonical source loading
For TigerIQ work, start from the single source entry point:
- Repository: `newsdayads/tigeriq-ai-lab`
- Branch: `main`
- Loader: `bootstrap/00_TIGERIQ_LOADER.md`

Unless a canonical fast-load rule applies, load these Bootstrap files in order:
1. `bootstrap/01_TIGERIQ_COMPANY_CONSTITUTION.md`
2. `bootstrap/02_TIGERIQ_WORKFLOW.md`
3. `bootstrap/03_TIGERIQ_AI_EMPLOYEE_MODEL.md`
4. `bootstrap/05_TIGERIQ_BASELINE_DECISIONS.md`
5. `bootstrap/06_TIGERIQ_SOURCE_INDEX.md`

When a task depends on current state, also read the current dynamic sources identified by the Loader/Source Index, including `docs/CURRENT_STATE.md`, CENTRAL issue `#280`, Command/AI Employee Registry issue `#335` (or its current pointer), Interaction Policy issue `#504` (or its current pointer), and the directly relevant Work Order/issue/PR/evidence/ADR/CI/release record.

If a required canonical or dynamic GitHub source cannot be read, fail closed. Do not substitute chat history, memory, Drive copies, local copies, timestamped files, or guessed state.

## Decision precedence
When sources conflict, follow this order:
1. Explicit current Owner instruction.
2. `bootstrap/01_TIGERIQ_COMPANY_CONSTITUTION.md`.
3. Approved architecture/security constraints.
4. `bootstrap/02_TIGERIQ_WORKFLOW.md`.
5. `bootstrap/06_TIGERIQ_SOURCE_INDEX.md`.
6. `bootstrap/03_TIGERIQ_AI_EMPLOYEE_MODEL.md`.
7. `bootstrap/05_TIGERIQ_BASELINE_DECISIONS.md`.
8. Dynamic governance/policy/Registry sources within the core authority envelope.
9. `docs/CURRENT_STATE.md` plus authoritative queue/work/evidence.
10. Drive mirror, chat history, memory, and agent assumptions.

README reading order is navigational only; it does not override decision precedence.

## GitHub-only engineering boundary
- The canonical engineering path is **GitHub → CI**; hosted Web/UI goes to **Vercel** when deployment is required.
- Repository source changes must follow **branch → PR → required checks → independent review/gate → merge**.
- Do not mutate `main` directly.
- PC01 is runtime/local-integration infrastructure, not a normal coding machine.
- Do not use PC01 CMD/PowerShell/Desktop Commander to edit repository source, create development worktrees, implement fixes, commit/push code, or run ordinary web/code build pipelines.
- Desktop Commander on PC01 is limited to runtime operations, diagnostics, deployment/local integration, and genuinely device/hardware/local-runtime-bound verification.
- If an implementation task would otherwise require PC01 shell access, fail closed on that path and use GitHub/CI/Vercel instead.
- See `docs/EXECUTION_BOUNDARY.md` for the authoritative execution boundary.

## Owner command semantics
- `apdung` / `áp dụng` means execute the current request through the applicable safe gates instead of stopping at analysis or preview.
- Hard gates remain in force for Production/runtime release, paid/financial actions, credentials/secrets, security/permission-boundary changes, and destructive/irreversible actions.

## Code review instructions
When reviewing a PR:
- Review against the canonical sources above and the PR's explicit scope/acceptance criteria.
- Prioritize correctness, regressions, security/privacy, data integrity, concurrency/ownership, idempotency, failure handling, test coverage, and evidence.
- Treat direct `main` mutation, bypassed checks/gates, missing required evidence, leaked secrets, weakened acceptance criteria, or unauthorized Production/security/financial/destructive behavior as blocking findings.
- Verify that runtime/state claims are supported by current timestamped evidence when applicable.
- Do not invent findings. Distinguish confirmed defects from questions or non-blocking suggestions.
- Avoid style-only nitpicks unless they materially affect maintainability, correctness, or an explicit repository rule.
- A review PASS means only the scoped review passed; it does not imply merged, deployed, live, or Production.

## Non-negotiable rules
- Coding agents never self-declare DONE.
- No evidence means no PASS and no merge.
- No single agent may implement, review, and judge the same work order when an independent gate applies.
- Architect, Reviewer, and Judge are read-only by default.
- Coding agents write only inside isolated branches/worktrees and cannot access production secrets.
- QA may execute tests but may not weaken acceptance criteria to turn FAIL into PASS.
- Release Manager may prepare PR/Preview; MAIN/Production requires all applicable gates plus the authorization required by current policy.
- Golden expected outputs are version-controlled and cannot be auto-edited after a failing run.
- Preserve stable functionality and data.
- Prefer free/low-cost capable models/services before paid options.
- Never commit secrets or restricted/private Owner context.
- `04_TIGERIQ_OWNER_PROFILE_v1.md` must not be added to this general repository.
- An off-MAIN CI/reviewer/judge PASS means only the scoped off-MAIN gate passed. It does not mean merged, released, live, or Production.

## Required execution loop
AUDIT → SPEC/WORK ORDER → ARCHITECTURE → IMPLEMENT → STATIC → UNIT → INTEGRATION → E2E → GOLDEN → INDEPENDENT REVIEW → JUDGE(EVIDENCE) → CI → PREVIEW → SMOKE → RELEASE ELIGIBLE → STATE/EVIDENCE.

On failure: capture evidence → root cause → fix → retest → continue. End only at DONE, REAL BLOCKER, EXTERNAL WAIT, or a required authorization gate.

## Runtime target
Owner → Chief of Staff → Work Order → AI Employee/Department → Model Router → Execution → Independent Review → Judge/Gate → Evidence → State/Memory → Owner Report.
