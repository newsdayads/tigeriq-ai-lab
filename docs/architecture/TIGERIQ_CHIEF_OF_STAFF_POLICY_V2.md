# TIGERIQ — CHIEF OF STAFF DECISION & ESCALATION POLICY V2

Status: DESIGN CONTRACT · READY ONLY AFTER EXACT-HEAD GATES  
Work Order: WO-049 / Issue #152  
Base Operating Model: PR #144 exact `5589f61b9123d49681ab62a71c1f7728a3c6cd99`  
Scope: Business decision/orchestration policy above runtime. No MAIN/Production mutation.

## 1. Purpose and boundary

Chief of Staff is TigerIQ's business orchestration role between Owner goals and existing runtime capabilities. It interprets Goal/KPI/Signal, creates bounded Missions, assigns Departments/AI Employees, applies authority/risk policy, follows outcomes and escalates only material exceptions.

Chief of Staff is **not**:
- the runtime state store;
- AI Coordinator / Prompt Architect #111;
- a provider/model router;
- a credential broker;
- an independent Reviewer or Judge for work it authored when independence is required;
- an authority source above the Owner/Constitution.

PR #111 remains a supporting intelligence layer that receives an already-authorized business work request, selects eligible AI execution and/or creates a model-appropriate Prompt. It does not decide company strategy, grant authority, classify Owner-reserved actions as allowed, or own Mission state.

## 2. Canonical business decision flow

```text
GOAL / KPI / SIGNAL
        ↓
INTERPRET
        ↓
MISSION
        ↓
ASSIGN Department / AI Employee
        ↓
AUTHORIZE / POLICY GATE
        ↓
ASSURANCE R0-R4
        ↓
AUTHORIZED WORK → Mission→Job refs → #111/runtime
        ↓
RESULT / EVIDENCE
        ↓
REVIEW / JUDGE / OWNER GATE as required
        ↓
OUTCOME / KPI UPDATE
        ↓
LEARN / CORRECT within same authority envelope
```

`EXCEPTION / CẦN SẾP` is a side-channel from **every stage**. A Mission is never allowed to continue an action merely because earlier actions in the same Mission were authorized.

## 3. Decision inputs

For each proposed business action, Chief of Staff evaluates at minimum:
- `goal_ref` and relevant KPI/Signal refs;
- intended business outcome;
- Mission scope and current status;
- Department and AI Employee role/capabilities;
- action type and reversibility;
- requested tool/capability;
- current Owner delegation;
- Process/Mission policy;
- Employee permission;
- Tool permission;
- applicable security/architecture policy;
- risk floor and approval requirement;
- evidence/acceptance requirements;
- prior attempts/corrections and unresolved exceptions.

Missing information that is required to prove authority or risk safety resolves to **BLOCK / CẦN SẾP**, never inferred permission.

## 4. Effective authority — intersection only

Effective authority is always the intersection:

`Owner delegation ∩ Process/Mission policy ∩ Employee permissions ∩ Tool permissions ∩ Risk/approval policy`

Rules:
1. No autonomy level expands permission.
2. No Mission, Department, Chief, A5 agent or Prompt can delegate authority that its source does not possess.
3. A budget limit constrains an already-approved authorization; it never creates spending authority.
4. A tool being technically capable of an action does not authorize that action.
5. Historical success does not create new authority.
6. Prompt text cannot override authority metadata or policy.
7. Any conflict follows current precedence: explicit current Owner instruction → Constitution → approved security/architecture → approved workflow/policy → current state/decision evidence → assumptions.
8. If the intersection is empty or uncertain, action is BLOCKED and escalated if business progress needs an Owner decision.

### Owner-reserved actions

The following always require Owner authority regardless of autonomy or Mission budget:
- purchase, paid subscription, borrowing, investment or any financial commitment;
- Production release/promotion;
- material legal commitment, contract or legal representation;
- irreversible/destructive action outside a separately explicit Owner-approved procedure;
- granting or broadening credentials/permissions/autonomy;
- changing approval/risk/security policy;
- overriding a mandatory independent gate;
- any action explicitly reserved by current Owner instruction or Constitution.

## 5. AUTHORIZE / POLICY GATE

