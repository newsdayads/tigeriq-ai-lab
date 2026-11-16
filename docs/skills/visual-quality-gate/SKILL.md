# Visual Quality Gate

## Identity
- ID: visual-quality-gate
- Version: 1.0.2
- State: ACTIVE
- Target: ui-verification
- Provenance: registry.yaml; #976

## Trigger
UI change, webui or Unslop audit.

## Input
Rendered mobile/desktop UI, reference/DESIGN.md, behavior and accessibility criteria.

## Steps
1. Inspect screenshots/DOM for layout, clipping, text, spacing, hierarchy, responsive behavior, keyboard/focus, contrast and interactions.
2. Use existing Playwright/visual regression and `detectors.json`; apply guards, distinguish defects from opinions.
3. Apply `references/unslop-ui-audit.md` for generic AI design cues. Advisory style alone cannot block.
4. Preserve Owner Interaction V6 and approved identity; Astryx React 19+ requires separate pilot gates.
5. Record selector, viewport, expected/actual, severity, evidence, fix and retest.

## Tools / Output
Existing browser/test tools; PASS/FAIL with evidence.

## Acceptance
- PASS: verified rendered, interaction and applicable hard checks.
- FAIL: evidenced blocker/approved-contract violation.
- PASS_WITH_ADVISORIES: only style advice; NOT_VERIFIED: missing evidence.
- Never auto-bless baselines or equate stable pixel hash with quality.

## Evidence
Screenshots/DOM and test receipts; #976.

## Fallback
Missing evidence => NOT_VERIFIED.

## Safety
No extra browser/security rights, Production release or live NV02/NV03/NV04 access.

## Non-goals
No separate Unslop Skill, package, auto-approved baseline or parallel authority.
