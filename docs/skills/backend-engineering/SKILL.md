# Backend Engineering

## Identity
- ID: backend-engineering
- Version: 0.1.0
- State: CANDIDATE — not runtime loadable until canary, validation and registry promotion
- Target: coding-lane / backend
- Provenance: Owner P0 Core/Coding Lane directive 2026-10-16

## Trigger
Implement a scoped backend API, worker, service, data-contract or database correctness change.

## Input
Canonical Work Order, exact source SHA and allowed files, contract, observed failure, security boundaries, lease/transaction invariants and test commands.

## Steps
1. Read real endpoint/data schemas and dependencies, identify writer scope and current behavior.
2. Reproduce defect where applicable; rank falsifiable hypotheses, avoid claiming root cause without evidence.
3. Compile per-step prompt with exact files, source and behavior invariants, acceptance and failure conditions.
4. Implement minimal compatible code preserving idempotency, concurrency, timeout and existing authorization.
5. Run focused unit/integration/negative tests (including stale writer/restart when relevant) and return source SHA, commands, receipts, limitations and next step.

## Tools / Output
Existing approved repository and isolated test tools; code diff, contract test output and traceable evidence.

## Acceptance
Source-level and actual contract tests meet the scoped specification. Mock tests do not imply real PostgreSQL or live PC01 runtime success. No feature DONE on fast model reply or green generic CI alone.

## Evidence
Pinned diff, negative and functional tests, external dependency receipts where authorized, real scoped canary before ACTIVE promotion.

## Fallback
If runtime/credential/lease is missing, park only affected step with explicit wake trigger and continue safe independent steps.

## Safety
No secrets, payment, security boundary, Production, App Chrome, device write or direct main mutation without separate authorization.

## Non-goals
Not a license for Core scheduler rewrite, automatic release or permission broadening.