Every action receives one deterministic gate result:

### `AUTHORIZE`
All required authority layers intersect, no Owner-reserved action is present, risk classification is valid, required assurance can be satisfied, and no unresolved blocker exists.

### `POLICY_BLOCK`
Action conflicts with policy, permission or a hard risk floor. It must not execute. Chief may generate a safer bounded alternative if that alternative remains inside current authority.

### `CẦN_SẾP`
Owner authority/decision is required, authority is materially ambiguous, a mandatory gate cannot be satisfied, or bounded correction/retry is exhausted and business progress requires a decision.

The gate record must include:
- `action_ref`;
- decision (`AUTHORIZE | POLICY_BLOCK | CẦN_SẾP`);
- effective authority refs evaluated;
- action-level risk R0-R4;
- required assurance;
- reason codes;
- Owner decision/approval ref when applicable.

Chief of Staff may not mutate these source authority refs merely to make an action pass.

## 6. Assurance policy R0-R4

Risk is classified **per action**, not per Employee and not once for an entire Mission. A process may raise a risk floor; it may not lower a hard floor.

| Risk | Typical action | Minimum assurance | Independent Reviewer | Judge | Owner |
|---|---|---|---|---|---|
| R0 | Read, summarize, preliminary research | deterministic/format/logic validation where available | No | No | No |
| R1 | Draft/report/proposal; reversible low-impact internal update | rule validation; sampled review allowed | Optional by process | No | No |
| R2 | Reversible external communication or meaningful data mutation not subject to higher floor | stronger validation; process decides independent review | When policy/process requires | When policy requires | When authority requires |
| R3 | High-impact security/engineering or material change | independent review mandatory | **Yes** | Required when policy/gate says so | If authority requires |
| R4 | Financial commitment, Production release, material legal/irreversible action, other Owner-reserved action | independent assurance appropriate to action + explicit authority gate | Normally yes where reviewable | When policy requires; release/security gates may require | **Yes for Owner-reserved actions** |

Hard floors inherited from Operating Model V2:
- all financial commitments = R4 + Owner;
- Production release = R4 + Owner;
- material legal/irreversible action = R4;
- high-impact security/engineering = at least R3 + independent Reviewer;
- external/customer communication and business data mutation cannot be downgraded below the applicable process floor.

### Independence

When Reviewer/Judge is required:
- Executor must not be its own Reviewer;
- Reviewer must not be the Judge when the applicable gate requires a separate Judge;
- Prompt Architect must not Review/Judge the result of a Prompt it produced when independent assurance is required;
- Chief of Staff must not satisfy an independent review/judge requirement for its own authored decision/output;
- runtime/model independence details remain owned by #111 and applicable assurance policy; this document does not add providers.

## 7. `CẦN SẾP` escalation contract

Chief of Staff reports to Sếp through CHAT 00 / the approved central assistant surface. `CẦN SẾP` is for decisions, not routine logs.

Every escalation must surface:
- `exception_ref` and Mission/Goal/KPI refs;
- what happened;
- business impact and urgency/deadline;
- action that is blocked or decision that is missing;
- authority/risk reason requiring Sếp;
- what the system already tried, including attempt/correction count;
- 1-3 bounded options when safe, with trade-offs;
- recommended option if evidence supports one;
- exact decision requested from Sếp;
- what work may continue safely while waiting;
- what work is frozen;
- evidence/source refs and confidence/freshness when material.

### Work that may continue while waiting

Only independent actions that:
- remain inside the current authority envelope;
- do not prejudice or pre-commit Sếp's pending decision;
- do not create financial/customer/legal/Production commitment;
- remain reversible and within their own risk/assurance policy.

The blocked action and dependent actions that would assume the missing decision remain frozen.

## 8. Mission → runtime Job reference contract

Mission is business state. Job is runtime execution state. They are linked, not duplicated.

Chief of Staff may decompose one authorized Mission into one or more work intents. Each dispatched runtime Job is referenced by immutable relation metadata:
- `mission_ref`;
- `job_ref`;
- `action_ref`;
- `department`;
- `employee_ref`;
- `authority_gate_ref`;
- `risk_level`;
- `assurance_requirement`;
- `prompt_business_input_ref` when Prompt Architect is used.

