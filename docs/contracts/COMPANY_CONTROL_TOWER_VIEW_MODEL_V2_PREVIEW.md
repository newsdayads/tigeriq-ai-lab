# COMPANY CONTROL TOWER — BUSINESS STATE V2 VIEW-MODEL

Status: CHAT 01 UI ADAPTER · PR #117 · RELEASE-CANDIDATE MAPPING  
Issue: #147 / WO-049  
Operating Model basis: PR #144 exact `5589f61b9123d49681ab62a71c1f7728a3c6cd99`  
Business State V2 contract: PR #153 exact `4bccf71d73c8d8cf100c65b935b3474f97f24459` · `BUSINESS_STATE_V2_INDEPENDENT_REVIEW_PASS`  
Chief of Staff Policy V2: PR #154 exact `0f673f92b703c8c67e8a89cb23a0c5f7307db3f2` · `CHIEF_OF_STAFF_POLICY_V2_INDEPENDENT_REVIEW_PASS`  
Release boundary: no MAIN/Production, no paid service.

## Authority boundary

`company-control-tower-adapter.js` is a read-model adapter. It does not own or mutate Business State V2 or Chief of Staff authority state.

- PR #141 operational Goal/Job/Lease/Result/Evidence/Review semantics remain authoritative.
- PR #153 Business State V2 supplies business context through `goal_profiles`, `kpis`, `kpi_observations`, `signals`, `processes`, `missions`, `mission_job_refs`, `departments`, `employee_profiles`, `autonomy_grants`, `exceptions`, and `outcomes`.
- PR #154 Chief of Staff Policy V2 is the authority/escalation baseline. Web never turns UI state, Mission budget, autonomy, historical success, or a Business State `decision_ref` into authorization.
- External CRM/accounting/Drive/Calendar/Trello/etc. remain authoritative for their domains. Web never creates a competing copy.
- Mock is accepted only when the snapshot is non-authoritative and is always surfaced as `authoritative=false`.

## Mapping rules

### Goal
`goal_profiles` is joined by `goal_id` to the operational Goal collection when present. The profile provides title/Owner/KPI/date/decision context only. Lifecycle status and runtime constraints stay on the operational Goal. If the operational Goal is absent, the view displays lifecycle as unknown rather than inventing one.

### KPI
`kpis` defines metadata/target. `currentValue` is a read-model projection from the newest `kpi_observations.observed_at` for the KPI. The adapter carries `provenance`, `evidence_refs`, and `observation_id` with that value. It never writes a shadow authoritative `current_value`.

### Signal
Signals preserve lifecycle, related refs, and required provenance. Signal state is not treated as authorization.

### Process
Process policy fields are mapped directly. The UI health badge is explicitly a read-model derived from linked KPI health plus unresolved related exceptions; it is not a new Process lifecycle field.

### Mission
Mission lifecycle comes only from `missions.status`. `mission_job_refs` becomes reference-only `{jobId, relation, createdAt}`. Job stage, attempts, lease, Result, and Evidence bodies are never copied into Mission. Runtime Job details remain under Technical Operations.

### Department / AI Employee
Business Departments come from `departments`. `employee_profiles` is joined by `employee_id` to the operational Employee for display name, heartbeat/provider/model/capabilities. `autonomy_grants` is shown as scope-bound context only and never expands permissions or approval authority.

### Exception / CẦN SẾP / Owner Action
All Business State `exceptions` are preserved in the view-model. The `CẦN SẾP` queue is fail-closed and follows the final PR #153 + PR #154 baselines:

- only `open` and `awaiting_owner` exceptions with non-empty `required_owner_action` appear as Owner actions;
- `decided`, `resolved`, and `closed` records are not shown as pending Owner actions;
- `decision_ref` remains the immutable reference defined by Business State V2 and is never interpreted as `owner_approval_ref`;
- a CẦN SẾP card is an escalation surface, not an authorization surface;
- without a separate authoritative Chief-of-Staff/policy-gate projection proving the required non-empty immutable `owner_approval_ref`, Web keeps the action `BLOCKED_PENDING_OWNER_DECISION` and does not infer `AUTHORIZE`;
- for Owner-gated actions, PR #154 remains authoritative: `risk.level=R4`, `risk.assurance.owner_required=true`, or `owner_reserved_action=true` under `AUTHORIZE` requires non-empty immutable `owner_approval_ref` before Prompt Architect/runtime.

Web does not introduce a new backend `owner_approval_ref` field into BusinessException; it only prevents BusinessException data from being mistaken for approval evidence.

### Outcome
Outcomes preserve `subject_ref`, `kpi_observation_ids`, `evidence_refs`, and provenance. KPI effect display resolves referenced observations; it does not manufacture deltas.

## Finance / external systems

Business State V2 does not by itself create an authoritative revenue/cost ledger. Until a valid externally sourced projection exists, Company Control Tower shows `Chưa có nguồn` for revenue/cost. GitHub/Vercel build evidence is technical evidence only.

## Trello work coordination boundary

Trello remains the work/deadline system and TigerIQ remains read-only for this Web scope.

The adapter accepts Trello work coordination only from an authoritative Controller snapshot with:
- schema `tigeriq.work-coordination.trello-readonly.v1`;
- `sourceSystem=trello`;
- `readOnly=true`;
- Trello provenance with source ref and observed timestamp;
- per-card Trello provenance/source ref.

Mock, missing provenance, or a non-read-only projection fails closed to no work-coordination data. Web never creates a shadow task database or writes back to Trello from this projection.

## Supported Business State snapshot container

The adapter accepts the PR #153 contract from `businessStateV2` or `business_state_v2`. A `businessState` compatibility container is accepted only when it contains PR #153 snake_case contract keys. Legacy Web aliases such as `goals`, `ownerActions`, or `companyBusiness` are not accepted as live business truth.

## Test gates

- Vitest `.test.ts` exercises the adapter in the actual Unit test suite.
- Final PR #153 and PR #154 exact SHAs are asserted.
- Latest KPI observation + provenance is asserted.
- Authoritative Controller cannot inherit preview mock.
- Legacy Web aliases fail closed.
- Mission→Job remains reference-only.
- Finance remains unavailable without an authoritative external source.
- `CẦN SẾP` admits only OPEN/AWAITING_OWNER and does not treat `decision_ref` as `owner_approval_ref`.
- Trello is read-only and provenance-gated.
- Chromium Playwright uses 390×844 and verifies iPhone-first business home plus Technical Operations drill-down.
