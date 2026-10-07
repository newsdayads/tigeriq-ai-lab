# Core Resource Scheduler

## Identity
- ID: core-resource-scheduler
- Version: 0.1.0
- State: CANDIDATE
- Target: core-manager
- Provenance: #4457; #4462; #4463; #4499

## Trigger
Use when TigerIQ Core has a validated work graph and needs to rank currently runnable P1-P5 tasks against currently eligible resources without violating dependencies, leases, review separation, or owner gates.

Do not use for P0 or for any step gated by credentials, security/permission changes, paid/financial action, destructive/irreversible action, or Production authority.

## Input
- Authoritative runnable-task set with priority, dependencies, critical-path position, aging, unblock value, capability/skill needs, resource scope, and acceptance requirements.
- Current resource snapshot with capability, skills, health, quota, latency/success evidence, current work, cooldown and lease state.
- Deterministic policy constraints: P1>P2>P3>P4>P5, one-resource-scope-one-writer, independent review separation, owner gates, zero-cost rules.
- Current accepted plan/checkpoint and any newly emitted replan triggers.

## Steps
1. Filter to tasks whose dependencies are satisfied and whose exact blocked step is clear.
2. Exclude tasks or resources blocked by active lease, owner gate, cooldown, security/cost/credential/Production boundary, or one-writer conflict.
3. Rank runnable work by priority first, then critical-path impact, unblock value, aging, and resource fit.
4. Recommend capability/skill fit rather than hard-coding a specific employee/provider.
5. Prefer resources with current functional evidence and healthy quota/latency only when those facts are supplied by authoritative resource state.
6. Preserve reviewer independence: never recommend the same resource for implementation and independent review of the same change.
7. Release unrelated runnable siblings from false parent parking; one blocked child must not globally stall safe work.
8. Emit at most the bounded set of next scheduling candidates needed for the current decision cycle.
9. Re-evaluate on task terminal state, lease release, resource health change, higher-priority arrival, or stale-plan detection.
10. Submit the scheduling recommendation to the deterministic governor/lease layer. Never dispatch directly.

## Output
A bounded scheduling recommendation containing:
- ordered runnable task IDs;
- preferred capability/skill profile per task;
- eligible resource candidates or exclusion reasons when supplied by authoritative state;
- dependency/critical-path rationale;
- exact blocked step + unblock condition when applicable;
- reviewer-separation constraint;
- replan trigger.

The output is advisory until accepted by the deterministic governor and canonical lease layer.

## Acceptance
- P1 work always outranks lower priorities absent an explicit canonical constraint.
- No task with unsatisfied dependencies is recommended runnable.
- No active lease or one-writer conflict is bypassed.
- No same-resource implementer/reviewer recommendation.
- Blocked sibling does not falsely park unrelated runnable work.
- Equal authoritative inputs produce deterministic ordering.
- No speculative resource health, latency, quota, credential or runtime facts are invented.
- Scheduler never directly dispatches, merges, publishes, changes credentials, spends money, changes security boundaries, or performs destructive actions.

## Evidence
- #4457 defines continuous scheduling/work stealing and the deterministic governor boundary.
- #4462 verifies continuity behavior that should release the next eligible phase instead of letting the queue fall to zero.
- #4463 verifies PLAN_DELTA/Manager-HA shadow boundaries consumed by scheduling decisions.
- #4499 defines this reusable scheduler skill as documentation-only candidate material.

## Fallback
If the runnable set or resource state is incomplete, stale, contradictory, or policy-constrained, return a no-dispatch result identifying the exact missing evidence or blocked condition. Do not invent work merely to keep a resource occupied.

## Safety
The deterministic governor and canonical lease system are final authority. This skill cannot override owner gates, P0 controls, active leases, one-writer rules, independent-review separation, zero-cost policy, credential/security boundaries, Production gates, or destructive-action protections.

Codex is not implicitly authorized by this skill. Any Codex use still requires separate explicit Owner approval for the exact bounded scope.

## Non-goals
- Implementing Coding Lane health/latency manager scoring (#4465).
- Implementing shared Core/Coding Lane lease persistence or API Health BUSY projection (#4467).
- Owning resource leases or dispatch side effects.
- Replacing the deterministic governor.
- Activating this skill in runtime before validation, promotion evidence, reviewed registry mutation and applicable tests.
