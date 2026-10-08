# SPEC-First and TDD When Appropriate

## Identity
- ID: spec-first-tdd
- Version: 1.1.0
- State: ACTIVE
- Target: coding-lane
- Provenance: registry.yaml; #905; PR #995; merge e98b9aa1ab26ac478f8bb026d45c0468fd876138

## Trigger
Use for repository coding or bug-fix work when scope, acceptance, and a testable invariant can be defined before implementation.

## Input
- Problem statement and bounded repository scope.
- Acceptance criteria, non-goals, and safety guardrails.
- For bug fixes, pre-fix failure evidence when technically practical.

## Steps
1. Define the SPEC, invariant, scope, acceptance, and observable public test boundary before code; reuse the repository glossary/architecture decisions when present.
2. For a reported bug, first establish a bounded feedback loop that can detect the *reported symptom* (focused failing test, isolated command, sanitized trace replay, or appropriate user-flow probe). Record the exact invocation, observed output, target revision, and repeatability. Narrow flaky cases toward a measurable reproduction rate; never assert deterministic reproduction when absent.
3. Where a meaningful RED test exists, reproduce the original symptom and minimize the failing scenario before changing production code. If the root cause is uncertain, list falsifiable ranked hypotheses and test distinguishing predictions with scoped instrumentation or comparative runs; do not treat hypotheses as conclusions.
4. Implement the smallest safe change; do not bundle speculative refactors, unrelated improvements, or broad rewrites.
5. Demonstrate GREEN on the focused regression test and repeat the original, non-minimized feedback loop. Remove temporary instrumentation, document the confirmed cause or remaining uncertainty, then obtain exact-head checks and independent review where required.

## Tools / Output
Use the existing repository/test toolchain. Output a scoped source/test delta plus durable RED/GREEN and review evidence.

## Acceptance
- Missing SPEC/acceptance blocks implementation.
- Applicable bug fixes preserve pre-fix evidence for the precise reported symptom before GREEN, including the observed failing invocation or equivalent bounded proof.
- A diagnostic hypothesis is not an RCA finding until a distinguishing probe supports it.
- GREEN must cover both the narrow regression and the original affected workflow when executable and authorized; otherwise state the exact unverified gap.
- Docs/config-only work may bypass RED when explicitly justified.
- Final result satisfies focused tests and repository gates.

## Evidence
- #905 - Activate SPEC-first + TDD regression contract.
- PR #995 - accepted implementation evidence.
- Adapted diagnostic feedback-loop discipline: mattpocock/skills `skills/engineering/diagnosing-bugs/SKILL.md` @ `b0618bc436ad893b3c5e84e55fba86586d34a404` (MIT), learning log 2026-10-08, work #4578 - [P2][SKILLS][TÍCH HỢP] Chọn lọc Matt Pocock Skills + The Agency, loại trùng và nâng chuẩn kỹ thuật. The upstream skill itself was not installed.

## Fallback
If RED is not meaningful or reproducible, record the attempts, exact missing access/evidence, and narrowest alternative verification. Never fabricate pre-fix evidence, speculate a confirmed RCA, or ask the Owner to re-authorize a safe bounded step.

## Safety
This skill does not authorize direct main writes, Production release, paid actions, credential/security changes, destructive actions, or scope expansion.

## Non-goals
It does not require artificial tests for non-testable documentation/configuration changes and does not replace repository-specific acceptance rules.
