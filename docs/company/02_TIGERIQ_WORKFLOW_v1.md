# TIGERIQ — WORKFLOW V1
Version: 1.2
Status: Source of Truth
Priority: P0

## Standard execution loop
1. Receive Owner goal/request once.
2. CHAT00 audits/identifies the accountable owner and relevant Source of Truth/constraints.
3. Owning CHAT audits real current state.
4. Owning CHAT produces ordered work plan/work order and executes continuously within delegated authority.
5. Owning CHAT self-tests/self-checks and publishes exact evidence.
6. Apply action-level risk/policy gate.
7. If independent review is **not** required, advance directly to the next safe stage or DONE when acceptance is complete.
8. If independent review **is** required, create a structured handoff from the exact evidence directly to the eligible Reviewer through CHAT00 orchestration. The Owner is not the message bus.
9. Reviewer PASS → CHAT00 advances automatically to Judge/Owner gate/next stage/DONE as applicable.
10. Reviewer FAIL → structured blockers return directly to the accountable Executor; root-cause → fix → retest → publish new exact evidence → re-submit.
11. Do not re-review an unchanged exact-evidence fingerprint unless the prior review is invalid/incomplete.
12. Preserve stable behavior/data and run applicable tests/security/build/release gates.
13. Update Current State / Decision Log / Work Order evidence.
14. Finish at DONE, POLICY_BLOCK, REAL BLOCKER after bounded safe fallbacks are exhausted, or EXTERNAL WAIT with a resume condition.

## Autonomous Handoff Loop
Canonical governance contract: `docs/architecture/TIGERIQ_AUTONOMOUS_HANDOFF_LOOP_V1.md`.

Core rule:
`Owner goal once → CHAT00 route → Executor audit/execute/self-test/evidence → risk-appropriate assurance → PASS advances / FAIL returns to Executor → bounded fix/retest/new evidence → PASS or REAL BLOCKER`.

Responsibilities:
- CHAT00 owns transitions and routing between Executor, Reviewer, Judge and next stage.
- Executor owns remediation until the gate passes or a real blocker is recorded.
- CHAT05 is an independent quality gate only where risk/process requires it; it is not the implementation owner or general work queue.
- Reviewer/Judge must return verdicts to CHAT00/accountable Executor, not ask Sếp to relay them.
- Sếp is never used to forward routine status, PASS, FAIL, evidence or blocker messages between AI Employees.

## Control Plane and external workboards
Canonical boundary: `docs/architecture/TIGERIQ_EXTERNAL_WORKBOARD_BOUNDARY_V1.md`.

For CHAT00/NV session startup, assignment recovery and execution-state decisions, use the applicable authoritative TigerIQ sources: Company Source of Truth, current orchestration policy, GitHub Issues/PR/exact evidence/current-state for repository work, canonical runtime/company state when applicable, and approved domain Sources of Truth.

Trello is classified as `HUMAN WORKBOARD / READ-ONLY EXTERNAL SOURCE`.

Rules:
- Do **not** open/search/audit Trello merely because `NV 00`/`CHAT00` starts or resumes.
- Do **not** use Trello to decide AI Employee assignment or `ACTIVE / BLOCKED / WAITING / DONE` state.
- Trello may be read when Sếp explicitly asks, when an approved process declares it as an external input, or when Owner Cockpit needs a human-work projection.
- Trello-derived projections are non-authoritative for TigerIQ internal execution state and must preserve provenance where available.
- Default Trello integration is read-only. Writes require an explicit Owner request for that Trello change or bounded write authority in an approved process.
- An authorized Trello write never makes Trello the Control Plane and must not create a shadow copy of authoritative Job/Lease/Result/Evidence/runtime state.
- On conflict, the higher-precedence TigerIQ Source of Truth wins.

## Risk-based assurance
Use action-level R0-R4 from approved Company Operating Model / Chief of Staff policy:
- R0: self-check/deterministic validation; no independent review by default.
- R1: self-check + applicable CI/rules; no independent review by default.
- R2: stronger validation; independent review only when process/action policy requires it.
- R3: independent Reviewer mandatory; Judge only when the applicable gate requires it.
- R4: critical/Owner-reserved assurance; independent review only when the action is explicitly `REVIEWABLE`, Judge per policy, and Owner approval for Owner-reserved actions. A legitimately `NOT_REVIEWABLE` R4 action must record a non-reviewable reason and must not fabricate a review requirement.

For machine-readable R4 handoffs, `reviewability` is explicit. `independent_review_hard_floor=true` forces `REVIEWABLE` + `review_required=true`; Production, security and release assurance are hard-floor reasons and cannot be represented as non-reviewable merely to bypass independent assurance.

Do not create review work merely for activity. An owning Issue/process may raise assurance; it may not lower hard floors.

## Owner interaction
- Do not ask the Owner to repeat information already available.
- Do not stop merely to ask “continue?” when the next safe action is known.
- When the Owner says “LÀM”, execute the applicable work order continuously through applicable gates.
- Choose the technically and economically optimal option when authority is delegated.
- Ask only when a genuine Owner decision/authority is needed, the action is irreversible/materially financial/security-sensitive/legally consequential/Production-gated, or an unavoidable physical step requires the Owner.
- CI/provider/Vercel waiting, reviewer routing, retry/retest and executor↔reviewer communication are **not** Owner decisions.
- `AWAITING_OWNER` / `OWNER_DECISION` means the Owner gate is pending and must not contain a fabricated `owner_approval_ref`. The exact immutable approval ref becomes mandatory only after approval is actually obtained and before the workflow advances beyond the Owner gate.

## Anti-loop / review staleness
- Default correction budget is bounded by the applicable policy; Chief Policy V2 default is 2 correction cycles after initial submission.
- A failed review can be resubmitted only with new exact evidence and `changed_since_last_review`.
- Same exact-evidence fingerprint must not be reviewed repeatedly after a complete verdict.
- If evidence/head/scope changes, prior review becomes stale for the changed scope.
- Reviewer unavailability is routed by CHAT00 to another eligible independent reviewer before any Owner escalation.
- `EXTERNAL_WAIT` is an explicit non-terminal state and must carry `wait_reason`, `resume_condition`, and `last_checked_at`; do not blind-retry.

## Reporting
Use milestone reporting, concise status, blockers, exact evidence and next state.
Owner-facing reporting prioritizes Outcome and genuine `CẦN SẾP` decisions rather than internal handoff traffic.
No yapping: avoid repeating completed analysis or long narrative.

## Engineering safety
- Do not edit MAIN/Production directly when the workflow requires an integration/feature branch.
- Use CI and independent review where applicable by risk/policy, not universally.
- Never claim a build, deployment, device test or production result without evidence.
- Do not expose secrets in source control or handoff evidence.

## Definition of DONE
DONE requires:
- requested implementation/outcome complete;
- relevant tests pass;
- required review/judge/Owner gates pass at exact applicable evidence;
- evidence recorded;
- documentation/current state updated;
- release/deployment performed only when authorized;
- no unresolved real blocker within the agreed scope.
