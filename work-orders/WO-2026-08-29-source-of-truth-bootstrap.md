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
5. Reconcile CURRENT_STATE with the separately verified runtime branch stack.
6. Record evidence and keep the change behind PR/review/release gating.

## Acceptance criteria
- Constitution, Workflow, AI Employee Model, Decision Log, and Source Index exist in repo branch.
- Owner Profile is not committed.
- Architecture baseline reflects approved operating model without overstating MAIN/Production state.
- CURRENT_STATE records both MAIN reality and the verified off-MAIN runtime stack.
- MAIN/Production remains unchanged until release gate.
- PR exists with evidence of files added and current-state reconciliation.

## Evidence
- Initial MAIN audit: `.gitignore`, `LICENSE`, `README.md` only before bootstrap.
- Working branch: `chore/source-of-truth-bootstrap`.
- PR #11 is open against `main`.
- Runtime audit found open stacked PRs #1–#10 through `phase8/actor-rate-limits`.
- Latest audited runtime head: `e29b9a32b49226075147f2168a7f0438665258b2`.
- GitHub Actions CI on the latest Phase 8 head is PASS.
- Runtime CURRENT_STATE records 30 tests + Playwright smoke + build PASS for Phase 8.
- Restricted `04_TIGERIQ_OWNER_PROFILE_v1.md` is not among PR #11 changed files.
- `docs/CURRENT_STATE.md` was reconciled on this branch to distinguish MAIN, Source bootstrap, runtime branches, and Production state.

## Gate
Pending independent review / PR review before merge to MAIN.
No Production action is authorized by this Work Order.
