# API Health work-card detail — pstack feature map pilot

## Sub-features
- Open Issue row is rendered from current /api/health-live-work response.
- Clicking a card opens the work-detail modal.
- The source GitHub URL agrees with the current API value when one exists.

## How to get to it (user POV)
Open the independently running API Health sandbox root page, locate an actual open Issue in the list, and select it. Do not create a fake Issue solely to pass this test.

## Driving it with Playwright
Execute the harness in ../SKILL.md. Selectors originate from the existing tests/e2e/api-health-visual-regression.spec.ts: .work-row[data-work-number], #workDetailBackdrop, #workDetailModal and #workDetailGithub. Unlike the fixture-based visual suite, the live sandbox journey uses no page.route() mocks.

## Gotchas
- Passing the existing mock-based Playwright suite does not prove the actual device or current database.
- The dashboard can show stale/unverified data; the Doctor refuses projections older than 120 seconds.
- The Issue number must appear exactly once in the *sandbox API's* openWork. A real GitHub issue not present there is BLOCKED.
- Passing this read-only journey does not demonstrate a Core writer lease, job execution, checklist receipt, or the end-to-end Paperclip outcome.
- The sandbox itself must already be authorized and isolated; do not use the live App Chrome/NV02/NV03/NV04 session as a substitute.
