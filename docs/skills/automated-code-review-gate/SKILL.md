# Automated Code Review Gate

## Identity
- ID: automated-code-review-gate
- Version: 1.0.0
- State: ACTIVE
- Target: engineering-review
- Provenance: registry.yaml; review evidence #1874/#2194

## Trigger
Use before merging repository/source changes when independent review materially reduces correctness, scope, security, or regression risk.

## Input
- Canonical Work Order and acceptance.
- Exact PR head SHA and diff.
- Required checks/gates.
- Implementer identity and prohibited mutation boundaries.

## Steps
1. Pin review to the exact PR head.
2. Ensure reviewer independence when required.
3. Check allowlisted scope, acceptance, tests/checks, and prohibited mutations.
4. Return PASS or CHANGES_REQUIRED with exact evidence.
5. Re-review after any head change.

## Tools / Output
Use existing GitHub PR/diff/check/review surfaces. Output a durable review record containing TARGET_HEAD, decision, check evidence, and precise blockers/required changes.

## Acceptance
- Stale-head review never satisfies the gate.
- Required independent reviewer is distinct from implementer.
- Scope and required checks are verified before PASS.
- PASS never overrides explicit Owner/hard gates.

## Evidence
- #1874 independent review of PR #1568.
- #2194 independent review of PR #2193.
- Existing TigerIQ branch -> PR -> exact-head checks -> independent-review flows.

## Fallback
If exact-head evidence or an independent reviewer is unavailable, keep the PR unapproved/parked and record the missing gate.

## Safety
The reviewer does not mutate the implementation under review, self-approve when independence is required, or bypass Production/credential/security/destructive gates.

## Non-goals
This skill does not merge by itself merely because a textual review says PASS.
