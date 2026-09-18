# Role-Separated Execution

Status: ACTIVE
Issue: #864 - Active Skill Loader — Core chỉ nạp skill ACTIVE đúng việc
Target: orchestration

## Apply when
The objective involves source mutation, implementation, review, coding, or verification where independent checking improves safety.

## Rules
- Keep planner/implementer/reviewer responsibilities explicit.
- Reviewer must be independent from the implementer for source changes.
- One active mutation owner per resource/scope.
- A review does not replace tests/checks/evidence.
- Do not expand Production, credential, paid, destructive, or irreversible authority.

## Evidence
- apps/tigeriq-coding-lane/coding-lane.mjs enforces separate implementer/reviewer identities.
- docs/ADR/0012-autonomous-coding-lane.md records the accepted Coding Lane review architecture.
