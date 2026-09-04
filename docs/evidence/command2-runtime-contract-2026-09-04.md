# Command 2 Runtime Contract Evidence

Date: 2026-09-04
Status: IMPLEMENTED_IN_BRANCH_AWAITING_PROJECT_SOURCE_INSTALL_AND_NEW_CHAT_REGRESSION

## Scope
- Define NEW CHAT command `2` as command `1` execution behavior without the six-part dashboard.
- Add continuous execution, authoritative state reporting, single-worker/resource lock, state continuity, idempotency, blocker/evidence gates, and P0-first execution rules.
- Preserve command `1` behavior.
- Do not modify Auto Worker/Chrome automation in this change.

## Audit findings
- Project Workflow v1.1 already defines command `1`, state/evidence rules, engineering safety, and mandatory NEW CHAT regression for Project-behavior changes.
- Decision Log v1.1 records the runtime contract and command `1`.
- Source Index places Workflow above Decision Log and states engineering CURRENT_STATE/evidence remain repository-side.
- The current Project file set includes stale duplicate Source files in addition to current copies; source hygiene must be fail-closed to prevent conflicting behavior.

## Verification performed before Project install
- Command `1` text is preserved.
- `bc` dashboard contract is preserved.
- Prompt/Work handoff contract is preserved.
- Command `2` contains no six-part dashboard requirement.
- Auto Worker/Chrome automation is unchanged.

## Required acceptance evidence still pending
1. Replace canonical Project Source copies with Workflow v1.2, Decision Log v1.2, Source Index v1.1; remove stale duplicates.
2. NEW CHAT regression #1: send only `2`; verify audit → select unfinished work → execute → verify/evidence → authoritative state write; no six-part dashboard.
3. NEW CHAT regression #2: send only `2`; verify it reads prior state and continues without task restatement or duplicate execution.
4. Regression `1`: verify command `1` still audits, reports dashboard, and continues work.

No PASS/DONE claim is permitted before the Project-side NEW CHAT regressions above pass.
