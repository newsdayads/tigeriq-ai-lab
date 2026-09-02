# TIGERIQ — AUTONOMOUS HANDOFF LOOP V1

Status: GOVERNANCE CONTRACT · OFF MAIN/PRODUCTION  
Issue: #162  
Base policy: Chief of Staff Policy V2 exact `0f673f92b703c8c67e8a89cb23a0c5f7307db3f2`

## 1. Purpose

TigerIQ must not require Sếp to relay messages between AI Employees. The Owner gives the goal/constraints once. CHAT00 remains orchestration authority and owns routing between execution, assurance and next-stage work.

Canonical rule:

`Owner goal once → CHAT00 assigns owner → executor audits/executes/self-tests/publishes exact evidence → risk gate decides assurance → direct structured handoff → PASS advances / FAIL returns to executor → fix/retest/new evidence → re-submit → PASS or REAL BLOCKER`

Sếp is never the message bus between Executor, Reviewer or Judge.

This contract changes governance/control flow only. It does not implement runtime automation, modify PR #157, or mutate PC01/Web/Android/PostgreSQL/provider code.

## 2. Root-cause audit

The Company Constitution already makes Chief of Staff the orchestration role and requires evidence/independent review for material work. Workflow already says gate failure means `root-cause → fix → retest` and that work continues without unnecessary confirmation. The AI Employee Model already separates Executor/Reviewer/Judge.

The operational gap is the missing **handoff protocol and ownership of transitions**. Current workstreams frequently stop at phrases such as `READY FOR CHAT05`, `hand back to CHAT05`, or ask Sếp to move a FAIL finding back to the executor. This creates a human message-bus bottleneck that is not an Owner decision.

The fix is not more review. The fix is a deterministic loop with CHAT00-owned transitions, exact evidence and risk-based assurance.

## 3. Authority and ownership

### Sếp / Owner
Owns goals, priorities, reserved decisions and explicit approvals. Sếp is involved only when the action requires Owner authority or unavoidable physical participation.

### CHAT00 — orchestration authority
CHAT00 owns:
- intake and goal-to-workstream routing;
- selecting the accountable Executor/Department;
- assigning an eligible independent Reviewer/Judge when required;
- creating/forwarding structured handoffs from authoritative evidence;
- moving state after PASS/FAIL;
- detecting stale evidence, duplicate review, timeout and loops;
- routing REAL BLOCKER/EXTERNAL WAIT without involving Sếp unless Owner authority is actually required;
- concise Owner reporting.

CHAT00 must not satisfy an independent Reviewer/Judge gate for work it authored when independence is required.

### Executor / owning CHAT
The owning CHAT owns the work until terminal PASS/DONE or a real blocker is accepted. It must:
- audit current truth;
- execute inside delegated authority;
- self-test/self-check;
- publish exact evidence;
- create or update the handoff package when review is required;
- on FAIL, consume structured blockers directly, fix, retest and produce **new exact evidence**;
- never ask Sếp to carry the result to CHAT05.

### CHAT05 — Independent Quality Gate
CHAT05 is a quality gate, not an orchestration hub and not a task owner. It must:
- review only when the action/risk/process requires independent assurance;
- inspect exact evidence rather than executor conclusions;
- emit PASS or structured FAIL;
- on PASS, return the verdict to CHAT00/owning workstream so the next allowed stage advances;
- on FAIL, return blockers directly to the owning Executor/CHAT00;
- not implement the fix it is judging;
- not repeatedly review an unchanged exact-evidence fingerprint.

### Judge
Judge is used only where policy requires a separate final gate. Judge consumes Executor evidence plus Reviewer verdict; it does not replace Owner authority.

## 4. State machine

