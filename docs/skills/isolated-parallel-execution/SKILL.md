# Isolated Parallel Execution

## Trigger
Use when two or more implementation/research lanes could touch overlapping repository, branch, worktree, or RESOURCE_SCOPE state.

## Rules
- Assign exactly one active mutation owner per RESOURCE_SCOPE.
- Use isolated branch/worktree/resource scope for independent mutations.
- Never let parallel workers write the same protected scope concurrently.
- Reconcile through explicit compare/review before merge; do not silently combine divergent changes.
- Preserve dependency, lease, and handoff evidence so interrupted work can resume from durable references.

## Output
A scoped execution plan or implementation result that names the isolated resource/branch, active owner, dependency boundary, and merge/reconcile evidence.

## Evidence
- Current canonical governance enforces ONE_RESOURCE_SCOPE_ONE_WRITER in #280/#504/#335.
- Repeated branch -> PR -> exact-head checks -> independent review workflows, including #1566/#2193, demonstrate isolated mutation and controlled reconciliation.

## Non-goals
This skill does not authorize Production release, credential/security changes, destructive actions, paid actions, or App Chrome mutation.
