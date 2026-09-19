# Owner design/UI video learning log — 2026-09-19

Owner work: #976 - AI Design Intelligence skills
Architecture parent: #822
Skill registry parent: #859

## Provenance
- Source type: ChatGPT attachment supplied by Owner.
- Filename: `v1c044g50000damij9vog65pj7mmtri0.mp4`
- Ingest date: 2026-09-19.
- Raw attachment copied to repository: NO.
- Source hash: NOT_CAPTURED.

## What the video visibly presents
The video presents a design-focused AI workflow containing the named ideas/tools `Taste Skill`, `Web Design Guidelines`, `Awesome DESIGN.md`, `Image2Code`, plus a browser/screenshot feedback loop for checking rendered UI.

## KEEP
- Give AI durable design memory instead of relying on chat-by-chat visual guesses.
- Extract reusable visual rules from approved references before implementation.
- Translate image/reference -> UI structure/code with traceability.
- Verify rendered UI through browser/screenshot evidence after implementation.
- Keep design guidance separate from implementation authority and independent review.

## IMPROVE for TigerIQ
- Reuse the existing Skill Registry and relevant-only loader.
- Reuse Playwright and existing product visual regression instead of adding a second browser framework.
- Add a scoped DESIGN.md contract per product/app when implementation work is authorized.
- Treat pixel/geometry checks as regression evidence, not as proof that a design is good.
- Use external design packages only after the existing external-skill security gate; this work installs none.

## REJECT / DEFER
- Blindly installing the named third-party tools just because they appear in the video.
- One global DESIGN.md containing unrelated products' design tokens.
- Auto-updating screenshot/golden baselines after failure.
- Letting UI test automation compete with live Chrome worker sessions.
- Rebuilding current APP Chrome while its active P0 recovery/dispatch work owns that mutation scope.

## Skills produced
- `design-system-memory`
- `image-to-ui-implementation`
- `visual-quality-gate`

These are proposed ACTIVE entries on the off-main #976 branch; they become runtime-active only after exact-head checks, independent review, and merge.
