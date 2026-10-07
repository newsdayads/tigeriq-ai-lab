# Core Manager Planner

## Identity
- ID: core-manager-planner
- Version: 0.1.0
- State: CANDIDATE
- Target: core-manager
- Provenance: #4457; #4463; #4497

## Trigger
Use when TigerIQ Core needs to assess a bounded P1-P5 objective and propose a structured planning delta: priorities, decomposition, dependencies, critical path, parallel groups, capability fit, acceptance evidence, and replan triggers.

Do not use for P0 or for any step gated by credentials, security/permission changes, paid/financial action, destructive/irreversible action, or Production authority.

## Input
- Authoritative objective/work-order snapshot and source revision.
- Current validated work graph: tasks, dependencies, terminal evidence, blockers, and concurrency groups.
- Current resource snapshot: capability, health, quota, latency, success evidence, and active lease/work.
- Deterministic policy constraints: priority class, resource scope, one-writer rule, review separation, cost/security/Production gates.
- Previous accepted plan/checkpoint when replanning.

## Steps
1. Reconcile only the supplied authoritative state; never invent missing GitHub/runtime facts.
2. Assess the objective against current acceptance and terminal evidence.
3. Rank runnable tasks by priority, critical-path impact, unblock value, aging, and resource fit.
4. Propose the smallest justified decomposition. Preserve existing task IDs/scopes when still valid.
5. Express dependencies and concurrency groups explicitly; never make a blocked sibling park unrelated runnable work.
6. Recommend capability/skill profiles, not a hard-coded employee/provider identity.
7. Define acceptance and evidence required for every proposed task.
8. Mark only the exact blocked step and state the concrete unblock condition.
9. Emit replan triggers for terminal task events, resource health changes, lease release, new higher-priority work, or stale-plan detection.
10. Submit the plan delta to the deterministic governor. Treat rejection/trim as authoritative and do not bypass it.

## Output
A strict PLAN_DELTA proposal containing only fields accepted by the current Core planning contract. At minimum it should communicate:
- objective assessment;
- ranked runnable tasks;
- justified new/superseded plan nodes;
- dependencies and parallel groups;
- critical path;
- preferred capability/skill profile;
- acceptance/evidence requirements;
- exact blocker + unblock condition when applicable;
- replan trigger.

The output is advisory until accepted by the deterministic governor.

## Acceptance
- No P0 planning or authority escalation.
- No duplicate task/resource-scope mutation.
- No same-resource implementer/reviewer recommendation.
- Dependencies remain acyclic and runnable ordering is deterministic for equal inputs.
- Blocked work releases unrelated runnable siblings.
- Every executable proposal carries acceptance/evidence requirements.
- Stale source revision fails closed or requests replan; it is never silently accepted.
- Planner never directly dispatches, merges, publishes, changes credentials, spends money, changes security boundaries, or performs destructive actions.

## Evidence
- #4457 defines the AI Manager Brain / PLAN_DELTA / deterministic governor architecture.
- #4463 implements and verifies the shadow PLAN_DELTA + Manager-HA contract used as the current behavioral boundary.
- #4497 defines this reusable planner skill as documentation-only candidate material.

## Fallback
If authoritative state is incomplete, stale, cyclic, or policy-constrained, return a bounded no-mutation planning result that identifies the exact missing evidence or blocked step. Do not create speculative work solely to keep resources busy.

## Safety
The deterministic governor is final authority. This skill cannot override owner gates, P0 controls, resource leases, one-writer rules, independent-review separation, zero-cost policy, credential/security boundaries, Production gates, or destructive-action protections.

Codex is not implicitly authorized by this skill. Any Codex use still requires separate explicit Owner approval for the exact bounded scope.

## Non-goals
- Selecting a permanent Manager employee/provider.
- Implementing resource health/latency scoring (#4465).
- Implementing shared Core/Coding Lane leases (#4467).
- Dispatching or mutating repository/runtime state.
- Activating this skill in runtime before validation, tests, promotion evidence, and reviewed registry promotion.
