# Isolated Parallel Execution

## Identity
- ID: isolated-parallel-execution
- Version: 1.0.0
- State: ACTIVE
- Target: orchestration
- Provenance: registry.yaml; governance #280/#504/#335

## Trigger
Use when two or more implementation/research lanes could touch overlapping repository, branch, worktree, or RESOURCE_SCOPE state.

## Input
- Candidate lanes/work items.
- RESOURCE_SCOPE and allowed paths.
- Current mutation owner/lease, dependencies, and branch/worktree state.

## Steps
1. Assign exactly one active mutation owner per RESOURCE_SCOPE.
2. Give independent mutations isolated branch/worktree/resource scopes.
3. Prevent concurrent writes to overlapping protected scopes.
4. Reconcile through explicit compare/review before merge.
5. Preserve dependency, lease, and handoff evidence for resumption.

## Tools / Output
Use existing branch/worktree/resource-scope mechanisms. Output an isolated execution plan/result naming owner, scope, branch/resource, dependencies, and reconcile evidence.

## Acceptance
- Overlapping scope never has two simultaneous mutation owners.
- Independent work remains isolated until explicit reconcile/review.
- Interrupted work can resume from durable ownership/handoff evidence.

## Evidence
- Governance #280/#504/#335.
- Existing branch -> PR -> exact-head checks -> independent-review flows including #1566/#2193.

## Fallback
If isolation cannot be proven, serialize the work and park the lower-priority mutation step rather than risking concurrent writes.

## Safety
This skill does not authorize Production release, credential/security changes, destructive actions, paid actions, or App Chrome mutation.

## Non-goals
It does not parallelize work merely for speed when isolation/evidence cost outweighs the benefit.
