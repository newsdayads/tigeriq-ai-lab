# Work Order — Source of Truth Bootstrap

ID: WO-2026-08-29-SOT-BOOTSTRAP
Status: IN REVIEW
Priority: P0
Owner: Nguyễn Trường Sơn

## Objective
Establish a repository-backed Company and Engineering Source of Truth without exposing restricted/private Owner context and without modifying MAIN/Production before release gate.

## Scope
1. Audit repository reality.
2. Add approved Company Source documents.
3. Exclude restricted/private Owner Profile from general repository.
4. Add architecture and current-state engineering records.
5. Record evidence and open a PR for review/release gating.

## Acceptance criteria
- Constitution, Workflow, AI Employee Model, Decision Log, and Source Index exist in repo branch.
- Owner Profile is not committed.
- Architecture baseline reflects approved operating model without claiming unverified implementation.
- CURRENT_STATE records real audited repository state.
- MAIN/Production remains unchanged until release gate.
- PR exists with evidence of files added.

## Evidence
- Audit: main contained only `.gitignore`, `LICENSE`, `README.md` before bootstrap.
- Working branch: `chore/source-of-truth-bootstrap`.
- Individual file commits recorded in branch history.

## Gate
Pending independent review / PR review before merge to MAIN.
