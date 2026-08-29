# TigerIQ AI Lab — CURRENT STATE

Last audited: 2026-08-29

## MAIN reality
Default branch: `main`.

`main` still contains only the initial repository baseline. The Company Source of Truth and runtime stack remain off MAIN; no Production release is implied by any open PR or branch.

## Company Source of Truth bootstrap
Branch: `chore/source-of-truth-bootstrap`.
PR: #11 — `docs: bootstrap TigerIQ Source of Truth and Company OS governance`.

This branch adds the public/general repository governance baseline:
- Company Constitution v1
- Workflow v1
- AI Employee & Department Model v1
- Decision Log / Baseline v1
- Source Index v1
- Architecture baseline
- Privacy boundary
- Current State
- Source-of-Truth bootstrap Work Order

Privacy boundary: `04_TIGERIQ_OWNER_PROFILE_v1.md` and restricted personal/health/family/authentication context are intentionally excluded from the general repository.

## Primary runtime engineering reality
A separate stacked runtime implementation exists off MAIN.

Primary dependency path:
- Phase 0 foundation: `phase-0-foundation` / draft PR #1
- Phase 1 control plane: `phase1/control-plane` / draft PR #3
- Phase 2 durable journal: `phase2/durable-journal` / draft PR #4
- Phase 3 HTTP API: `phase3/http-api` / draft PR #5
- Phase 4 durable API: `phase4/durable-api` / draft PR #6
- Phase 5 operational safety: `phase5/operational-safety` / draft PR #7
- Phase 6 runtime guardrails: `phase6/runtime-guardrails` / draft PR #8
- Phase 7 metrics/overload protection: `phase7/metrics-overload` / draft PR #9
- Phase 8 actor rate limits: `phase8/actor-rate-limits` / draft PR #10
- Phase 9 executable provider-neutral routing: `phase9/model-router-execution` / draft PR #13, head `8bb6c5b7a99938a6b2e3cb16e7e05129ee2fd20c`, CI PASS.

PR #2 (`phase0/foundation`) is an alternative/duplicate Phase 0 branch and is not part of the primary dependency path.

The primary runtime stack remains off MAIN and requires fresh dependency-order integration review/release gates before any merge.

## Work Orders audited after Phase 9
- WO-003 Control Center MVP — branch `wo003/control-center-mvp`, draft PR #14. Implementation/test head `ca5f25fcd3d47c9d46bdb4b24c28b2d6684fc83e`; CI #75 PASS. State/evidence reconciliation head `e3f3b0c5f5dbd667c8aca6745c2899502fcf79dc`; CI #77 PASS. Independent PC01 Issue #23: `WO003_REVIEW_PASS`, Reviewer PASS, Judge PASS, issue closed completed. MVP scope DONE; no MAIN/Production mutation.
- WO-004 original read-only Driver onboarding — branch `wo004/driver-integration`, draft PR #15, CI evidence PASS. TigerIQ Driver hardening now continues separately in repository `newsdayads/drivetrack` under its own WO-004 branch/PR/gates.
- WO-005 revenue opportunity research — branch `wo005/revenue-opportunity-research`, draft PR #16, head `96513d51a3c72017d50429b41647ae3f025e378e`, CI #49 PASS. Research scope DONE; commercial validation moved to WO-006.
- WO-006 Driver Fleet customer discovery — branch `wo006/driver-fleet-customer-discovery`, draft PR #17, head `f1838fe623a47d8e0c8b5f8c1b0b3df94381d2b7`, CI #50 PASS. Internal preparation DONE; commercial gate is EXTERNAL WAIT for real customer interviews/pilot/willingness-to-pay evidence and must not be simulated.
- WO-007 PC local AI execution worker — branch `wo007/pc-local-ai-worker`, draft PR #18, audited head `59b576aa4d970e3e4d1427b7ad3dd2de9919e8cf`, CI #70 PASS. Physical PC01 Ollama execution, cloud-outage fallback, durable recovery, Reviewer/Judge, watchdog deliberate-kill self-heal and final `[100%] TIGERIQ PC01 AUTO MODE READY` all PASS. DONE; no MAIN/Production mutation.
- WO-008 GitHub command ingress — branch `wo008/command-ingress-github-queue`, draft PR #19, head `75d24b37f4fc0ef02dff3c3c69ae7e53527f749b`, CI #71 PASS. Canary Issue #20 executed by PC01/Ollama with `TIGERIQ_COMMAND_INGRESS_PASS`, Reviewer PASS, Judge PASS and issue closed completed. DONE; no MAIN/Production mutation.
- WO-009 Multi-AI Provider Mesh — branch `wo009/multi-ai-provider-mesh`, draft PR #21. OpenAI → Anthropic/Claude → Gemini → PC01/Ollama routing, provider failure classification/circuit breaker and secret-safe evidence are implemented. Current-state head `09209a9b28a698cdf9cc912e1c018bd33acc8dfc`; CI #79 PASS. Independent PC01 Issue #22: `WO009_REVIEW_PASS`, Reviewer PASS, Judge PASS, issue closed completed. Engineering scope DONE; live cloud activation is EXTERNAL WAIT for approved real credentials/model configuration. No live cloud PASS is claimed.

## TigerIQ Driver hardening reality
Repository `newsdayads/drivetrack` is managed under Company OS WO-004.

At the latest audit:
- draft PR #136 / branch `wo-004-company-os-hardening-20260829` remains off MAIN;
- a stale version regex regression was corrected without product behavior change;
- reconciliation head `cd3044b322c031856a576bc9e73808d6c65c487e` has DriveTrack Quality Gate #809 PASS and Tiger IQ Android Gate #96 PASS;
- stable signing CI plumbing is prepared, but no production signer/update-in-place PASS is claimed;
- independent PC01 review is tracked in TigerIQ AI Lab Issue #24;
- production signing identity activation and dependency-security findings remain separate release/security gates.

## Open integration/release gates
- PR #11 Source-of-Truth bootstrap remains open/unmerged. Prior Issue #12 evidence is not relied upon because its currently visible comment is insufficient. Fresh independent re-review is tracked by Issue #25 against the reconciled current head.
- Primary runtime path PR #1 and PR #3–#10 plus PR #13 remain open/draft/off-MAIN; fresh dependency-order integration review remains open.
- PR #2 remains an alternative/duplicate Phase 0 branch and is not a dependency of the primary stack.
- WO-009 live cloud activation requires real credentials/model configuration and any applicable financial/security authorization.
- WO-006 customer validation requires real external evidence.
- TigerIQ Driver production signing activation requires a persistent signer, secure secret provisioning, signed release evidence and update-in-place verification.
- No Production deployment is authorized by this Source reconciliation.

## Current priority
1. Keep repository/Trello state aligned with evidence-backed reality.
2. Complete fresh Source-of-Truth review and primary runtime integration review.
3. Complete TigerIQ Driver independent hardening review while preserving release gates.
4. Activate real cloud providers only after approved credentials/model configuration exist.
5. Merge MAIN or deploy Production only through a separately authorized release gate.

## Completion rule
Do not claim repository integration, live cloud activation, Android update-safe signing, customer validation or Production readiness until the applicable evidence exists.
