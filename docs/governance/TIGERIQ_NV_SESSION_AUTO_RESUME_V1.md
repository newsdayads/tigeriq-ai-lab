# TIGERIQ — NV SESSION AUTO-RESUME V1

Status: GOVERNANCE CONTRACT · OFF MAIN/PRODUCTION  
Issue: #165  
Parent orchestration contract: `TIGERIQ_AUTONOMOUS_HANDOFF_LOOP_V1` at corrected independently-reviewed base exact `48329cfe4ba9759232637f3f97f8371f0d39df22`.

## 1. Purpose

A TigerIQ chat session is disposable; an AI Employee identity and its accountable work are persistent company state.

When a fresh chat receives only `NV XX`, that input is the authoritative employee identity selector for the session. The receiving session must restore the employee role, audit authoritative work state, recover the highest-priority actionable assignment, and immediately continue the next safe action when one exists.

Canonical behavior:

`NV XX → restore identity → load Source of Truth → audit authoritative queue/current evidence → select work deterministically → stale/duplicate guard → continue next safe action`

The session must not stop after merely announcing that the role was restored. It must not ask Sếp to return to NV00 or copy a handoff prompt when the required work can be recovered from authoritative state.

This protocol extends the Autonomous Handoff Loop; it does not create a parallel orchestration model or a runtime lease service.

## 2. Registered employee identity

Current registered identities are `NV00` through `NV06`. Input MAY contain whitespace between `NV` and the two digits and is normalized to `NVXX`, for example `NV 04` → `NV04`.

Unknown/unregistered employee numbers fail closed. A session must not invent a role, authority, assignment, or queue for an unknown identity.

The identity token chooses the employee context only. It never grants new authority, bypasses a review/release/Owner gate, or proves that work is actionable.

## 3. Mandatory restore audit

Before emitting an idle conclusion, the session must audit, in precedence order:

1. Company Constitution and explicit current Owner instruction.
2. Workflow, AI Employee Model, Decision Log and the current approved orchestration policy.
3. Current authoritative work queue for that employee: open Issues/Missions/Jobs/PRs and explicit CHAT00 assignment pointers.
4. Current exact evidence/state for candidate work: status, dependency readiness, current exact Git head or artifact version, review/judge/Owner gate state, blockers and external-wait resume conditions.
5. Latest valid autonomous handoff/current-task pointer for that employee.

Repository/CI evidence must not be treated as physical-device evidence. An old chat transcript is context only when a newer authoritative work item/evidence disagrees with it.

## 4. Deterministic work selection

If more than one candidate exists, select in this order:

1. explicit current CHAT00 assignment precedence;
2. `P0` before `P1` before `P2`/lower;
3. dependency-ready actionable work before blocked/waiting work;
4. oldest work blocking a critical path before non-blocking work;
5. newer exact authoritative state over stale session memory.

If two candidates remain genuinely ambiguous and choosing one would change authority, risk, destructive scope or an Owner-reserved decision, fail closed and surface the ambiguity. Do not ask Sếp merely because several safe tasks exist; choose deterministically using the rules above.

## 5. Resume result

After the audit, exactly one operational result applies:

- `CONTINUE`: actionable work exists; immediately start the next safe action in the same session.
- `BLOCKED`: work exists but a real blocker prevents safe progress; report the real blocker and the evidence/resolution condition.
- `WAITING`: work exists but depends on a truthful external condition; preserve the resume condition and do not blind-retry.
- `IDLE`: only when the authoritative queue audit is complete and proves no actionable, blocked or waiting assignment is owned by the employee.

Visible `RẢNH` is permitted only for `IDLE` after that audit. A missing prompt in the new chat is not evidence that the employee is idle.

## 6. Immediate-continuation rule

For `CONTINUE`, the first concise status MAY be:

`🟢 NVXX — <ROLE> | ĐÃ PHỤC HỒI · ĐANG TIẾP TỤC: <work_ref>`

The session must then execute the next safe step immediately. It must not stop for `tiếp tục?`, ask the Owner to repeat the assignment, or use the Owner as the message bus between AI Employees.

If the recovered work reaches a required Reviewer/Judge gate, use the Autonomous Handoff Loop directly. PASS advances; FAIL returns structured blockers to the accountable executor; Sếp does not relay normal AI-to-AI handoffs.

## 7. Resume snapshot and stale-session guard

Every recovered session must form a resume snapshot before any mutating action:

- `employee_id`;
- `work_ref`;
- observed `work_state`;
- `priority`;
- `exact_head_or_artifact_version` when versioned;
- latest `handoff_ref` when present;
- dependency/gate status;
- `observed_at`;
- intended next safe action.

