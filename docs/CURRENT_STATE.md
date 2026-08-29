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
- PR #11 Source-of-Truth bootstrap: open and mergeable. Independent review Issue #12 initially returned FAIL on privacy, Model Router consistency, and unsupported provenance claims; fixes are pending retest and re-review before release gate.
- Primary runtime path PR #1 and PR #3–#10: open, draft, and stacked in dependency order.
- PR #2: open draft alternative/duplicate Phase 0 foundation; it is not a dependency of PR #3–#10.
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
