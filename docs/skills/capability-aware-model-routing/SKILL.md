# Capability-Aware Model Routing

## Identity
- ID: capability-aware-model-routing
- Version: 1.0.0
- State: ACTIVE
- Target: router
- Provenance: registry.yaml

## Trigger
Use when selecting an AI resource/model/provider for reasoning, review, research, or general execution.

## Input
- Required capability and task difficulty.
- Observed reliability, latency, quota/cooldown, and cost tier.
- Reviewer-independence constraints when applicable.

## Steps
1. Filter to resources eligible for the required capability and authorization.
2. Exclude unavailable/rate-limited/cooldown resources using live evidence.
3. Rank by difficulty fit, reliability, latency, quota, and zero-out-of-pocket policy.
4. Prefer a lighter eligible resource when it can meet acceptance.
5. Fail over only within existing authorization.

## Tools / Output
Use the current smart router/resource registry. Output the selected resource plus routing reasons and bounded failover evidence.

## Acceptance
- Selected resource is capability-eligible and currently usable.
- Reviewer independence is preserved for review work.
- No paid route is chosen merely because it is stronger.

## Evidence
- apps/tigeriq-core/smart-router.mjs
- apps/tigeriq-core/workforce-registry.mjs
- Runtime routing decisions/resources.

## Fallback
If no eligible resource exists, return a bounded wait/block condition with the exact resource reason; do not silently widen permissions or cost.

## Safety
This skill does not create credentials, enable paid services, change provider security settings, or override cooldown/authorization gates.

## Non-goals
It does not always choose the strongest model and does not guarantee provider availability.
