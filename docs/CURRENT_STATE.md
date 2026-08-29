# TigerIQ AI Lab — CURRENT STATE

Last audited: 2026-08-29

## MAIN reality
Default branch: `main`.

At the latest audit, `main` still contains only the initial repository baseline and does not yet contain the Company Source of Truth or runtime stack.

## Company Source of Truth bootstrap
Branch: `chore/source-of-truth-bootstrap`.
PR: #11 — `docs: bootstrap TigerIQ Source of Truth and Company OS governance`.

This branch adds:
- Company Constitution v1
- Workflow v1
- AI Employee & Department Model v1
- Decision Log / Baseline v1
- Source Index v1
- Architecture baseline
- Privacy boundary
- Current State
- Source-of-Truth bootstrap Work Order

Privacy rule verified: `04_TIGERIQ_OWNER_PROFILE_v1.md` is intentionally excluded from the general repository because it is restricted/private.

## Runtime engineering reality
A separate stacked runtime implementation exists off MAIN.

Audited off-MAIN runtime branches:
- Primary stacked path starts at Phase 0 foundation: `phase-0-foundation` / draft PR #1
- Separate alternative/duplicate Phase 0 branch: `phase0/foundation` / draft PR #2 (not part of the primary stack)
- Phase 1 control plane: `phase1/control-plane` / draft PR #3
- Phase 2 durable journal: `phase2/durable-journal` / draft PR #4
- Phase 3 HTTP API: `phase3/http-api` / draft PR #5
- Phase 4 durable API: `phase4/durable-api` / draft PR #6
- Phase 5 operational safety: `phase5/operational-safety` / draft PR #7
- Phase 6 runtime guardrails: `phase6/runtime-guardrails` / draft PR #8
- Phase 7 metrics/overload protection: `phase7/metrics-overload` / draft PR #9
- Phase 8 actor rate limits: `phase8/actor-rate-limits` / draft PR #10

Newly audited off-MAIN draft work created after the Phase 8 checkpoint:
- Phase 9 provider-neutral model routing: `phase9/model-router-execution` / draft PR #13; CI PASS at `8bb6c5b7a99938a6b2e3cb16e7e05129ee2fd20c`.
- Control Center MVP: `wo003/control-center-mvp` / draft PR #14; stacked on Phase 9; CI PASS at `4ba2270ff9d4f6cd33836696f5fca9c7e6f68e0b`.
- Driver read-only onboarding: `wo004/driver-integration` / draft PR #15; stacked on PR #14; CI PASS at `e9fb98483fb7ac995d34681cfb03dcc64ec5a9c0`.
- Revenue opportunity research: `wo005/revenue-opportunity-research` / draft PR #16; stacked on PR #15; CI PASS at `96513d51a3c72017d50429b41647ae3f025e378e`.
- Driver Fleet customer discovery: `wo006/driver-fleet-customer-discovery` / draft PR #17; stacked on PR #16; CI PASS at `f1838fe623a47d8e0c8b5f8c1b0b3df94381d2b7`.
- PC local AI execution worker: `wo007/pc-local-ai-worker` / draft PR #18; separate child of Phase 9; CI PASS at `8e0b58f88afb03230d0283547217dc22b5249b23`.

These entries record branch/PR/check reality only. Their product claims and release eligibility have not been independently reviewed by PR #11's gate.

Latest runtime head audited: `e29b9a32b49226075147f2168a7f0438665258b2` on `phase8/actor-rate-limits`.

Runtime evidence recorded in the stacked branch reports:
- executable Work Order lifecycle/control plane;
- role separation and evidence-gated decisions;
- tamper-evident durable journal and restart recovery;
- authenticated/idempotent loopback HTTP API;
- durable API state and idempotency;
- health/readiness, correlation IDs, graceful draining and bounded timeouts;
- redacted structured observability;
- overload protection and low-cardinality operator metrics;
- actor-scoped fixed-window rate limits;
- latest Phase 8 CI: GitHub Actions PASS;
- latest Phase 8 test baseline: typecheck, 30 tests, Playwright smoke and build PASS according to recorded evidence.

These runtime components are implemented and verified on stacked branches only. They are not yet merged to MAIN and are not Production.

## Open integration/release gates
- PR #11 Source-of-Truth bootstrap: open and mergeable. Independent review Issue #12 initially returned FAIL, then PASS on corrected head `f34b8c672112eb38b5d7b0bb04c3af06609759d3`; no blocking privacy, consistency, topology, provenance, MAIN, or Production finding remains. Judge/release gate remains pending.
- Primary runtime path PR #1 and PR #3–#10: open, draft, and stacked in dependency order.
- PR #2: open draft alternative/duplicate Phase 0 foundation; it is not a dependency of PR #3–#10.
- PR #13–#18: open, draft, off-MAIN work with successful CI checks; independent review/release gates remain open.
- No Production deployment has been found or authorized.
- MAIN has not been modified by this audit/update.

## Current priority
1. Keep repository governance aligned with the approved Company Source of Truth.
2. Reconcile Source bootstrap with the verified runtime stack without exposing restricted Owner context.
3. Review runtime PRs in dependency order and preserve independent Builder/Reviewer/Judge gates.
4. Merge to MAIN only after applicable review/release gates pass.
5. Do not deploy Production without explicit Owner authorization.

## Completion rule
Do not claim repository integration or Production readiness until the applicable review, CI, merge and release evidence exists.
