# TigerIQ MAIN Protection V1

Canonical governance gate: Issue #113.

This policy is the minimum repository-level enforcement required before TigerIQ may treat MAIN as release-governed. Repository code cannot enable these GitHub Settings by itself; the Owner must apply them once, then an independent reviewer verifies the resulting API state.

## Target branch
- Branch name pattern: `main`

## Required live settings
1. Enable **Require a pull request before merging**.
2. Enable **Require pull request reviews before merging** with at least 1 approving review from an authorized GitHub identity other than the PR author.
3. Enable **Dismiss stale pull request approvals when new commits are pushed**. If available, also enable **Require approval of the most recent reviewable push** so the latest pushed content cannot inherit an older approval.
4. Enable **Require status checks to pass before merging** and require at minimum:
   - `CI / verify`
   - `WO-014 Queue Hygiene / verify`
5. Enable **Require branches to be up to date before merging** unless an approved merge queue provides equivalent exact-resulting-SHA protection.
6. Enable **Require conversation resolution before merging**.
7. Enable **Do not allow bypassing the above settings** so repository administrators/Owner cannot silently bypass normal gates.
8. Keep **Allow force pushes** disabled.
9. Keep **Allow deletions** disabled.
10. Keep GitHub Actions workflow/token permissions least-privilege; no PR-controlled workflow may receive secrets or privileged write authority merely to satisfy review governance.

GitHub documents that PR authors cannot approve their own pull requests and that stale approvals can be dismissed after new commits. TigerIQ relies on those native controls as a mandatory layer; logical AI role labels alone are not sufficient identity proof.

## Machine-verifiable independent review contract
The hardened `.github/workflows/governance-independent-review.yml` uses `pull_request_target` so its workflow definition comes from the trusted base context. It must never checkout or execute PR-head code.

The verifier accepts a review only when all of these are simultaneously true:
- GitHub review state is formal `APPROVED`;
- `review.commit_id` equals the current exact PR head SHA;
- reviewer GitHub login exists and differs from PR author login;
- review body contains:

```text
TIGERIQ_INDEPENDENT_REVIEW_PASS
REVIEW_ROLE: 07
Exact head: <40-char PR head SHA>
EVIDENCE_REF: <typed evidence ref>
```

Issue comments, `COMMENTED` reviews, self-authored reviews, stale-SHA approvals and missing evidence are rejected. Accepted evidence refs remain constrained by `scripts/verify-independent-review-gate.mjs`.

Any new commit invalidates exact-head review evidence and must require a fresh formal approval.

## Trusted-base activation rule
`pull_request_target` is safe here only because the workflow remains base-controlled and does not execute PR code. The hardened gate is NOT considered active merely because it exists on PR #118. It becomes an enforceable repository control only after:
1. the hardened workflow/verifier is explicitly authorized and integrated onto trusted MAIN;
2. a separate reviewer identity/App can submit formal exact-head APPROVED reviews;
3. a harmless canary PR proves the gate reads the trusted base workflow and rejects self/comment/stale-review bypasses;
4. live MAIN Settings enforce the native review/status/PR-only/no-bypass/no-force-push-delete controls above.

The prior bootstrap method that re-ran a PR-head governance workflow after same-account structured comments/reviews is RETIRED and INVALID for release evidence.

## About the custom gate status
A required status check must succeed on the latest required commit SHA. Because `pull_request_target` executes in base context, do not assume its ordinary Actions check-run context is automatically a valid latest-head required status. During activation, prove this behavior with a canary. If it does not bind to the PR head as required, publish the machine-verifier result to the exact PR head through a trusted reviewer GitHub App/status publisher before adding that custom context to required checks.

Until that exact-head trusted status publication path is proven, native required approving review + stale-review invalidation + CI + Queue Hygiene remain mandatory, while the structured TigerIQ verifier is an additional fail-closed audit gate rather than a falsely claimed required head status.

## Post-configuration acceptance
An independent reviewer must verify through GitHub API evidence that:
- `main` reports `protected:true` or an active ruleset applies equivalent enforcement;
- PR-only mutation is enforced;
- at least one authorized distinct approving review is required;
- stale/latest-push review controls are active as configured;
- required CI/Queue checks are present and enforced on the latest required SHA;
- any TigerIQ custom review status is only required after its trusted exact-head publisher is proven;
- full CI runs on `main`/merge-group exact resulting SHA;
- no unsafe bypass, force-push or deletion is enabled;
- final `docs/CURRENT_STATE.md` is refreshed;
- `GOVERNANCE_INDEPENDENT_REVIEW_PASS` is recorded only after all acceptance items are true.

Do not merge/release MAIN or Production merely because PR-head CI is green or because a comment claims review PASS.
