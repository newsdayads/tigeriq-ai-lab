# TigerIQ Business State V2 — Minimal Contract

Status: DESIGN ONLY · OFF MAIN/PRODUCTION · NO MIGRATION IMPLEMENTATION  
Issue: #146 / WO-049  
Business model source: PR #144 exact `5589f61b9123d49681ab62a71c1f7728a3c6cd99`  
Operational-state base: PR #141 exact `6f12d3c5f3da1616041fa48fadf8a4e8b41e7ad9`

## 1. Purpose

Define the smallest upward business-state extension required by Company Operating Model V2 while preserving the existing Job/Lease/Result/Evidence/Review runtime contract.

This contract exists so CHAT 01 can map the Company Control Tower data layer without inventing a second source of truth.

## 2. Non-negotiable boundaries

1. PR #141 remains authoritative for runtime `Job`, `Lease`, `Result`, `Evidence`, `Review`, Prompt and heartbeat state.
2. Business State never copies Job stage, lease ownership, result payload or evidence bodies into Mission-owned records.
3. `Mission -> Job` is reference-only through `mission_job_refs(job_id)`.
4. External systems remain authoritative for their own domains. TigerIQ stores minimum projections/metadata needed for coordination.
5. Every external projection carries provenance: `source_system`, `source_ref`, `observed_at`, and `source_version` when available.
6. On conflict, the authoritative external source wins. A projection is cache/read-model data, not a competing record.
7. Credentials/secrets are never business-state fields.
8. Restricted/private data is excluded unless a defined Business Process requires it and effective authority permits it.
9. `decision_ref` is an immutable reference to an approval/decision record; Business State does not duplicate decision content. Prefer existing Evidence/Decision Log references.
10. Autonomy never expands Employee permission, Tool permission, risk floor or approval authority.
11. Every financial commitment remains Owner-authority regardless of amount. A stored budget ceiling constrains an already-approved authorization and never creates spending authority.
12. No migration implementation is part of Issue #146.

## 3. Common reference contracts

### ProvenanceRef

Required for externally observed facts and projections.

- `source_system`: stable system identifier, e.g. `crm`, `accounting`, `drive`, `calendar`, `github`, `web`, `tigeriq-runtime`.
- `source_ref`: immutable or resolvable source identifier/link.
- `source_version?`: source revision/etag/version when available.
- `observed_at`: when TigerIQ observed the source state.
- `confidence?`: optional `low | medium | high` for derived/research observations; never replaces source evidence.

### DecisionRef

A string reference to an immutable Owner/policy/approval decision. When a state transition requires approval, the transition record must carry `decision_ref`.

### BusinessRef

Cross-entity link: `{ entity_type, entity_id }`. It is a reference only and must not embed the target entity state.

## 4. Entities and ownership

### 4.1 Goal — reuse PR #141 Goal

No second Goal table/source is introduced conceptually.

PR #141 Goal remains the lifecycle anchor with its existing status vocabulary:
`planned | running | blocked | failed | completed | cancelled`.

Business extension is a 1:1 `GoalBusinessProfile` keyed by the existing `goal_id`:
- `goal_id`;
- `title`;
- `owner_ref`;
- `start_at?`;
- `end_at?`;
- `related_kpi_ids[]`;
- `decision_ref?`;
- `updated_at`.

The profile adds business presentation/context only. It does not create another Goal lifecycle.

### 4.2 KPI / Target

`KpiDefinition` is TigerIQ-owned business coordination metadata:
- `kpi_id`;
- `name`;
- `unit`;
- `direction`: `increase | decrease | range`;
- `baseline?`;
- `target?`;
- `warning_threshold?`;
- `critical_threshold?`;
- `status`: `active | paused | retired`;
- `goal_ids[]` and/or `process_ids[]`;
- `updated_at`.

Actual measurements are separate `KpiObservation` records:
- `observation_id`;
- `kpi_id`;
- `value`;
- `observed_at`;
- `provenance` — mandatory;
- `evidence_refs[]` — optional references to runtime Evidence.

There is no authoritative stored `current_value` in the business contract. CHAT 01 may display a read-model `current_value` derived from the newest valid observation. If the measurement originates in CRM/accounting/etc., that system remains authoritative.

### 4.3 Signal / Event

A Signal is an observed fact, not a decision.

`Signal`:
- `signal_id`;
- `signal_type`;
- `title`;
- `severity`: `info | warning | critical`;
- `status`: `observed | triaged | consumed | dismissed | closed`;
- `dedupe_key?`;
- `related_refs[]`;
- `provenance` — mandatory;
- `created_at`, `updated_at`.

Signal lifecycle:
`observed -> triaged -> consumed|dismissed -> closed`.

A Signal may trigger a Mission or Process, but creation of a Signal does not itself authorize any action.

