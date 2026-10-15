# Frontend Engineering

## Identity
- ID: frontend-engineering
- Version: 0.1.0
- State: CANDIDATE — not runtime loadable until canary, validation and registry promotion
- Target: coding-lane / frontend
- Provenance: Owner P0 Core/Coding Lane directive 2026-10-16

## Trigger
Implement an approved scoped UI feature, responsive layout, accessibility correction or interactive frontend change.

## Input
Canonical Work Order, exact source SHA and files, approved design evidence, behavior invariants, UI states/breakpoints, required artifacts, test commands, forbidden actions.

## Steps
1. Read existing components, styles, tests and approved design source; list concrete changes.
2. Derive per-step prompt with target files, user behavior, acceptance and evidence.
3. Implement smallest source changes; reject README/mock-only substitutes for executable code.
4. Run type/build/lint and targeted interaction tests; verify mobile/desktop and accessibility when authorized.
5. Return exact commit SHA, modified source files, run/trace/screenshot receipts where appropriate, unresolved criteria and next step.

## Tools / Output
Existing approved repository and test tools. Output source diff, runnable UI/test evidence and explicit failures only.

## Acceptance
Specified components render and interact correctly, responsive/accessibility checks apply, required changed files exist and functional evidence matches source SHA. Generic green CI alone is insufficient.

## Evidence
Pinned files, tests and screenshots/interaction receipts from a real scoped canary before registry ACTIVE promotion.

## Fallback
If browser/visual test is unavailable, stop only visual acceptance and continue independently safe verification. Never claim PASS.

## Safety
No secret, payment, permission, Production, browser login, App Chrome, Core control-plane or direct main mutation without separate authorization.

## Non-goals
Not a replacement for backend, browser access governance or project-level acceptance.
