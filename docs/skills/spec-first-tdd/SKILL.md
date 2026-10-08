# SPEC-First and TDD When Appropriate

## Identity
- ID: spec-first-tdd
- Version: 1.1.0
- State: ACTIVE
- Target: coding-lane
- Provenance: registry.yaml; #905; PR #995; #4578 (2026-10-08 upstream delta)

## Trigger
Repository coding and bug fixes with definable scope, acceptance and a meaningful observable test boundary.

## Input
- Bounded problem, SPEC, acceptance, non-goals and security limits.
- Existing glossary/ADR and reproducible symptom or trustworthy failure evidence when available.

## Steps
1. Define SPEC, invariant, acceptance and target public interface before implementation.
2. For a bug, build a bounded pass/fail feedback loop for the *reported symptom*: focused test, isolated command, sanitized trace replay or actual user-flow probe. Capture invocation, revision, output and repeatability.
3. Reproduce RED when feasible; minimize the failing case. If cause is uncertain, rank falsifiable hypotheses and probe one distinguishing variable at a time.
4. Apply the smallest safe fix without unrelated refactors.
5. Confirm GREEN on the regression test **and** retest the original affected scenario when authorized. Remove temporary diagnostics; document confirmed cause or unresolved uncertainty; complete exact-head checks and independent review as required.

## Tools / Output
Existing repository and test toolchain only; bounded source/test diff with actual RED/GREEN evidence, reproducibility details, review result and any remaining gap.

## Acceptance
- No implementation before SPEC/acceptance.
- For applicable bugs, pre-fix evidence must catch the specific reported symptom, not a different failure.
- An untested hypothesis is not confirmed root cause.
- GREEN on a narrow test alone does not prove the original workflow; missing validation is explicit.
- Docs/config-only tasks may omit artificial RED with documented justification.

## Evidence
- #905; PR #995; existing TigerIQ implementation.
- Adapted diagnostic pattern (not upstream installation): `mattpocock/skills/skills/engineering/diagnosing-bugs/SKILL.md` at `b0618bc436ad893b3c5e84e55fba86586d34a404` (MIT); learning-log/2026-10-08-mattpocock-agency-agents.md.

## Fallback
If RED is not meaningful or reproducible, report attempts and exact missing evidence; use the narrowest authorized alternative. Never invent a failing test, confirmed cause or PASS.

## Safety
No direct main write, deployment, paid/credential/security/destructive change, new permission, Codex, RDC or App Chrome mutation.

## Non-goals
No fake test for non-testable work, wholesale TDD replacement, architecture redesign, or duplicate debugging skill.
