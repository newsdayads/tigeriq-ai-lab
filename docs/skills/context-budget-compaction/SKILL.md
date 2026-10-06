# Context Budget and Compaction

## Identity
- ID: context-budget-compaction
- Version: 1.0.0
- State: ACTIVE
- Target: core-context-routing
- Provenance: registry.yaml; #886

## Trigger
Use when a Manager/model call contains repeated operational context that can be compacted without losing the current goal, phase acceptance, ownership, blockers, or evidence references.

## Input
- Current goal and phase acceptance.
- Recent job/history rows.
- Authorization guardrails and evidence references.
- Hard byte budget and reserved headroom.

## Steps
1. Keep goal, phase acceptance, and authorization guardrails outside compactable history.
2. Build history deterministically without an extra AI summarization call.
3. Preserve job status, worker/provider/resource identity, and evidence refs.
4. Compact rows before dropping items.
5. Enforce byte budget and reserve headroom.
6. Fail safe to empty history if compaction itself fails.

## Tools / Output
Use the existing Context Gateway implementation. Output a bounded context block plus deterministic compaction metrics.

## Acceptance
- Context stays within the configured hard budget.
- Required goal/acceptance/ownership/blocker/evidence information is preserved.
- Metrics report items/bytes in/out, drops, truncation, budget, and headroom.
- Compaction failure alone does not block the Manager.

## Evidence
- apps/tigeriq-core/context-gateway.mjs
- apps/tigeriq-core/core.mjs
- tests/core-context-gateway.test.ts

## Fallback
On compaction failure, use an empty history block while preserving non-compactable goal/acceptance/guardrail context.

## Safety
Do not preload full chat history, the full repository, or the full Skill Registry. This skill does not authorize Production/runtime release, paid actions, credential/security changes, destructive actions, or APP Chrome/Worker Utility mutation.

## Non-goals
It does not replace durable source-of-truth references and does not use another model call merely to summarize context.
