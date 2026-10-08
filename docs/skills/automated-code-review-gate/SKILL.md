# Automated Code Review Gate

## Identity
- ID: automated-code-review-gate
- Version: 1.1.0
- State: ACTIVE
- Target: engineering-review
- Provenance: registry.yaml; #1874/#2194; #4578 (2026-10-08 upstream delta)

## Trigger
Pre-merge source review where an independent assessment materially reduces correctness, scope, security or regression risk.

## Input
- Work Order/SPEC and criterion list; exact PR head/diff.
- Repository standards/ADR, checks, author and allowed mutation scope.
- Evidence suitable for the actual claim and target surface.

## Steps
1. Pin exact head, originating SPEC and repository conventions; reject an empty/stale target.
2. Ensure independent reviewer when required; never approve one's own implementation.
3. Assess separate axes: **SPEC** (acceptance met by actual changes) and **STANDARDS** (repository correctness, safety and conventions). Distinguish blocking defects from optional style advice.
4. Map each material completion claim to evidence on the same revision. For UI: screenshots show appearance, not interaction/persistence; require relevant assertions, traces or durable outcome receipts. For non-UI: do not demand screenshots.
5. Validate allowlisted scope, checks, evidence freshness and untested cases. Return PASS, CHANGES_REQUIRED or BLOCKED with exact axis, criterion and proof.
6. Re-review on head change; source-level checks never imply successful live release.

## Tools / Output
Existing GitHub diff/check/review only; durable target head, SPEC/STANDARDS findings, claim↔evidence mapping, uncovered scope and bounded decision.

## Acceptance
- PASS requires current evidence for each applicable acceptance criterion and required checks.
- Reviewer != implementer when independence is required.
- No stale-head review; no screenshot-only assertion of functional behavior.
- Zero reproduced issues is valid for **tested** scope; untested scope is declared.
- Advisory improvement cannot block absent a real requirement; no Owner gate override.

## Evidence
- #1874 and #2194; TigerIQ exact-head review pipeline.
- Two-axis source: `mattpocock/skills/skills/engineering/code-review/SKILL.md` @ `b0618bc436ad893b3c5e84e55fba86586d34a404` (MIT).
- Evidence separation: `msitarzewski/agency-agents/testing/testing-evidence-collector.md` and `testing/testing-reality-checker.md` @ `f99f6aa910a442b0197b768ce0ea7751e35e2060` (MIT). External agent profiles not installed; see learning log 2026-10-08.

## Fallback
Missing exact head, test proof or eligible independent reviewer => BLOCKED on the precise step, not fictitious PASS; other safe work may continue.

## Safety
No self-review, direct main mutation, automatic release, Codex, RDC, credentials, security change, paid/destructive action or App Chrome mutation.

## Non-goals
No second reviewer system, Agency worker identity, universal screenshot gate or automatic FAIL regardless of evidence.