```text
GOAL_RECEIVED
  ↓ CHAT00
OWNED
  ↓
AUDITING
  ↓
EXECUTING
  ↓
SELF_VERIFYING
  ├─ self-check FAIL → EXECUTING (bounded correction)
  ↓ PASS
EVIDENCE_READY
  ↓ risk/policy gate
  ├─ REVIEW_NOT_REQUIRED → NEXT_STAGE_OR_DONE
  └─ REVIEW_REQUIRED → HANDOFF_READY → REVIEWING
                                  ├─ PASS → [JUDGE_REQUIRED ? JUDGING : NEXT_STAGE_OR_DONE]
                                  └─ FAIL → REWORK_REQUIRED → EXECUTING
                                                        ↓ new exact evidence only
                                                     HANDOFF_READY

JUDGING
  ├─ PASS → [OWNER_GATE_REQUIRED ? AWAITING_OWNER : NEXT_STAGE_OR_DONE]
  └─ FAIL → REWORK_REQUIRED

Any state may transition to:
- POLICY_BLOCK
- REAL_BLOCKER
- EXTERNAL_WAIT
- CẦN_SẾP only under §9
```

Terminal states are `DONE`, `POLICY_BLOCK`, or accepted `REAL_BLOCKER`. `EXTERNAL_WAIT` is non-terminal and must carry a resume condition.

## 5. Review fingerprint — no duplicate review

Every review request has:

`review_fingerprint = artifact/scope ref + exact_head_or_version + evidence_set_hash + acceptance_policy_ref + risk_classification`

Rules:
1. A complete PASS/FAIL verdict is authoritative for that fingerprint until its evidence becomes stale or policy/scope changes.
2. CHAT05 must **not re-review the same fingerprint** merely because the executor resubmits the same text.
3. A FAIL may be re-reviewed only when the handoff identifies `changed_since_last_review` and the fingerprint changes because of new exact evidence, changed artifact/version, or changed applicable policy.
4. A re-review of the same fingerprint is allowed only when the prior review is proven incomplete/invalid/corrupted; the reason must be recorded.
5. If head/version changes after PASS, the old review is stale for the changed scope unless the change is formally proven outside the reviewed scope.

## 6. Handoff contract

Every autonomous handoff must contain at minimum:
- `handoff_id`;
- `work_ref` (Issue/Mission/Job/PR as applicable);
- `from_role` and `to_role`;
- `accountable_executor`;
- `stage`;
- `risk_level`;
- `gate_reason`;
- `scope` and acceptance criteria;
- `exact_head_or_artifact_version`;
- `evidence_refs` and evidence-set hash/fingerprint;
- `review_fingerprint`;
- `prior_verdict_ref` when re-submitting;
- `changed_since_last_review` when re-submitting;
- requested verdict/gate;
- constraints, especially Owner-reserved boundaries;
- next state on PASS;
- return owner on FAIL.

A FAIL response must contain:
- exact reviewed fingerprint;
- severity and finding IDs;
- FACT / RISK / REQUIRED FIX for every blocker;
- whether the blocker is review-blocking or advisory;
- evidence required for closure;
- explicit `return_to` accountable Executor;
- no request for Sếp to relay the message.

Machine-readable shape is defined in `schemas/autonomous-handoff-v1.schema.json`. It is a governance contract, not a runtime implementation.

## 7. Evidence contract

Evidence must be exact and source-bound. Depending on work type it includes:
- exact Git SHA / document version / artifact hash;
- changed-scope refs;
- CI/test run IDs and conclusions;
- Preview/deployment URL only when actually required and proven bound to exact head;
- physical-device/PC01 evidence only when physically observed;
- authoritative source refs/provenance for business claims;
- prior review/judge/Owner approval refs when applicable.

Forbidden:
- claiming live/physical PASS from repository tests;
- using stale review evidence for a changed head;
- executor-generated prose as a substitute for required test/source evidence;
- secrets/credentials in handoff evidence;
- marking external wait as technical PASS.

## 8. Risk-based assurance — prevent over-review

Risk is action-level.

