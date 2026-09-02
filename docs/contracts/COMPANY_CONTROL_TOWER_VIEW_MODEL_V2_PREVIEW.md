# COMPANY CONTROL TOWER — BUSINESS STATE V2 VIEW-MODEL

Status: CHAT 01 UI ADAPTER · PR #117 · RELEASE-CANDIDATE MAPPING  
Issue: #147 / WO-049  
Operating Model basis: PR #144 exact `5589f61b9123d49681ab62a71c1f7728a3c6cd99`  
Business State V2 contract: PR #153 exact `3b8323b788f40a964d9415140aba2e7ac9e92870`  
Release boundary: no MAIN/Production, no paid service.

## Authority boundary

`company-control-tower-adapter.js` is a read-model adapter. It does not own or mutate Business State V2.

- PR #141 operational Goal/Job/Lease/Result/Evidence/Review semantics remain authoritative.
- PR #153 Business State V2 supplies business context through `goal_profiles`, `kpis`, `kpi_observations`, `signals`, `processes`, `missions`, `mission_job_refs`, `departments`, `employee_profiles`, `autonomy_grants`, `exceptions`, and `outcomes`.
- External CRM/accounting/Drive/Calendar/etc. remain authoritative for their domains. Web never creates a competing copy.
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

### Exception / CẦN SẾP
All `exceptions` are preserved in the view-model. `CẦN SẾP` is the subset with `required_owner_action` and a non-terminal lifecycle. `decision_ref` remains a reference only.

### Outcome
Outcomes preserve `subject_ref`, `kpi_observation_ids`, `evidence_refs`, and provenance. KPI effect display resolves referenced observations; it does not manufacture deltas.

## Finance / external systems

Business State V2 does not by itself create an authoritative revenue/cost ledger. Until a valid externally sourced projection exists, Company Control Tower shows `Chưa có nguồn` for revenue/cost. GitHub/Vercel build evidence is technical evidence only.

## Supported snapshot container

The adapter accepts the PR #153 contract from `businessStateV2` or `business_state_v2`. A `businessState` compatibility container is accepted only when it contains PR #153 snake_case contract keys. Legacy Web aliases such as `goals`, `ownerActions`, or `companyBusiness` are not accepted as live business truth.

## Test gates

- Vitest `.test.ts` exercises the adapter in the actual Unit test suite.
- Exact contract SHA is asserted.
- Latest KPI observation + provenance is asserted.
- Authoritative Controller cannot inherit preview mock.
- Legacy Web aliases fail closed.
- Mission→Job remains reference-only.
- Finance remains unavailable without an authoritative external source.
- Chromium Playwright uses 390×844 and verifies iPhone-first business home plus Technical Operations drill-down.
