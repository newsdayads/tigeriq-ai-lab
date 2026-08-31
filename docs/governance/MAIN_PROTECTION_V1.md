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
