# Visual Quality Gate

## Identity
- ID: visual-quality-gate
- Version: 1.0.2
- State: ACTIVE
- Target: ui-verification
- Provenance: registry.yaml; #976

## Trigger
After UI changes, webui workflow, or an Unslop audit of rendered UI.

## Input
Rendered UI at accepted viewports; approved reference/DESIGN.md; interaction, responsive, and accessibility acceptance.

## Steps
1. Inspect **rendered** screenshots and DOM, not source alone.
2. Check geometry, clipping/overflow, typography, spacing, component hierarchy, responsive behavior, interaction and accessibility basics.
3. Reuse existing Playwright and visual regression plus `detectors.json`: distinguish deterministic findings from subjective style judgments.
4. Apply Unslop audit in `references/unslop-ui-audit.md`: inspect generic AI-style patterns, context and false-positive guards; advisory aesthetics never hard-fail alone.
5. Respect Owner Interaction V6 and scoped design contracts; preserve approved branding. Astryx React 19+ requires its own gated pilot evidence.
6. Report element, viewport, expected/observed delta, severity, screenshot/DOM receipt, fix and retest.

## Acceptance
- PASS: scoped rendered, behavioral and applicable hard checks verified.
- PASS_WITH_ADVISORIES: only nonblocking style suggestions remain.
- FAIL: verified blocker or approved-contract violation with evidence.
- NOT_VERIFIED: missing rendered UI, viewport, interactions or other required evidence.
- Never auto-update golden baselines on failure; a stable pixel hash is not proof of quality.
- A hard detector blocks only after applying its false-positive guards.

## Tools / Output
Use existing browser/visual-regression tools and `detectors.json`.

## Evidence
Viewport screenshot/DOM receipts, deltas; #976.

## Fallback
Missing evidence => NOT_VERIFIED.

## Safety
Isolate browser testing from NV02/NV03/NV04 live sessions unless separately authorized. Never widen credentials, browser permissions, or Production release.

## Non-goals
No separate Unslop Skill, auto-approved baseline, parallel browser authority or package installation.
