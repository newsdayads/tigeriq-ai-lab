# TIGERIQ — DECISION LOG / BASELINE
Version: 1.1

## Confirmed operating decisions
- TigerIQ is intended to become an AI-native company/operating system, not merely a chatbot.
- Chief of Staff is the primary orchestration role.
- The system should combine multiple AI providers/models rather than depend on one model.
- Low-cost/free-first is the default.
- Execution must be evidence-driven and independently checked for material work.
- “LÀM” means execute continuously through applicable gates; do not repeatedly stop for confirmation.
- Production changes require the appropriate release authorization/gate.
- Current engineering baseline includes orchestration, work-order concepts, evidence, control-plane/runtime safeguards, and model-routing foundations.
- Existing assets should be evaluated for monetization, but no asset should be activated without economic justification.
- TigerIQ Driver is an important real-world product/use case and originated from an operational need to record rides and settle revenue sharing.
- The Owner wants the system to progressively control personal/business workflows while preserving explicit privacy boundaries.

## Autonomous handoff governance — 2026-09-02
- Owner gives a goal/constraint once; Sếp must not be used as a message bus between AI Employees.
- CHAT00 is the orchestration authority responsible for assigning accountable owners, routing required independent assurance, moving PASS to the next stage, and returning FAIL directly to the owning Executor.
- The accountable Executor owns audit → execute → self-test → exact evidence → remediation until PASS, POLICY_BLOCK or accepted REAL BLOCKER.
- CHAT05 is an independent quality gate, not a general queue or implementation owner.
- Independent assurance is risk-based rather than universal: R0/R1 self-check by default; R2 conditional; R3 independent Reviewer mandatory; R4 follows critical/Owner-reserved Reviewer/Judge/Owner policy.
- A complete Reviewer/Judge verdict is bound to a review fingerprint consisting of exact scope/version/evidence/policy/risk. The same unchanged fingerprint must not be re-reviewed unless the prior review is proven invalid/incomplete.
- Reviewer FAIL must contain structured blockers and return directly to the accountable Executor/CHAT00. Re-review requires new exact evidence and an explicit changed-since-last-review delta.
- Default correction loop remains bounded by the applicable policy; Chief Policy V2 default is two correction cycles after initial submission. Repeated blocker/no truthful evidence/authority expansion/exhausted correction becomes REAL BLOCKER or POLICY_BLOCK, not infinite review.
- `CẦN SẾP` is reserved for genuine Owner decisions/authority, financial/security/legal/Production/irreversible actions, credential/permission/autonomy/risk-policy expansion, or unavoidable physical steps. CI/Vercel/provider waits, reviewer routing and executor↔reviewer communication are not `CẦN SẾP`.
- External waits carry a resume condition and must not blind-retry.
- Governance contract: `docs/architecture/TIGERIQ_AUTONOMOUS_HANDOFF_LOOP_V1.md`; machine-readable handoff shape: `schemas/autonomous-handoff-v1.schema.json`.
- This governance decision does not claim cross-chat/runtime message transport is already physically automated; runtime implementation, if desired, requires a separate authorized work order.

## Repository governance decisions
- 2026-08-29: General repository governance documents use role names instead of personal identities and omit third-party names or private relationship details unless strictly required by an approved business process.
- 2026-08-29: PR #11 may describe verified off-MAIN runtime evidence, but must distinguish the primary stacked path from the separate alternative Phase 0 branch and must not imply MAIN or Production integration.
- 2026-08-29: Independent review Issue #12 passed corrected PR #11 head `f34b8c672112eb38b5d7b0bb04c3af06609759d3`; merge still requires a separate Judge/release decision.
- 2026-08-29: First Judge evaluation at head `627f2b8999e6fbe94ff4cecf9110d7d91dd2d6c7` returned FAIL because review evidence was not yet recorded on Issue #12, Source Index precedence was inconsistent, and CURRENT_STATE omitted PR #13–#18. Merge remains blocked pending fixes and re-judgment.

## Baseline date
2026-09-02
