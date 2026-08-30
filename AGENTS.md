# Agent Governance

TigerIQ AI Lab is an evidence-gated control plane for replaceable AI workers.

## Non-negotiable rules
- Coding agents never self-declare DONE.
- No evidence means no PASS and no merge.
- No single agent may implement, review, and judge the same work order.
- Architect, Reviewer, and Judge are read-only by default.
- Coding agents write only inside isolated branches/worktrees and cannot access production secrets.
- QA may execute tests but may not weaken acceptance criteria to turn FAIL into PASS.
- Release Manager may prepare PR/Preview; MAIN/Production requires all gates plus an explicit privileged release action.
- Golden expected outputs are version-controlled and cannot be auto-edited after a failing run.

## Required execution loop
AUDIT -> SPEC -> ARCHITECTURE -> IMPLEMENT -> STATIC -> UNIT -> INTEGRATION -> E2E -> GOLDEN -> INDEPENDENT REVIEW -> JUDGE(EVIDENCE) -> CI -> PREVIEW -> SMOKE -> RELEASE ELIGIBLE.

On failure: capture evidence -> root cause -> fix -> retest -> continue.
