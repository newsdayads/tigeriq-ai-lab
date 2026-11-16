# Unslop UI audit — visual-quality-gate reference

Status: integrated review **method**, not a separate installed external skill or verified external Unslop package. Existing `detectors.json` was already adapted from `pbakaus/impeccable` (Apache-2.0); this reference adds a bounded, original Unslop-style review workflow. No upstream Unslop implementation or assets copied.

## Run on every relevant website/UI acceptance
1. Establish product scope, approved DESIGN.md, reference screenshots, Owner Interaction V6 and Astryx adoption policy. Never replace the approved brand with a generic aesthetic.
2. Capture **rendered** desktop and mobile viewports; inspect actual DOM/computed style and interactions. If the browser/screenshot is unavailable, output `NOT_VERIFIED` and a missing-evidence list, not PASS.
3. Run the existing `detectors.json` rules: decorative gradient-filled text (hard only with its exact trigger), excessive glow (advisory), and side-tab decoration (advisory with geometry/context guards). Record actual selector, screenshot, viewport, and trigger/guard.
4. Review additional **advisory** AI-slop signals: repetitive identical cards without hierarchy; unmotivated gradients, glassmorphism or glowing orbs; gratuitous badges/emoji/icon clutter; generic stock-like hero with vague marketing copy; excessive whitespace or oversized headings that obscure the primary action; arbitrary radii/shadows/colors; inconsistent spacing and typography. These are **not** deterministic detectors and must never fail solely because a style resembles an AI-generated design.
5. Check objective defects separately: text clipping/overflow, overlap, touch-target reachability, contrast/focus/keyboard behavior, loading/empty/error states, real CTA behavior, responsive breakpoints and layout shift. Use existing Playwright/accessibility checks when available.
6. For each finding record: `id`, `viewport`, `element`, `expected`, `observed`, `evidence`, `severity` (blocker/major/minor/advisory), `falsePositiveGuard`, `recommendedFix`, and `retest`. Group duplicates. Fix actual defects first; re-run the same viewport after correction.
7. Verdict: `FAIL` only for verified blocking defects or explicit approved-contract violations; `PASS` only after scoped visual/interaction evidence and applicable hard checks; `PASS_WITH_ADVISORIES` for nonblocking style suggestions; `NOT_VERIFIED` if required evidence is missing.

## Constraints
- Preserve approved product-specific visual identity; accessibility and functional correctness take priority over aesthetic opinions.
- Existing `visual-quality-gate` owns this review; **do not create a fourth Skill**, separate controller, automatic baseline overwrite, or production deploy.
- Keep detector false-positive guards and hard/advisory distinction intact.
- Do not infer that a page is good from source-only tests or a stable screenshot hash.
- If Astryx React package is proposed, follow its separate React 19+ pilot and approval gates; Unslop never authorizes installation.
