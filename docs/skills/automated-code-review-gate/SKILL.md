# Automated Code Review Gate

## Trigger
Use before merging repository/source changes when an independent review materially reduces correctness, scope, or regression risk.

## Rules
- Review the exact PR head; stale-head review evidence does not satisfy the gate.
- Reviewer must be independent from the implementer when the workflow requires independence.
- Verify allowlisted diff scope, acceptance criteria, required checks, and prohibited mutations.
- Return PASS or CHANGES_REQUIRED with exact TARGET_HEAD and concise evidence.
- A PASS does not override explicit Owner/hard gates outside the review scope.

## Output
A durable review result containing TARGET_HEAD, PASS/CHANGES_REQUIRED, relevant gate/check evidence, and any precise blocker or required change.

## Evidence
- #1874 independently reviewed PR #1568 after exact-head rebase and fresh checks.
- #2194 independently reviewed PR #2193 at exact head b437f531977b5f0fb4ca7080a24740ab1d3be96c with CI, Queue Hygiene, and Vercel Online Verify PASS.
- Existing TigerIQ engineering flows repeatedly require branch -> PR -> exact-head checks -> independent review -> merge.

## Non-goals
This skill never permits the reviewer to mutate the implementation under review, self-approve its own change when independence is required, or bypass Production/credential/security/destructive gates.
