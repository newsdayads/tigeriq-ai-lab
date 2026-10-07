# Core Replanner

## Identity
- ID: core-replanner
- Version: 0.1.0
- State: CANDIDATE
- Target: core-manager
- Provenance: #4457; #4462; #4463; #4501

## Trigger
Use when an accepted P1-P5 plan must be reconsidered because authoritative state changed: task completed/failed/blocked, lease released, resource health changed, a higher-priority work item arrived, source revision changed, repeated evidence signature indicates no progress, or previous assumptions became stale.

Do not use for P0 or for any step gated by credentials, security/permission changes, paid/financial action, destructive/irreversible action, or Production authority.

## Input
- Current authoritative objective/work graph and source revision.
- Last accepted PLAN_DELTA/checkpoint and its task/dependency state.
- New terminal evidence, blocker evidence, resource/lease changes, or priority arrivals.
- Current deterministic policy constraints: P1-P5 ordering, owner gates, one-writer scope, independent-review separation, zero-cost/security/Production rules.
- Replan trigger with durable source/evidence reference.

## Steps
1. Validate the replan trigger against authoritative state; ignore duplicate/stale triggers.
2. Compare current state with the last accepted plan and identify only nodes invalidated by new evidence.
3. Preserve still-valid task IDs, dependencies, acceptance and completed evidence.
4. Cancel or supersede stale plan nodes only when their invalidation is supported by evidence.
5. Re-rank runnable work by priority, critical path, unblock value, aging and resource fit.
6. Keep unrelated runnable siblings moving when one child is blocked.
7. For repeated failure/no-progress signatures, change strategy or escalate the exact blocked step instead of replaying the same plan.
8. Recommend bounded additions/removals/reordering with explicit rationale and acceptance evidence.
9. Do not bypass active leases, one-writer rules or reviewer separation.
10. Submit the proposed delta to the deterministic governor; treat governor trim/reject as authoritative.

## Output
A bounded REPLAN / PLAN_DELTA proposal containing:
- trigger and source revision;
- objective assessment change;
- preserved, superseded and new plan nodes;
- updated runnable ranking and critical path;
- dependency/concurrency changes;
- exact blocker + unblock condition where applicable;
- acceptance/evidence requirements for changed nodes;
- next replan triggers.

The output remains advisory until accepted by the deterministic governor.

## Acceptance
- Stale or duplicate triggers do not create duplicate work.
- Completed evidence is preserved and not replayed.
- No P0 planning or authority escalation.
- No active lease or one-writer conflict is bypassed.
- No same-resource implementer/reviewer recommendation.
- Repeated identical failure signatures do not cause unbounded replay.
- Blocked child does not falsely park unrelated runnable siblings.
- Equal authoritative state + trigger produces deterministic replan ordering.
- Replanner never directly dispatches, merges, publishes, changes credentials, spends money, changes security boundaries, or performs destructive actions.

## Evidence
- #4457 defines AI replanning, no-progress signature guard, continuous scheduling and deterministic governor authority.
- #4462 verifies continuity behavior after terminal child events.
- #4463 verifies PLAN_DELTA/Manager-HA shadow validation and safety boundaries.
- #4501 defines this reusable replanner skill as documentation-only candidate material.

## Fallback
If the trigger or authoritative state is incomplete, contradictory, stale, or policy-constrained, return a no-mutation replan result naming the exact missing evidence or blocked condition. Do not invent replacement tasks simply to maintain activity.

## Safety
The deterministic governor, canonical work graph and lease system are final authority. This skill cannot override owner gates, P0 controls, resource leases, one-writer rules, independent-review separation, zero-cost policy, credential/security boundaries, Production gates, or destructive-action protections.

Codex is not implicitly authorized by this skill. Any Codex use still requires separate explicit Owner approval for the exact bounded scope.

## Non-goals
- Implementing Coding Lane health/latency manager scoring (#4465).
- Implementing shared Core/Coding Lane leases (#4467).
- Owning dispatch, merge, publish or runtime side effects.
- Replacing the deterministic governor or canonical source of truth.
- Activating this skill before validation, promotion evidence, reviewed registry mutation and applicable tests.
