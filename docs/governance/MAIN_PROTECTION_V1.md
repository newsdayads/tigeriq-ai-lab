# TigerIQ MAIN Protection V1

Canonical governance gate: Issue #113.

This policy is the minimum repository-level enforcement required before TigerIQ may treat MAIN as release-governed. Repository code cannot enable these GitHub Settings by itself; the Owner must apply them once, then 07 independently verifies the resulting API state.

## Target branch
- Branch name pattern: `main`

## Required settings
1. Enable **Require a pull request before merging**.
   - Do not require a second GitHub-account approval solely for TigerIQ logical AI independence; the independent-review workflow below is the machine gate.
2. Enable **Require status checks to pass before merging**.
3. Enable **Require branches to be up to date before merging** unless merge queue is used for the repository.
4. Require these checks:
   - `CI / verify`
   - `Governance Independent Review Gate / independent-review`
   - `WO-014 Queue Hygiene / verify`
5. Enable **Require conversation resolution before merging**.
6. Enable **Do not allow bypassing the above settings** so repository administrators/Owner cannot silently bypass normal gates.
7. Keep **Allow force pushes** disabled.
8. Keep **Allow deletions** disabled.

## Machine-verifiable independent review contract
The required workflow `.github/workflows/governance-independent-review.yml` runs on PR changes and submitted/edited/dismissed PR reviews. It accepts a PASS only when the current exact PR head has structured evidence containing all of:

```text
TIGERIQ_INDEPENDENT_REVIEW_PASS
REVIEW_ROLE: 07
Exact head: <40-char PR head SHA>
EVIDENCE_REF: <typed evidence ref>
```

Accepted evidence refs are constrained by `scripts/verify-independent-review-gate.mjs`.

Any new commit invalidates the previous exact-head review because the gate re-runs against the new SHA.

## One-time bootstrap for the first governance PR
PR #118 introduces `.github/workflows/governance-independent-review.yml`, so before that workflow exists on default `main`, GitHub cannot be relied upon to create a fresh `pull_request_review`-triggered run merely because 07 submits a review. This is a bootstrap condition only; it must not become a permanent bypass.

Safe bootstrap procedure:
1. Freeze the exact PR head.
2. Require exact-head CI, Queue Hygiene and all existing repository checks to PASS.
3. 07 submits the structured independent-review PASS bound to that exact head.
4. Re-run the already-created `Governance Independent Review Gate` run for that same exact head. The verifier reads current GitHub review evidence and must complete PASS.
5. Any commit after step 3 invalidates the review; repeat from step 1 on the new exact head.
6. Do not treat the bootstrap gate as global #113 PASS. `main` protection/ruleset must still be configured and independently verified before release governance is accepted.
7. After this workflow lands on `main`, future review submissions must trigger the normal gate from default-branch workflow state; prove this with a harmless governance canary/PR before declaring the bootstrap condition retired.

Bootstrap proof already observed on PR #118 prior head `71329b3321d9b736a9bbb3c16e7c65507486cad2`: structured 07 PASS existed, and Governance Independent Review Gate run #7 / `33455971386` completed PASS on attempt 2 after re-run. This proves the bootstrap mechanism without bypassing the exact-head reviewer contract.

## Post-configuration acceptance
07 must verify through GitHub API evidence that:
- `main` reports `protected:true` or an active ruleset applies equivalent enforcement;
- PR-only mutation is enforced;
- required checks above are present and enforced;
- full CI runs on `main`/merge-group exact resulting SHA;
- no force-push/delete bypass is enabled;
- final `docs/CURRENT_STATE.md` is refreshed;
- 07 records `GOVERNANCE_INDEPENDENT_REVIEW_PASS` only after all acceptance items are true.

Do not merge/release MAIN or Production merely because PR-head CI is green.