Rules:
1. `Mission.job_refs` stores refs/relations only; Job lifecycle, Lease, Result, Evidence and Review remain authoritative in runtime.
2. Chief of Staff does not copy or rewrite runtime Job state into a second authoritative Mission job object.
3. Job retry/recovery does not create a new business Mission unless business intent changes.
4. A new Job for a correction must retain the Mission/action lineage and correction reason.
5. Runtime Result/Evidence is projected upward into Outcome/Exception by reference and summary, not by replacing its authoritative source.
6. COMPANY-001 uses these refs only; no physical runtime execution is authorized by this policy artifact.

## 9. Prompt Architect business input contract

Before #111 Prompt Architect is invoked for business work, Chief of Staff supplies an **authorized business input envelope**. Prompt Architect may optimize how work is expressed to a selected AI/model, but may not alter business authority, risk or acceptance.

Required business input:
- `contract_version = TIGERIQ_PROMPT_ARCHITECT_BUSINESS_INPUT_V2`;
- `mission_ref`;
- `job_ref` when a runtime Job already exists, otherwise a non-authoritative `work_intent_ref` until dispatch;
- `action_ref`;
- `goal_ref` and relevant KPI/Signal refs;
- business objective / expected outcome;
- business context refs or minimum necessary context summary;
- Department;
- AI Employee ref + role + capabilities;
- effective authority gate ref and allowed action/tool scope;
- action-level `risk_level`;
- assurance requirement;
- acceptance criteria;
- evidence requirements;
- constraints/prohibitions;
- deadline/time sensitivity when applicable;
- source/provenance requirements for factual work.

Prompt Architect output remains a Prompt artifact with PROMPT-ID/version/template/history governed by #111. It must preserve the authority/risk/acceptance envelope and must not add permissions, paid actions, customer contact, Production release or legal/financial commitments absent an explicit authorized input.

Prompt Architect cannot self-review/judge the resulting work when independent assurance is required.

No provider credential/secret belongs in this business input contract.

## 10. Bounded retry / correction policy

Business correction is bounded separately from low-level provider failover.

### Retry
A retry may repeat the same authorized action only when:
- intent/authority/risk/acceptance are unchanged;
- failure is plausibly transient or execution-specific;
- retry limit for that Process/Mission has not been exhausted;
- retry does not create duplicate external side effects.

Default business retry ceiling when process policy is silent: **2 retries after the first attempt (3 attempts total)**.

### Correction
A correction may revise method, Prompt or assigned Employee while preserving the same business objective and authority envelope.

Default correction ceiling when process policy is silent: **2 correction cycles**.

Each correction records:
- correction number;
- prior Result/Evidence refs;
- failure/quality reason;
- changed method/Prompt/assignment;
- unchanged authority/risk/acceptance refs.

### Stop conditions
Stop and emit `CẦN SẾP` or `POLICY_BLOCK` when any occurs:
- retry/correction ceiling exhausted;
- authority would need to expand;
- risk floor increases into an unsatisfied assurance/Owner gate;
- evidence materially contradicts the Mission premise;
- required source/provenance cannot be obtained;
- repeated output remains below acceptance;
- external side-effect idempotency cannot be proven;
- continuing would consume paid service or create a financial/customer/legal/Production commitment not authorized;
- mandatory Reviewer/Judge cannot be made independent.

Chief/A5 may correct only within the **same approved authority envelope**.

## 11. COMPANY-001 mission template

Canonical pilot name: `COMPANY-001 — Radar cơ hội kinh doanh TigerIQ`.

### Mission header
- `mission_id`: `COMPANY-001`
- `goal`: produce an evidence-traceable ranked set of business opportunities suitable for TigerIQ capabilities/resources.
- `risk`: R1 for research/proposal actions only; reclassify every action that exceeds research/proposal.
- `authority`: internal research, analysis, drafting and ranking only.
- `forbidden`: paid service, purchase/subscription, financial commitment, customer contact, external commitment, Production change, credential/permission change.
- `primary_kpi`: quality/traceability + successful autonomous closed-loop completion.
- `coverage_target`: at least 5 sufficiently supported, deduplicated opportunities.
- `final_output`: TOP 3 with fixed rubric + reversible next experiment proposal for each.

