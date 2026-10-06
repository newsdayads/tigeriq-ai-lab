# Visual Quality Gate

## Identity
- ID: visual-quality-gate
- Version: 1.0.0
- State: ACTIVE
- Target: ui-verification
- Provenance: registry.yaml; #976

## Trigger
Use after UI implementation or when auditing whether a rendered interface matches approved design evidence and remains usable.

## Input
- Rendered UI state.
- Approved reference/design contract.
- Applicable viewport, interaction, accessibility, and responsive acceptance.

## Steps
1. Verify the rendered result, not source code alone.
2. Combine screenshot/reference comparison with geometry, clipping/overflow, typography, spacing, interaction, accessibility basics, and responsive checks when in scope.
3. Reuse existing Playwright/product visual-regression mechanisms.
4. Keep deterministic detector evidence separate from holistic visual judgment.
5. Record concrete deltas and return mismatches to implementation.

## Tools / Output
Use existing browser/visual regression tooling and detector definitions in `docs/skills/visual-quality-gate/detectors.json`. Output PASS/FAIL with concrete evidence and deltas.

## Acceptance
- Golden/reference outputs are never auto-updated merely because a test failed.
- A stable pixel hash is not treated as proof of design quality.
- Hard detector findings block only when severity and false-positive guards allow it.
- Advisory findings never hard-fail by themselves.

## Evidence
- #976 - AI Design Intelligence skills.
- docs/skills/visual-quality-gate/detectors.json
- Existing Playwright/product visual regression outputs.

## Fallback
If visual evidence is incomplete, return the missing evidence/state rather than a subjective PASS.

## Safety
Keep browser testing isolated from live NV02/NV03/NV04 control sessions unless separately authorized. This skill does not widen browser permissions, release Production, or change credential/security boundaries.

## Non-goals
It does not self-approve its own implementation, auto-bless baselines, or create a parallel browser/design authority.
