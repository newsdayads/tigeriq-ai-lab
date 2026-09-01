# WO-043 — AI Coordinator Gate Evidence — updated 2026-09-01

## Scope
Evidence for AI Coordinator implementation only. No App/Web Control UI modification, no PC01 runtime ownership, and no MAIN/Production release.

## Source state audited
- Existing provider mesh supports multiple provider/model identities and failure classification.
- Existing WorkOrderWorker actor separation was not sufficient to prove provider/model independence.
- WO-043 originally enforced Executor/Reviewer separation for all work and three-way separation only for coding/high-risk work.
- Current Owner instruction requires `Executor -> different Reviewer -> third distinct Judge` for every coordinated work item.

## Coordinator implementation evidence
Branch: `wo043/ai-coordinator`
PR: #111

Changed capability in WO-043 scope:
1. `packages/ai-coordinator/src/index.ts`
   - task/risk/cost-aware selection;
   - bounded provider fallback;
   - Executor -> Reviewer -> Judge state machine;
   - universal three-way concrete provider/model identity separation;
   - Judge always excludes both prior identities;
   - atomic persistent checkpoints;
   - redacted evidence with SHA-256 output digest.
2. `tests/ai-coordinator.test.ts`
   - low-cost routing;
   - provider failover;
   - bounded attempts;
   - three-way independence for low-risk/general and high-risk/coding work;
   - fail-closed behavior when only two identities are available;
   - restart recovery without repeating Executor;
   - evidence privacy.

## 2026-09-01 owning-defect correction
Prior exact head `1f8261c59b6406a471226a762a3b724d5dad93dd` was repository PASS under the earlier policy, but it allowed Reviewer and Judge to reuse the same concrete identity for lower-risk work. The current Owner instruction supersedes that behavior.

Remediation implementation/test head: `f7fb806544134e443212729491cb2ff24930b956`.
Exact-head checks on that implementation/test head:
- CI `33532040523` — PASS.
- Queue Hygiene `33532040524` — PASS.
- Vercel Online Verify `33532040600` — PASS.

Documentation synchronization commits follow that implementation head, so a final exact-head CI cycle is still required after docs are complete.

## Earlier cross-stream remediation retained
- WO-043 does not own `scripts/pc-worker/worker-github-queue.py`.
- PC01 runtime/security remains with #114/#116.
- Zero-cost live provider policy/probe is tracked by #133/#134.
- No live provider/device result is inferred from repository tests.

## Security/privacy
- No API key/token/credential committed by WO-043.
- Routing evidence excludes raw prompt and raw model output; stage output is represented by SHA-256 digest in exported evidence.
- Raw stage output may exist only in the private checkpoint required for recovery; JSON file storage is atomic and requests restrictive file mode where supported.
- No paid provider activation is claimed.

## Independence truth boundary
Repository tests now require three distinct concrete provider/model identities for Executor, Reviewer and Judge for all coordinated work. This is policy/engineering evidence only; it does not prove that three live provider identities are configured on PC01 or any deployment target.

## Independent review boundary
Any independent review bound to `1f8261c...` or earlier heads is stale for the 2026-09-01 policy change. A genuinely separate reviewer must review the final exact head. Same-author/self-review is not independent evidence.

## Release truth boundary
PR #111 remains unmerged. MAIN/Production was not changed by WO-043. Repository PASS cannot be restored until final exact-head checks and independent review both pass.
