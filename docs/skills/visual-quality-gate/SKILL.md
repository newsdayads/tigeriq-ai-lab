# Visual Quality Gate

Status: ACTIVE
Issue: #976 - AI Design Intelligence skills
Target: ui-verification

## Apply when
Use after UI implementation or when auditing whether a rendered interface matches an approved design and remains usable.

## Rules
- Verify the rendered result, not only source code.
- Combine applicable evidence: screenshot comparison, geometry/layout checks, clipping/overflow, typography hierarchy, spacing consistency, interaction states, keyboard/accessibility basics, and responsive states when in scope.
- Reuse existing Playwright and product-specific visual regression mechanisms instead of creating a parallel browser authority.
- Golden/reference outputs are version-controlled evidence and must never be auto-updated merely because a test failed.
- A stable pixel hash proves consistency, not design quality. Compare against approved reference/acceptance and inspect semantic usability as well.
- On mismatch, record concrete deltas and return to implementation; do not label PASS from subjective similarity alone.
- Keep browser testing isolated from live NV02/NV03/NV04 control sessions unless a separately authorized integration explicitly allows it.

## Non-goals
This skill does not self-approve its own implementation, widen browser permissions, release Production, or change credential/security boundaries.