| Risk | Default gate | Independent Reviewer | Judge | Owner |
|---|---|---|---|---|
| R0 | Self-check / deterministic validation | No | No | No |
| R1 | Self-check + applicable CI/rules | No by default; sampled/process-specific only | No | No |
| R2 | Strong validation; independent review only when action/process policy requires | Conditional | Conditional | Only if authority requires |
| R3 | Independent review mandatory | Yes | When release/security/process policy requires | If authority requires |
| R4 | Critical/Owner-reserved assurance | Yes when reviewable | Yes when policy requires; default for release/security critical gates | Required for Owner-reserved action |

Hard floors:
- high-impact security/engineering change: at least R3 + independent Reviewer;
- Production release/promotion: R4 + required release assurance + Owner approval;
- every financial commitment: R4 + Owner approval;
- material legal/irreversible action: R4, Owner authority as required by Constitution;
- broad credential/permission/autonomy expansion or approval/risk-policy change: R4 Owner-reserved;
- unavoidable physical action by Sếp: `CẦN_SẾP` for the physical step, not for message relay.

Typical work that should **not** be sent to CHAT05 by default:
- R0 read/search/summary/status aggregation;
- R1 drafts, internal reports, reversible documentation edits with deterministic checks;
- CI reruns with no material scope change merely to observe an existing gate;
- pure formatting/metadata correction that does not alter authority/security/release behavior.

An Issue may explicitly require stricter assurance than the default matrix; it may not weaken hard floors.

## 9. `CẦN SẾP` — narrow escalation only

Use `CẦN SẾP` only when one or more is true:
1. a genuine Owner decision/priority/authority choice is required;
2. financial commitment/payment/subscription/borrowing/investment is proposed;
3. material security/privacy/legal decision requires Owner authority;
4. Production release/promotion requires Owner approval;
5. irreversible/destructive action requires Owner authority;
6. credential/permission/autonomy/risk-policy authority must be broadened;
7. an unavoidable physical action requires Sếp at a device/machine.

Do **not** use `CẦN SẾP` for:
- sending executor output to a reviewer;
- sending reviewer FAIL back to executor;
- choosing another eligible independent reviewer;
- routine retry/retest;
- CI/provider/Vercel quota wait;
- reviewer queue delay;
- a technical blocker that has a safe specialist/fallback path.

Those are handled by CHAT00 as normal orchestration, `EXTERNAL_WAIT`, or `REAL_BLOCKER`.

## 10. Bounded correction, anti-loop and timeout

### Correction budget
Default business/governance correction budget remains **2 correction cycles after the initial submission** unless an owning policy sets a stricter bound. A cycle is counted when a valid independent FAIL causes material rework and a new review fingerprint.

### Anti-loop
CHAT00 stops automatic rework and marks `REAL_BLOCKER` when:
- correction budget is exhausted;
- the same blocker recurs after two materially adequate attempted fixes;
- the proposed fix would expand authority or cross a hard risk floor without approval;
- required evidence cannot be produced truthfully;
- independence cannot be satisfied with available eligible reviewers;
- progress depends on an external condition with no safe action now.

A REAL BLOCKER is not automatically `CẦN SẾP`. Escalate to Sếp only if §9 applies.

### Timeout / staleness
- A handoff becomes stale immediately if exact head/artifact/scope changes.
- A review request with no reviewer progress for the process-defined SLA is rerouted by CHAT00 to another eligible independent Reviewer before involving Sếp.
- If no SLA exists, use 24 hours as governance staleness threshold for queue health; this is a reporting/escalation threshold, not permission to bypass a gate.
- `EXTERNAL_WAIT` must include `wait_reason`, `resume_condition`, and `last_checked_at`; do not blind-retry more often than the owning external-limit policy permits.

## 11. PASS / FAIL transition rules

