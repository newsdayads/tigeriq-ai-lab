# Automated Code Review Gate

## Identity
- ID: automated-code-review-gate
- Version: 1.1.0
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
1. Pin review to the exact PR head, diff, originating Work Order/SPEC, and available repository conventions/architecture decisions.
2. Ensure reviewer independence when required and keep implementation ownership distinct.
3. Evaluate two explicit axes: **SPEC** (each requested acceptance criterion versus the implementation) and **STANDARDS** (repository-specific correctness, safety, maintainability and documented conventions). Avoid failing work merely for advisory code-style heuristics unless a real requirement is violated.
4. Build a scoped claim-to-evidence matrix for material completion claims. For UI claims, screenshots establish appearance but not persistence or functional behavior: require interactions, assertions, traces or durable outcome receipts as applicable. For non-UI work, use relevant programmatic/runtime evidence rather than demanding screenshots.
5. Check allowed paths, prohibited mutations, exact-head checks, and evidence freshness; identify untested or unavailable surfaces honestly. Return PASS, CHANGES_REQUIRED or BLOCKED with precise criterion/axis/findings and references.
6. Re-review after a head change; never reuse stale approval or infer a successful production rollout from source-only verification.

## Tools / Output
Use existing GitHub PR/diff/check/review surfaces. Output a durable review record containing TARGET_HEAD, decision, check evidence, and precise blockers/required changes.

## Acceptance
- Stale-head review never satisfies the gate.
- Required independent reviewer is distinct from implementer.
- Scope and required checks are verified before PASS.
- Material claims map to current, suitable evidence; a screenshot alone cannot prove behavior or persistence.
- Separate actual defects from advisory improvements; zero reproducible defects is valid for the tested scope, but untested scope must be disclosed.
- PASS never overrides explicit Owner/hard gates.

## Evidence
- #1874 independent review of PR #1568.
- #2194 independent review of PR #2193.
- Existing TigerIQ branch -> PR -> exact-head checks -> independent-review flows.
- Two-axis technique adapted from mattpocock/skills `skills/engineering/code-review/SKILL.md` @ `b0618bc436ad893b3c5e84e55fba86586d34a404` (MIT).
- Claim/evidence separation adapted from msitarzewski/agency-agents `testing/testing-evidence-collector.md` and `testing/testing-reality-checker.md` @ `f99f6aa910a442b0197b768ce0ea7751e35e2060` (MIT). No external agent profile was installed; see learning log 2026-10-08 and #4578 - [P2][SKILLS][TÍCH HỢP] Chọn lọc Matt Pocock Skills + The Agency, loại trùng và nâng chuẩn kỹ thuật.

## Fallback
If exact-head evidence or an independent reviewer is unavailable, keep the PR unapproved/parked and record the missing gate.

## Safety
The reviewer does not mutate the implementation under review, self-approve when independence is required, or bypass Production/credential/security/destructive gates.

## Non-goals
This skill does not merge by itself merely because a textual review says PASS.