Immediately before a mutation, re-read the authoritative work item and any exact version being mutated.

Mutation is allowed only when the relevant state still matches the resume snapshot. If the work state, exact head/artifact version, ownership pointer, mandatory gate, or dependency state changed, the snapshot is stale: abort that mutation, re-audit, and select again.

### Machine-readable mutation-guard binding

For `result=CONTINUE`, `mutation_guard` is not an independent second opinion about the selected work. It is a mandatory binding back to the exact resume snapshot selected above.

The contract uses invariant `NV-RESUME-MUTATION-GUARD-BINDING-V1` and requires a deterministic contract validator to enforce all cross-field equality rules:

- `mutation_guard.expected_work_ref == selected_work_ref`;
- `mutation_guard.expected_work_state == work_state`;
- if `exact_head_or_artifact_version` is present, `mutation_guard.expected_exact_head_or_artifact_version` is mandatory and must equal it exactly;
- if the selected snapshot is unversioned, the guard must not fabricate an expected exact version.

A plain JSON-Schema structural PASS without these equality checks is insufficient evidence for a mutation. Any missing/mismatched binding fails closed before mutation.

Never force a stale head merely to preserve an older chat plan.

## 8. Duplicate-session protection

Two live sessions of the same NV may exist. This protocol therefore uses optimistic concurrency against authoritative state; it does not pretend that chat identity itself is an exclusive lock.

Before each mutation, the session must prove that:

1. the same employee still owns/is accountable for the selected work;
2. the authoritative work state still permits the intended transition;
3. the exact Git head/artifact version still equals the observed version when versioned;
4. another session has not already produced the intended state/evidence/handoff.

If another session advanced the work, the later session must consume that new state rather than duplicate the mutation. If both would create conflicting writes, fail closed, re-audit and choose the remaining safe next action.

Read/search/status aggregation may proceed concurrently because it is non-mutating.

## 9. Idle proof

`IDLE/RẢNH` requires all of the following:

- employee identity is registered;
- Source of Truth load succeeded to the available authoritative level;
- current employee queue was audited;
- no ACTIVE actionable assignment exists;
- no BLOCKED/WAITING assignment requires preservation/reporting;
- no valid handoff/current-task pointer is awaiting this employee;
- no higher-precedence CHAT00 assignment exists.

Failure to read an authoritative queue is not idle proof. Report a read/access blocker instead of fabricating `RẢNH`.

## 10. Regression scenarios

### Scenario A — fresh `NV 04`
Given NV04 owns open P0 Issue #165, a fresh chat receives only `NV 04`.

Required result: normalize `NV04`, audit queue, recover #165, report `ĐANG TIẾP TỤC: #165`, and begin the next safe repo/governance action. `RẢNH` is invalid.

### Scenario B — fresh `NV 06`
Given NV06 owns an active P0 PC01 lane with an Issue/PR/exact head, a fresh chat receives only `NV 06`.

Required result: recover the current Issue/PR/exact head and continue safe repo-side work, or report the real physical/review/external gate. It must not substitute stale head evidence or report idle.

### Scenario C — no work
Given the authoritative audit proves no ACTIVE/BLOCKED/WAITING assignment or valid handoff exists for the employee, `RẢNH` is valid.

### Scenario D — duplicate session
Session A snapshots work at head `H1`; Session B advances the same work to `H2`. Before Session A writes, it must detect `H1 != H2`, abort the stale write, re-audit and consume `H2`.

### Scenario E — mismatched mutation guard
A CONTINUE snapshot selects `Issue #165`, `ACTIVE`, version `H1`. A guard that names another work ref, another state, omits the expected version, or names `H2` is invalid and must fail before mutation.

## 11. Compatibility and boundaries

- `TIGERIQ_AUTONOMOUS_HANDOFF_LOOP_V1` remains the canonical transition/review model.
- `TIGERIQ_INTERCHAT_HANDOFF_STANDARD_V1` remains a presentation compatibility rule for any exceptional Owner-visible handoff; this protocol removes the need for routine Owner-relayed handoffs where authoritative state is recoverable.
- No Runtime/Web/Android/PC01/PostgreSQL/provider behavior is implemented by this contract.
- No MAIN/Production mutation, paid service, secret handling change, or release authorization is implied.
- The protocol cannot bypass `CẦN SẾP`, independent review, Judge, security, financial, legal, physical or Production gates when those gates truly apply.

Marker: `NV_SESSION_AUTO_RESUME_READY` is valid only after the scoped documentation/schema/regression evidence passes the applicable exact-head gates and required independent governance review.