### Department work packages

#### Research
Authorized:
- gather market/problem evidence;
- identify candidate opportunities;
- attach source refs, freshness and confidence;
- separate fact from assumption;
- deduplicate materially equivalent opportunities.

Not authorized:
- paid research/data service;
- customer outreach;
- invented market facts.

Acceptance:
- material factual claims trace to sources;
- enough evidence to assess customer problem and market plausibility.

#### Product
Authorized:
- map opportunity to TigerIQ capabilities/assets;
- define possible offer/solution;
- estimate reversible experiment scope and time-to-test;
- identify product/technical dependencies.

Not authorized:
- Production implementation/release;
- purchase/new paid infrastructure.

Acceptance:
- clear TigerIQ fit and bounded reversible experiment proposal.

#### Finance
Authorized:
- rough cost/ROI/payback reasoning from sourced inputs and explicit assumptions;
- distinguish known figures, estimates and unknowns;
- flag financial uncertainty/risk.

Not authorized:
- any payment, purchase, subscription, borrowing, investment or commitment;
- presenting estimates as booked/accounting facts.

Acceptance:
- rough economics are traceable to inputs/assumptions and include uncertainty.

#### Sales
Authorized:
- assess target customer and accessibility;
- evaluate monetization path and likely sales friction;
- propose a future reversible validation approach.

Not authorized:
- contacting customers/prospects;
- sending offers/messages;
- making commitments or representing TigerIQ externally.

Acceptance:
- customer profile, access hypothesis and monetization path are explicit and evidence-aware.

#### Chief of Staff
Authorized:
- reconcile contradictions;
- request bounded correction within existing authority;
- ensure completeness/provenance;
- rank TOP 3 using the fixed rubric;
- summarize Outcome and real Exceptions for Sếp.

Not authorized:
- alter source evidence to force a ranking;
- broaden any Department authority;
- satisfy independent review/judge requirements for its own work;
- approve paid/customer/Production/legal actions.

Acceptance:
- TOP 3 uses fixed dimensions: customer problem, TigerIQ fit/asset leverage, evidence strength, monetization path, estimated test effort/cost, risk, time-to-test;
- each TOP 3 has a reversible next experiment proposal;
- no unsupported material fact;
- only genuine exceptions become `CẦN SẾP`.

### Pilot outcome

PASS proposal-level Mission when:
- coverage target is met or evidence justifies why fewer valid opportunities exist;
- TOP 3 is evidence-traceable and deduplicated;
- all material factual claims have source refs;
- evidence carries freshness/confidence where material;
- rough economics distinguish facts/assumptions/estimates;
- no paid service/customer contact/external commitment occurs;
- each TOP 3 includes one reversible next experiment proposal;
- Outcome is recorded as a business decision artifact, not merely `job done`.

If a recommended next experiment would require money, customer contact, Production or another Owner-reserved action, the Mission output is a **proposal only** and creates `CẦN SẾP` for authorization before execution.

## 12. Integration boundaries

### #111 AI Coordinator / Prompt Architect
KEEP. Receives authorized work and business input; performs model/Prompt support. Does not own Goal/Mission/authority/Outcome and does not become company brain.

### #146 business state
May persist/relate Goal/KPI/Signal/Mission/Exception/Outcome and Mission↔Job refs. This policy does not define PostgreSQL migration/runtime implementation.

### #147 Company Control Tower
May display Goal/KPI/Mission/Outcome and `CẦN SẾP` using authoritative refs or clearly marked non-authoritative mock/view-model data. It must not infer authority from UI state.

### #148 COMPANY-001
Consumes this Mission template and decision policy for pilot orchestration after its own dependencies/gates permit execution.

## 13. Review readiness conditions

This policy is ready for Central/CHAT05 review only when:
1. policy artifact and business-input schema/template are committed on the Issue #152 branch;
2. deterministic policy regression checks pass;
3. exact-head CI/applicable repository gates pass;
4. Issue #152 records the exact head and evidence;
5. no runtime/provider/Android/Web/MAIN/Production change is included.

The final readiness marker is emitted only after those conditions are evidenced.