### 4.4 Business Process

A Process is a repeatable company operating definition, not a Job queue.

`BusinessProcess`:
- `process_id`;
- `name`;
- `department_id?`;
- `trigger_summary`;
- `input_contract`;
- `completion_condition`;
- `required_permissions[]`;
- `approval_points[]`;
- `risk_floor` (`R0`..`R4`);
- `kpi_ids[]`;
- `status`: `draft | active | paused | retired`;
- `decision_ref?` for policy/activation changes that require approval;
- `updated_at`.

Process policy constrains execution; it never grants rights beyond the effective authority intersection defined by Company Operating Model V2.

### 4.5 Mission

A Mission is a temporary business coordination object.

`Mission`:
- `mission_id`;
- `title`;
- `expected_outcome`;
- `goal_id?`;
- `process_id?`;
- `trigger_signal_ids[]`;
- `supervisor_employee_id?`;
- `participating_department_ids[]`;
- `risk_context?` — summary only; action-level risk floors remain authoritative;
- `deadline?`;
- `approved_budget_ceiling?`;
- `budget_decision_ref?` — mandatory when an approved budget ceiling is recorded;
- `decision_ref?`;
- `status`: `planned | authorized | running | blocked | completed | cancelled`;
- `created_at`, `updated_at`.

Mission lifecycle:
`planned -> authorized -> running -> completed`.

Side paths:
- `planned|authorized|running -> blocked -> running|cancelled`;
- any non-terminal state may emit an Exception;
- `cancelled` and `completed` are terminal for that Mission record.

`authorized` means the Mission envelope was authorized; it does not override action-level Owner/risk approval floors.

#### MissionJobRef

Reference-only join:
- `mission_id`;
- `job_id` — PR #141 Job identifier;
- `relation`: `execution | verification | support`;
- `created_at`.

Forbidden fields: copied Job stage, attempt count, lease token/hash, result body, evidence body. CHAT 01 resolves Job runtime state from PR #141.

### 4.6 Department

`Department`:
- `department_id`;
- `name`;
- `parent_department_id?`;
- `supervisor_employee_id?`;
- `status`: `active | paused | retired`;
- `created_at`, `updated_at`.

Departments are stable capability groups; Missions may span multiple departments.

### 4.7 AI Employee business profile and autonomy

PR #141 Employee identity remains authoritative for operational identity/permissions/capabilities/state. Model/provider is not Employee identity.

`EmployeeBusinessProfile` is 1:1 with PR #141 `employee_id`:
- `employee_id`;
- `department_id?`;
- `supervisor_employee_id?`;
- `business_role?`;
- `updated_at`.

Autonomy is scope-bound in separate `AutonomyGrant` records:
- `autonomy_grant_id`;
- `employee_id`;
- `scope_type`: `department | process | mission | action_class`;
- `scope_ref`;
- `level`: `A0 | A1 | A2 | A3 | A4 | A5`;
- `status`: `active | revoked | expired`;
- `constraints[]`;
- `valid_from`;
- `valid_until?`;
- `decision_ref` — immutable authorization/grant reference;
- `created_at`.

Effective autonomy is only an execution ceiling inside existing permissions/policy. It cannot grant credentials, permissions, tool rights, lower risk floors or suppress required escalation.

### 4.8 Exception / Owner Action

`BusinessException`:
- `exception_id`;
- `severity`: `warning | high | critical`;
- `category`;
- `summary`;
- `impact`;
- `attempted_actions[]`;
- `proposed_action?`;
- `required_owner_action?`;
- `related_refs[]`;
- `due_at?`;
- `status`: `open | awaiting_owner | decided | resolved | closed`;
- `decision_ref?` — immutable once assigned;
- `created_at`, `updated_at`.

Lifecycle:
`open -> awaiting_owner -> decided -> resolved -> closed`.

Low-risk exceptions that do not need Owner may use `open -> resolved -> closed` according to policy. A record cannot enter `decided` without `decision_ref`.

### 4.9 Business Outcome

Outcome records business impact, not merely Job completion.

`BusinessOutcome`:
- `outcome_id`;
- `subject_ref` — Goal, Mission or Process;
- `summary`;
- `status`: `recorded | verified | superseded`;
- `achieved_at?`;
- `kpi_observation_ids[]`;
- `evidence_refs[]` — references to PR #141 Evidence where relevant;
- `provenance[]` — required for externally measured claims;
- `created_at`, `updated_at`.

A Mission may be operationally completed before every external KPI effect is known. In that case Outcome stays `recorded` until measurements support `verified`.

## 5. Relationship map

