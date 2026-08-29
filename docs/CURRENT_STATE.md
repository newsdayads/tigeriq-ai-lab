# TigerIQ AI Lab — CURRENT STATE

Last audited: 2026-08-29

## State taxonomy — authoritative interpretation
Every item in this document belongs to exactly one state:

- **MAIN / MERGED**: code or documentation actually present on the default `main` branch.
- **VERIFIED OFF-MAIN**: implementation/documentation exists on an unmerged branch or draft PR and has the listed evidence. It is **not merged, not released, and not Production**.
- **EXTERNAL / SECURITY WAIT**: internal engineering may be complete, but truthful completion requires credentials, customer evidence, signer identity, device evidence, financial authorization, or another external/security-sensitive input.

A CI/reviewer/judge PASS on an off-MAIN branch never changes that branch into MAIN, released, or Production state.

## MAIN / MERGED
Default branch: `main`.

At this audit, `main` remains the initial repository baseline. The Company Source of Truth bootstrap and Company OS runtime stack described below are **not on MAIN**. No Production release is claimed.

## VERIFIED OFF-MAIN — Company Source bootstrap
Branch: `chore/source-of-truth-bootstrap`.
PR #11: `docs: bootstrap TigerIQ Source of Truth and Company OS governance`.

This unmerged branch contains the general/public-safe governance baseline:
- Company Constitution v1;
- Workflow v1;
- AI Employee & Department Model v1;
- Decision Log / Baseline v1;
- Source Index v1;
- Architecture baseline;
- repository privacy boundary;
- this Current State.

Privacy boundary: `04_TIGERIQ_OWNER_PROFILE_v1.md`, health/medical information, intimate family information, authentication credentials, private keys, and unnecessary personal identifiers are excluded from the general repository.

The Source bootstrap itself remains **under independent review** until a fresh review/judge evaluates one exact current branch head. No prior review attempt is authoritative for the current head.

## VERIFIED OFF-MAIN — primary runtime foundation
Primary dependency path:
1. PR #1 — Phase 0 foundation: `phase-0-foundation`
2. PR #3 — Phase 1 control plane: `phase1/control-plane`
3. PR #4 — Phase 2 durable journal: `phase2/durable-journal`
4. PR #5 — Phase 3 authenticated/idempotent HTTP API: `phase3/http-api`
5. PR #6 — Phase 4 restart-safe durable API: `phase4/durable-api`
6. PR #7 — Phase 5 operational safety/idempotency: `phase5/operational-safety`
7. PR #8 — Phase 6 runtime guardrails/redacted observability: `phase6/runtime-guardrails`
8. PR #9 — Phase 7 overload protection/operator metrics: `phase7/metrics-overload`
9. PR #10 — Phase 8 actor-scoped rate limits: `phase8/actor-rate-limits`
10. PR #13 — Phase 9 executable provider-neutral routing: `phase9/model-router-execution`

PR #2 (`phase0/foundation`) is an alternative/duplicate Phase 0 branch and is not part of the primary dependency path.

Phase 9 PR #13 is open/draft/off-MAIN at head `8bb6c5b7a99938a6b2e3cb16e7e05129ee2fd20c`; recorded CI is PASS. The complete primary stack still requires its own fresh dependency-order integration review before any merge. It is **not released and not Production**.

## VERIFIED OFF-MAIN — Work Orders
- **WO-003 Control Center MVP** — branch `wo003/control-center-mvp`, draft PR #14. Implementation/test head `ca5f25fcd3d47c9d46bdb4b24c28b2d6684fc83e`; CI #75 PASS. Evidence/state head `e3f3b0c5f5dbd667c8aca6745c2899502fcf79dc`; CI #77 PASS. Independent PC01 Issue #23: `WO003_REVIEW_PASS`, Reviewer PASS, Judge PASS, closed completed. MVP engineering scope DONE **off-MAIN only**.
- **WO-005 Revenue Opportunity Research** — branch `wo005/revenue-opportunity-research`, draft PR #16, head `96513d51a3c72017d50429b41647ae3f025e378e`, CI #49 PASS. Research scope DONE **off-MAIN only**.
- **WO-007 PC Local AI Worker** — branch `wo007/pc-local-ai-worker`, draft PR #18, audited head `59b576aa4d970e3e4d1427b7ad3dd2de9919e8cf`, CI #70 PASS. Physical PC01 Ollama execution, fallback, durable recovery, watchdog self-heal, Reviewer and Judge PASS. Engineering/physical scope DONE **off-MAIN only**.
- **WO-008 GitHub Command Ingress** — branch `wo008/command-ingress-github-queue`, draft PR #19, head `75d24b37f4fc0ef02dff3c3c69ae7e53527f749b`, CI #71 PASS. Canary Issue #20: executor `TIGERIQ_COMMAND_INGRESS_PASS`, Reviewer PASS, Judge PASS, closed completed. Scope DONE **off-MAIN only**.
- **WO-009 Multi-AI Provider Mesh** — branch `wo009/multi-ai-provider-mesh`, draft PR #21. Current-state head `09209a9b28a698cdf9cc912e1c018bd33acc8dfc`; CI #79 PASS. Independent Issue #22: `WO009_REVIEW_PASS`, Reviewer PASS, Judge PASS, closed completed. Engineering scope DONE **off-MAIN only**; live cloud activation is separately listed under EXTERNAL / SECURITY WAIT.

## VERIFIED OFF-MAIN — TigerIQ Driver hardening
Separate repository: `newsdayads/drivetrack`.

WO-004 branch `wo-004-company-os-hardening-20260829`, draft PR #136, remains off that repository's MAIN/Production.

Reconciliation head `cd3044b322c031856a576bc9e73808d6c65c487e`:
- DriveTrack Quality Gate #809 PASS;
- Tiger IQ Android Gate #96 PASS;
- independent PC01 Issue #24: `WO004_REVIEW_PASS`, Reviewer PASS, Judge PASS, closed completed.

Engineering hardening is verified off-MAIN. Android Production signing/update-in-place and dependency-security release evidence remain separate gates below.

## EXTERNAL / SECURITY WAIT
- **WO-006 customer validation**: internal preparation is complete on draft PR #17 with CI #50 PASS, but commercial validation requires real external interviews/pilot/willingness-to-pay evidence. It must not be simulated.
- **WO-009 live cloud activation**: real OpenAI/Anthropic/Gemini calls require approved credentials and provider model configuration. No live cloud PASS is claimed. PC01/Ollama remains the verified local fallback.
- **WO-004 Android Production signing**: requires one persistent production signer, secure secret provisioning, signed release certificate evidence, dependency-security triage, and update-in-place verification against the intended installed baseline. No update-safe Production signing PASS is claimed.

## Open integration/release gates
- Source bootstrap PR #11: fresh independent review/judge of one exact current head is required.
- Primary runtime PR #1 → #3–#10 → #13: fresh dependency-order integration review is required.
- Any merge to MAIN requires the applicable merge/release gate.
- Any Production deployment requires explicit Owner authorization and release evidence.

## Completion rule
Do not infer merge, release, live-cloud activation, Android update-safe signing, customer validation, or Production readiness from an off-MAIN CI/reviewer/judge PASS. Each claim requires evidence for that exact state transition.