### Reviewer PASS
CHAT05 records exact fingerprint + PASS evidence and sends state to CHAT00. CHAT00 advances automatically to:
- Judge, if required;
- Owner gate, if required;
- next dependency/stage;
- DONE, if acceptance is complete.

Sếp does not need to forward PASS.

### Reviewer FAIL
CHAT05 records structured blockers and `return_to`. CHAT00 routes directly to the owning Executor. Executor fixes/self-tests and may re-submit only with a new fingerprint/new exact evidence. Sếp does not need to forward FAIL.

### Judge FAIL
Same behavior: structured blockers return to the accountable owner; no Owner relay.

## 12. Immediate application to CHAT01–06

### CHAT01 — Web / Owner Cockpit
- Own implementation, self-test, UI/mobile CI and exact Preview evidence.
- R0/R1 presentation/docs work: no CHAT05 by default.
- Material auth/authority/provenance/security change: R3 review.
- If the owning Issue explicitly requires independent UX/release review, CHAT01 publishes exact evidence and hands directly to CHAT05 through CHAT00; Sếp does not relay.
- Vercel quota is `EXTERNAL_WAIT`, not `CẦN SẾP` and not repeated review.

### CHAT02 — Android / device AI employee
- Research/docs and non-mutating preflight: R0/R1 unless security policy raises it.
- Signing, credential authority, device-proof/security or material runtime change: R3 independent review.
- Physical install/tap/permission step on Sếp's device may become `CẦN SẾP` only at the unavoidable physical step.
- FAIL returns directly to CHAT02; no Owner relay.

### CHAT03 — Work/Data/PostgreSQL
- Data-model/design docs: R1/R2 according to impact.
- Migration/runtime consistency/security changes: at least R3.
- Physical/Production datastore mutation: applicable R4/Owner gate.
- Reviewer findings return directly to CHAT03 with exact migration/schema evidence required for closure.

### CHAT04 — Chief/Policy/AI coordination policy
- Routine documentation: R1.
- Company-wide authority/risk/escalation policy changes, including this contract: R3 independent review because they materially alter governance behavior.
- CHAT04 authors; CHAT05 independently reviews. CHAT04 must not self-pass its own governance gate.

### CHAT05 — Independent quality gate
- Accept only review-required handoffs with exact fingerprint/evidence.
- Do not become implementation owner or central queue for R0/R1 work.
- Do not repeat a completed review on unchanged evidence.
- PASS routes forward through CHAT00; FAIL routes back to owning CHAT with structured blockers.

### CHAT06 — PC01 / controller / physical operations
- Repo-only bootstrap/security preparation is R3 where it changes high-impact runtime/security behavior.
- Physical execution requiring Sếp at PC01 is `CẦN SẾP` only for the physical action/authorization, not for CHAT06↔CHAT05 messaging.
- Existing PR #157 / PC01 lane is untouched by WO-162.

## 13. Adoption rule for all new and active work

Effective immediately at the governance/process level:
1. Every active Issue names one `accountable_executor`.
2. If independent review is required, the Issue/PR records `review_required=true`, reviewer role and exact handoff fingerprint.
3. Executor completion messages are addressed to CHAT00/next gate, not to Sếp as a relay request.
4. CHAT05 verdicts include `return_to` and `next_state`.
5. CHAT00 owns the transition until terminal state.
6. Owner-facing summaries show only outcome, genuine exception and decisions needing Sếp.

Runtime automation of these fields may be implemented later by a separate authorized work order. The policy does not claim that cross-chat message transport is already physically automated.

## 14. Definition of READY for WO-162

`AUTONOMOUS_HANDOFF_LOOP_READY` may be emitted only when:
- this policy is committed;
- Workflow, AI Employee Model and Decision Log reflect the same rule;
- the machine-readable handoff contract is committed;
- exact-head repository CI/applicable gates pass;
- diff proves PR #157/runtime/MAIN/Production are untouched;
- CHAT05 independent review is handed off for this R3 governance change.
