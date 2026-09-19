# Design System Memory

Status: ACTIVE
Issue: #976 - AI Design Intelligence skills
Target: design-knowledge

## Apply when
Use when a task creates, audits, or changes a user interface and must preserve an approved visual language or reference design.

## Rules
- Treat approved design evidence as the source for visual decisions; do not invent colors, typography, spacing, geometry, or component behavior when evidence exists.
- Extract reusable tokens and rationale from approved screenshots/specs: palette, typography hierarchy, spacing rhythm, radius, borders, shadows, component states, layout constraints, and responsive behavior when visible.
- Record durable design decisions in the product's DESIGN.md or equivalent scoped design contract; do not create a second authority if one already exists.
- Separate observed facts from inferred choices. Mark unknown values as unknown and request/derive them only through approved evidence.
- Preserve existing approved patterns unless the task explicitly changes them.
- Keep design memory scoped by product/app so one interface cannot silently overwrite another product's design language.

## Non-goals
This skill does not authorize APP Chrome/Core source mutation, Production release, paid tools, credential changes, or automatic installation of external design packages.
