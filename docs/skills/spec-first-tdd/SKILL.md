# SPEC-First and TDD When Appropriate

## Identity
- ID: spec-first-tdd
- Version: 1.0.0
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
1. Define the SPEC, invariant, scope, and acceptance before code.
2. Decide whether a meaningful RED test/reproduction applies.
3. For applicable bugs, capture pre-fix failure evidence.
4. Implement the smallest safe change.
5. Prove GREEN with focused tests, then exact-head checks and review.

## Tools / Output
Use the existing repository/test toolchain. Output a scoped source/test delta plus durable RED/GREEN and review evidence.

## Acceptance
- Missing SPEC/acceptance blocks implementation.
- Applicable bug fixes preserve pre-fix failure evidence before GREEN.
- Docs/config-only work may bypass RED when explicitly justified.
- Final result satisfies focused tests and repository gates.

## Evidence
- #905 - Activate SPEC-first + TDD regression contract.
- PR #995 - accepted implementation evidence.

## Fallback
If RED is not meaningful or reproducible, record why, keep acceptance explicit, and use the narrowest alternative verification. Never fabricate pre-fix evidence.

## Safety
This skill does not authorize direct main writes, Production release, paid actions, credential/security changes, destructive actions, or scope expansion.

## Non-goals
It does not require artificial tests for non-testable documentation/configuration changes and does not replace repository-specific acceptance rules.
