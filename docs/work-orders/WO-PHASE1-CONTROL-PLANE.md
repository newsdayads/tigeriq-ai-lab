# WO-PHASE1-CONTROL-PLANE

- Project: TigerIQ AI Lab
- Status: APPROVED
- Authorization: Project owner requested the next phase be identified and executed on 2026-08-29.
- Base: verified Phase 0 branch `phase-0-foundation` / draft PR #1
- Delivery branch: `phase1/control-plane`

## Goal

Turn Phase 0 contracts into an executable, evidence-gated lifecycle authority without adding Production infrastructure.

## Scope

- Work Order creation and authorized state transitions.
- Evidence capture with deterministic digest.
- Independent gate decision with known evidence references.
- Append-only, hash-linked audit history.
- Domain tests and CI evidence.

## Invariants

- Evidence > AI opinion.
- Coding Agent cannot declare `verified` or `DONE`.
- Implementer cannot evaluate its own work.
- Missing, unknown, or failing evidence cannot produce a passing decision.
- No direct `main` changes, Phase 0 merge, Production merge, or deployment.

## Acceptance criteria

1. Invalid lifecycle transitions and unauthorized roles are rejected.
2. Evidence is tied to its Work Order and receives a SHA-256 digest.
3. Final verification requires a distinct reviewer/judge and known passing evidence.
4. Every accepted mutation appends an audit event linked to the previous event.
5. Typecheck, unit tests, Playwright smoke, build, and GitHub Actions pass.

## Rollback

Delete the stacked Phase 1 branch/PR; Phase 0 remains unchanged.
