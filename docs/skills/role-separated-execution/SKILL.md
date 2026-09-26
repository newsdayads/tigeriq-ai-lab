# Role-Separated Execution

## Trigger
Use for repository/source mutation, implementation/review workflows, or work where independent verification materially reduces risk.

## Rules
- Keep planner/implementer/reviewer/verifier responsibilities explicit.
- For source mutation, the independent reviewer must not be the same AI resource that implemented the change.
- Respect one-active-mutation-owner per resource/scope.
- Review acceptance, tests, scope boundaries, and evidence before merge.
- Never claim a background worker exists without runtime evidence.

## Non-goals
This skill does not authorize Production/runtime release, paid actions, credential/security changes, or destructive operations.
