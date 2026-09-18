# Capability-Aware Model Routing

Status: ACTIVE
Issue: #864 - Active Skill Loader — Core chỉ nạp skill ACTIVE đúng việc
Target: router

## Apply when
The objective requires choosing an AI/API resource, model, provider, reasoning tier, or failover path.

## Rules
- Route by required capability/task kind before preference.
- Prefer zero-out-of-pocket/local resources when they satisfy acceptance.
- Use health/quota/latency/success telemetry as routing evidence.
- Reserve stronger resources for tasks that benefit from them.
- Fail over without weakening safety or review boundaries.

## Evidence
- apps/tigeriq-core/smart-router.mjs ranks resources using routing profile and runtime signals.
- apps/tigeriq-core/core.mjs records routing decisions/telemetry and invokes routed resources.
