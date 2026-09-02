# COMPANY-001 — MISSION TEMPLATE V2

Template ID: `COMPANY-001`  
Policy: `TIGERIQ_CHIEF_OF_STAFF_POLICY_V2`  
Purpose: Low-risk proof of Goal → Signal → Mission → Department work → Evidence → Assurance → Outcome, without paid/customer/Production action.

## Mission metadata

```yaml
mission_id: COMPANY-001
title: Radar cơ hội kinh doanh TigerIQ
goal_ref: <GOAL-REF>
signal_refs: []
expected_outcome: >-
  Evidence-traceable ranked business opportunities suitable for TigerIQ resources,
  ending with TOP 3 and one reversible next-experiment proposal per TOP 3.
participating_departments:
  - Research
  - Product
  - Finance
  - Sales
  - Chief
risk_default: R1
authority_scope:
  - internal research
  - internal analysis
  - internal drafting
  - internal ranking
forbidden_actions:
  - paid service
  - purchase or subscription
  - borrowing, investment or financial commitment
  - customer/prospect contact
  - external offer or commitment
  - Production release/change
  - credential/permission/autonomy change
primary_kpi: quality/traceability + autonomous closed-loop completion
coverage_target: ">=5 sufficiently supported and deduplicated opportunities, unless evidence explains fewer valid candidates"
final_output: TOP 3 ranked by fixed rubric with reversible next experiment proposal
```

## Required Mission→Job relations

For each dispatched work package, record refs only:

```yaml
mission_ref: COMPANY-001
job_ref: <RUNTIME-JOB-REF>
action_ref: <ACTION-REF>
department: <Research|Product|Finance|Sales|Chief>
employee_ref: <EMPLOYEE-REF>
authority_gate_ref: <AUTHORIZE-GATE-REF>
risk_level: <R0-R4>
assurance_requirement: <POLICY-DEFINED>
prompt_business_input_ref: <OPTIONAL-REF>
```

Runtime Job/Lease/Result/Evidence/Review remains authoritative. This template must not embed a second authoritative Job lifecycle.

## Work package — Research

Objective: Find and substantiate candidate customer problems/opportunities.

Allowed:
- gather market/problem evidence;
- identify candidate opportunities;
- attach material source refs, observed freshness and confidence;
- distinguish fact/assumption;
- deduplicate materially equivalent opportunities.

Forbidden:
- paid research/data source;
- customer contact;
- invented market facts.

Acceptance:
- material factual claims are traceable;
- customer problem and market plausibility are evidence-supported;
- contradictions/unknowns are visible.

## Work package — Product

Objective: Assess TigerIQ fit and define a reversible possible offer/experiment.

Allowed:
- map opportunity to existing capabilities/assets;
- define candidate product/service;
- identify dependencies;
- estimate reversible experiment scope and time-to-test.

Forbidden:
- Production implementation/release;
- new paid infrastructure or purchase.

Acceptance:
- TigerIQ fit is explicit;
- proposed experiment is bounded and reversible;
- major dependencies/risks are listed.

## Work package — Finance

Objective: Produce rough economics without making a financial commitment.

Allowed:
- estimate test cost, ROI/payback direction and uncertainty;
- use sourced figures plus explicit assumptions;
- separate known values, estimates and unknowns.

Forbidden:
- payment/purchase/subscription;
- borrowing/investment/financial commitment;
- representing estimates as accounting facts.

Acceptance:
- economics are traceable to inputs/assumptions;
- uncertainty and financial risk are explicit.

## Work package — Sales

Objective: Assess target customer, accessibility and monetization path.

Allowed:
- define target customer;
- analyze accessibility and sales friction;
- assess monetization path;
- propose future reversible validation.

Forbidden:
- customer/prospect outreach;
- sending offers/messages;
- external representation or commitment.

Acceptance:
- customer/access hypothesis is explicit;
- monetization path and sales friction are evidence-aware.

## Work package — Chief

Objective: Reconcile outputs, enforce policy and synthesize a decision-quality TOP 3.

Allowed:
- identify contradictions/gaps;
- request bounded correction inside the same authority envelope;
- verify provenance/completeness;
- rank with fixed rubric;
- produce Outcome and real `CẦN SẾP` exceptions.

Forbidden:
- broaden Department/Employee authority;
- alter evidence to force ranking;
- self-satisfy required independent Reviewer/Judge gates;
- authorize paid/customer/Production/legal actions.

Acceptance:
- fixed ranking dimensions: customer problem; TigerIQ fit/asset leverage; evidence strength; monetization path; estimated test effort/cost; risk; time-to-test;
- TOP 3 are evidence-traceable and deduplicated;
- each TOP 3 has one reversible next experiment proposal;
- material facts remain sourced and assumptions marked.

## Outcome contract

Mission proposal-level PASS requires:
- evidence-traceable opportunity set;
- fixed-rubric TOP 3;
- provenance/freshness/confidence on material evidence;
- rough economics distinguish facts/assumptions/estimates;
- no paid service/customer contact/external commitment/Production change;
- each TOP 3 has a reversible next experiment proposal;
- business Outcome recorded, not only `job done`.

Any next experiment requiring money, customer contact, Production, material legal commitment or another Owner-reserved action remains a proposal and produces `CẦN SẾP` before execution.
