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
- Source Index defines company-source precedence and states engineering CURRENT_STATE/evidence remain repository-side.
- The accessible Project file set includes stale duplicate Source files in addition to current copies; source hygiene must be fail-closed to prevent conflicting behavior.
- Repository mirrors were older than the current Project Workflow/Decision Log, so the branch updates the mirror to the current runtime contract while preserving repository-specific governance/provenance sections.

## Root-cause / fix during branch verification
- Initial repository-mirror replacement unintentionally removed repository-specific governance/provenance text from Decision Log/Source Index.
- ROOT CAUSE: current Project Source content was used as a full replacement for older repository mirrors that contained extra repository-only sections.
- FIX: restore repository governance/provenance sections and align Source Index precedence with Constitution (`Constitution > approved Architecture/Security constraints > Workflow > AI Employee Model > Decision Log > other engineering implementation docs`).
- RETEST: PR diff confirms only four documentation/evidence files changed and no Auto Worker/Chrome automation file changed.

## Static verification performed before Project install
PASS:
- Workflow internal Version is 1.2.
- Command `2` exists and contains no six-part dashboard requirement.
- Command `1` block is byte-for-byte preserved from current Project Workflow v1.1.
- `bc` reporting block is preserved.
- prompt/work-handoff block is preserved.
- authoritative system-state write is mandatory for `2`.
- single-worker/resource ownership and idempotency are mandatory for `2`.
- ROOT CAUSE → FIX → RETEST is retained for ordinary failures.
- Decision Log records command `2` operating contract.
- Source Index requires one canonical active Project Source copy and precedence matches Constitution.
- PR changed-file set contains only Workflow, Decision Log, Source Index, and this evidence file.

GitHub Actions on the latest branch head were observed `in_progress` at this evidence update; no CI PASS is claimed yet.

## Required acceptance evidence still pending
1. Replace canonical Project Source copies with Workflow v1.2, Decision Log v1.2, Source Index v1.1; remove stale duplicates.
2. NEW CHAT regression #1: send only `2`; verify audit → select unfinished work → execute → verify/evidence → authoritative state write; no six-part dashboard.
3. NEW CHAT regression #2: send only `2`; verify it reads prior state and continues without task restatement or duplicate execution.
4. Regression `1`: verify command `1` still audits, reports dashboard, and continues work.

No PASS/DONE claim is permitted before the Project-side NEW CHAT regressions above pass.
