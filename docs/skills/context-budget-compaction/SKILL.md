# Context Budget and Compaction

Status: ACTIVE
Issue: #886 - Context Gateway — lọc/nén context trước Manager call
Target: core-context-routing

## Apply when
A Manager/model call includes recent job history or other repeated operational context that can be compacted without losing the current goal, phase acceptance, ownership, blockers, or evidence references.

## Rules
- Keep goal, current phase/acceptance and authorization guardrails outside the compactable history block.
- Build history deterministically; do not use an extra AI call merely to summarize context.
- Preserve job status, worker/provider/resource identity and evidence references when present.
- Enforce a hard byte budget and reserve headroom.
- Prefer a smaller row representation before dropping a history item.
- Fail safe to an empty history block if compaction fails; never block the Manager solely because context compaction failed.
- Emit metrics for items/bytes in and out, drops, truncation, budget and headroom.
- Do not preload full chat history, the full repository, or the full Skill Registry.

## Evidence
- apps/tigeriq-core/context-gateway.mjs
- apps/tigeriq-core/core.mjs
- tests/core-context-gateway.test.ts

## Non-goals
This skill does not authorize Production/runtime release, paid actions, credential/security changes, destructive actions, or APP Chrome/Worker Utility mutation.