```text
PR141 Goal 1 ── 1 GoalBusinessProfile
     │
     ├── * KPI Definition ── * KPI Observation ── provenance -> external source
     │
     └── * Mission ── * MissionJobRef ──> PR141 Job -> Lease -> Result -> Evidence
                 │
                 ├── * Department
                 ├── * Signal
                 ├── * Exception -> decision_ref -> Decision/Evidence Log
                 └── * Business Outcome -> KPI Observation / Evidence refs

Department 1 ── * EmployeeBusinessProfile -> PR141 Employee
PR141 Employee 1 ── * AutonomyGrant(scope-bound, decision_ref)
BusinessProcess ── KPI / Department / Mission trigger relationships
```

No arrow pointing to an external system implies ownership of that external record; external links are references/projections only.

## 6. Authoritative-source matrix

| Domain | Authoritative source | TigerIQ Business State may store |
|---|---|---|
| Job/Lease/Result/Evidence/Review | PR #141 Operational State | references/read models only |
| Goal coordination | TigerIQ PR #141 Goal + Business profile | lifecycle + business metadata |
| Mission/Process/Department/Autonomy/Exception | TigerIQ Business State | authoritative coordination state |
| Owner/policy decision content | Decision Log / approved Evidence source | immutable `decision_ref` only |
| Customer/lead/opportunity | CRM when present | source ref + minimum summary/projection |
| Accounting/revenue/cost/invoice | accounting system when present | KPI observations + provenance |
| Documents | Drive | refs, metadata, summaries |
| Calendar/schedule | Calendar | refs/projections |
| Code/repository facts | GitHub | refs/SHA/evidence metadata |
| Market/web research facts | cited external source | observed projection + freshness/confidence |
| AI provider/model execution | existing AI Coordinator/runtime | provider refs/metrics where required; Employee identity remains separate |

## 7. Source conflict and provenance rules

1. External projection updates are append/replace-read-model operations; they do not mutate the external source.
2. A derived KPI/Outcome claim must be traceable to one or more `KpiObservation`/provenance refs.
3. Missing source data is represented as unknown/stale, never fabricated.
4. `source_version` change invalidates an older cache when the source semantics require it.
5. UI must distinguish local coordination state from externally observed facts.
6. `decision_ref` is write-once for the decision event it represents; a later decision creates a new decision reference/event rather than rewriting history.

## 8. Contract for CHAT 01 / Company Control Tower

CHAT 01 may build read models from these entities:
- Goal card: PR #141 Goal + GoalBusinessProfile + related KPI latest observations.
- Mission card: Mission + live PR #141 Job refs resolved at read time.
- Department/Employee card: Department + EmployeeBusinessProfile + PR #141 Employee operational state + active AutonomyGrant.
- `CẦN SẾP`: open/awaiting_owner BusinessException only, sorted by severity/due time.
- Outcome feed: verified/recorded BusinessOutcome with KPI/evidence traceability.
- Process health: BusinessProcess + KPI + Mission/Exception counts.

CHAT 01 must not infer authority from UI controls or business-state fields. Mutation actions require backend policy/authorization gates.

## 9. Migration plan from PR #141 — design only

A future separate implementation work order may create additive migration `002_business_state_v2`; Issue #146 does not implement it.

Planned sequence:
1. Preserve all existing PR #141 tables/constraints/APIs unchanged.
2. Add only new side tables/relations for GoalBusinessProfile, KPI/KPIObservation, Signal, BusinessProcess, Mission/MissionJobRef, Department, EmployeeBusinessProfile, AutonomyGrant, BusinessException and BusinessOutcome.
3. Reuse existing `goals.goal_id`, `employees.employee_id`, `jobs.job_id`, `evidence.evidence_id`; do not clone these entities.
4. Backfill only known local metadata. Do not manufacture KPI values, source refs, decisions, missions or external facts.
5. Add read-model/API layer for CHAT 01 after schema implementation, resolving Job state from PR #141 at read time.
6. Pilot with COMPANY-001: Goal -> Signal -> Mission -> Job refs -> Result/Evidence -> Outcome, with no paid commitment/customer contact.
7. Validate restart/idempotency behavior for any new mutable business records before Production consideration.
8. Rollback strategy is additive isolation: old PR #141 runtime continues operating if Business State is disabled. No Job/Lease/Result/Evidence rollback dependency is introduced.

## 10. Design acceptance for Issue #146

Design is ready only when:
- this contract and machine-readable schema are committed at an exact head;
- PR #144 source head is pinned to `5589f61b9123d49681ab62a71c1f7728a3c6cd99`;
- PR #141 base head is pinned to `6f12d3c5f3da1616041fa48fadf8a4e8b41e7ad9`;
- Mission->Job is reference-only;
- provenance/decision/source-authority boundaries are explicit;
- no migration implementation or runtime mutation is included;
- exact-head repository checks pass before reporting `BUSINESS_STATE_V2_DESIGN_READY`.
