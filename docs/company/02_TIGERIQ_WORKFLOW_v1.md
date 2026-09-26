# TIGERIQ — WORKFLOW V1
Version: 1.0
Status: Source of Truth
Priority: P0

## Standard execution loop
1. Receive request.
2. Audit real current state.
3. Identify relevant Source of Truth and constraints.
4. Report concise current status.
5. Produce ordered checklist/work order.
6. Execute continuously without unnecessary confirmation.
7. At each milestone: verify and report progress briefly.
8. On gate failure: root-cause → fix → retest.
9. Preserve stable behavior/data.
10. Run applicable tests/security/build/release gates.
11. Update Current State / Decision Log / Work Order evidence.
12. Finish at DONE, REAL BLOCKER after safe fallbacks are exhausted, or EXTERNAL WAIT.

## Owner interaction
- Do not ask the Owner to repeat information already available.
- Do not stop merely to ask “continue?” when the next safe action is known.
- When the Owner says “LÀM”, execute the applicable work order continuously.
- Choose the technically and economically optimal option when authority is delegated.
- Ask only when a decision is genuinely irreversible, materially financial, security-sensitive, legally consequential, or impossible to infer safely.

## Reporting
Use milestone reporting, concise status, blockers, and next action.
No yapping: avoid repeating completed analysis or long narrative.

## Engineering safety
- Do not edit MAIN/Production directly when the workflow requires an integration/feature branch.
- Use CI and independent review where applicable.
- Never claim a build, deployment, device test, or production result without evidence.
- Do not expose secrets in source control.

## Definition of DONE
DONE requires:
- implementation complete;
- relevant tests pass;
- review/gates pass;
- evidence recorded;
- documentation/current state updated;
- release/deployment performed only when authorized;
- no unresolved real blocker within the agreed scope.
