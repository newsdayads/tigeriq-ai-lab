# Design System Memory

## Identity
- ID: design-system-memory
- Version: 1.0.0
- State: ACTIVE
- Target: design-knowledge
- Provenance: registry.yaml; #976

## Trigger
Use when a task creates, audits, or changes a user interface and must preserve an approved visual language or reference design.

## Input
- Approved screenshots/specs or existing scoped design contract.
- Product/app scope.
- Known versus unknown visual decisions.

## Steps
1. Treat approved design evidence as the source for visual decisions.
2. Extract reusable tokens and rationale: palette, typography, spacing, radius, borders, shadows, states, and layout constraints.
3. Record durable decisions in the existing DESIGN.md or equivalent scoped contract.
4. Separate observed facts from inference.
5. Preserve approved patterns unless the task explicitly changes them.

## Tools / Output
Use existing design evidence and scoped repository documentation. Output a product-scoped durable design contract or bounded updates to it.

## Acceptance
- Design decisions are traceable to approved evidence.
- Unknown values remain marked unknown instead of invented.
- One product cannot silently overwrite another product's design language.

## Evidence
- #976 - AI Design Intelligence skills.
- Approved screenshots/specs and the product's existing DESIGN.md or equivalent.

## Fallback
When evidence is ambiguous, preserve the current approved pattern and record the unresolved decision instead of guessing.

## Safety
This skill does not authorize APP Chrome/Core source mutation, Production release, paid tools, credential changes, or automatic installation of external design packages.

## Non-goals
It does not create a second design authority when a scoped contract already exists.
