# TIGERIQ — PROJECT RUN-TO-COMPLETION CONTRACT V1
Status: P0 source candidate, not deployed or live-accepted. Owner directive: 17/10/2026.
Authority: Constitution, Workflow, Issue #504, canonical queue #280, and each Work Order. No second scheduler/queue/control plane.

## 1. Outcome, not activity
A Work Order begins with ONE fixed user-visible outcome, one resource scope, an agreed acceptance checklist, an identified owner, and a clear final artifact. Source commit, CI SUCCESS, API HTTP 200, provider response, created PR, terminal job DONE, or a closed GitHub Issue is NOT equivalent to product delivery.
For new live deliverables, declare `WORK_TYPE=REAL_LIVE_END_TO_END` or `PRODUCT_DELIVERY`; for privately verified commercial PoCs, `WORK_TYPE=PRODUCT_VALIDATION`. Core intake must then require source-revision-bound `LIVE_ACCEPTANCE_PASS`; coding deliveries additionally require the existing independent technical final-review gate. These gates never confer GitHub approval, device rights, paid scope, or publication rights.

## 2. Finite lifecycle (same canonical Work Order)
1. **INTAKE**: record goal, OWNER-approved scope, inputs, constraints, security and cost gates. Existing identical scope -> resume existing issue, never duplicate.
2. **PLAN-LOCK**: define 2–12 outcome-oriented milestones, each with exact input, executor capability, acceptance test, evidence destination, and dependencies. Freeze the baseline milestone count; expanding scope requires a separately recorded Owner decision, never a manager self-loop. Record final delivery test before execution.
3. **CLAIM**: only an eligible executor claims one resource/job with durable atomic lease, fencing token, TTL, and readback. P0 remains Owner/Vy-only. OWNER_HOLD and disabled App Chrome override generic availability.
4. **EXECUTE**: finish exactly one milestone before selecting the next; keep checkpointed context and artifact refs, do not rotate a `WORKING` session or hand off by timer alone.
5. **VERIFY**: execute relevant unit/integration tests and the functional test against the deliverable. For product milestones require actual runtime/device/browser/public URL or independently attested approved simulation only if that *is* the explicit acceptance target; do not substitute mocks for live work.
6. **REVIEW / GATE**: correct reviewer independence and exact source SHA; explicit Owner gates for Production, paid/financial, security/permission/credential, destructive/irreversible actions. Waiver in #504 applies only to its established scope; record waiver distinctly from APPROVED.
7. **ACCEPT + RELEASE**: persist functional acceptance from a trusted source, read back event and artifact, record the exact source revision and rollback receipt, close the verified milestone; release only the lease actually held.
8. **NEXT OR TERMINAL**: deterministically select the next pending eligible milestone. `DONE` only when every committed milestone and final product test have real evidence, protected release/readback passes, and no unresolved blockers. Otherwise terminal for this *attempt* is `BLOCKED` or `EXTERNAL_WAIT` with exact dependency + next authorized trigger, NOT project DONE.

## 3. Bounded attempts and escalation
- Same failure/signature/source revision: maximum 2 retries; after that park the step with exact reason, owner, input needed, last good checkpoint. No repeating identical PR/test/command as progress.
- Manager decisions without accepted worker evidence: maximum 2 rounds per phase, preserving genuine active child jobs. Technical no-progress = blocked attempt, not proof project abandonment.
- No elapsed-time takeover if lease delivery may have occurred. Reassign only with authoritative no-delivery evidence and safe lease release; never two writers.
- Resource outage: try eligible failover only if permission/scope preserved; external dependencies trigger review only on material change. Do not generate endless PRs, checkpoints, or "recovery" tickets.
- Hard deadline is a checkpoint/escalation threshold, not a license to fabricate acceptance or promise completion.

## 4. Machine-observable states and owner reports
`READY → CLAIMED → EXECUTING → VERIFYING → REVIEWING → ACCEPTED_STEP → NEXT_STEP` with terminal `DONE_PRODUCT_ACCEPTED | BLOCKED_SCOPE | EXTERNAL_WAIT | OWNER_FROZEN | CANCELLED`.
Always report separately:
- runtime/service health;
- number of internal/maintenance jobs;
- accepted milestones / locked milestone count (never report 100% before final product verification);
- last verified artifact and check result;
- current executor + durable job/lease + heartbeat (or no active execution);
- exact current blocker + next trigger.
Source-only policy/checklist and test PASS never imply a live feature is deployed or active.

## 5. Current freeze is not superseded
At owner instruction on 17/10/2026: #4783, #4456, #4780 and #2293 remain P0 `OWNER_HOLD=true`; App Chrome NV02–04 and local supervisor remain stopped. This document and source candidate do NOT unfreeze, dispatch, restart Chrome, change device credentials, or grant protected operator rights. G6 #4902 is P0 controlled by Owner/Vy; real native Core→Manager→Worker→reviewer→G5 with rollback has not been accepted in the current audit.

## 6. Mandatory rollout acceptance (before enabling any project)
A separately authorized, isolated, reversible **real** non-production canary must produce:
1. one canonical Work Order and bounded plan with an explicit final product test;
2. exact job/resource/owner/lease/fencing IDs and unambiguous worker delivery;
3. one implementation change and a different reviewer (where required), verifiable source SHA and actual tests;
4. durable real acceptance evidence plus restart/recovery without duplicate execution and successful rollback;
5. readback of `ACCEPTED_STEP` then correctly chosen `NEXT_STEP`, and eventual true terminal decision;
6. negative tests: no fake DONE from a closed Issue, offline test, stale receipt, frozen owner item, missing reviewer, failed lease, or missing device key.
Any missing receipt => `NOT_ACCEPTED`, no rollout, retain freeze.

## 7. Implementation status
Core source already has manager retry budget, source-revision acceptance metadata, step checklist and lease guards. This policy supplements rather than replaces them. The adjacent P0 PR adds default live-acceptance admission for explicitly labeled product Work Types and tests history isolation; real full lifecycle, independent end-to-end canary, runtime rollout and Owner unfreeze remain separate verified gates. Do not describe this document alone as a running automation.
