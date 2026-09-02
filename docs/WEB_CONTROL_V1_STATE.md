# Web Control V1 branch state

Date: 2026-09-02

CHAT 01 scope: Web Control only on PR #117. MAIN/Production remain unchanged.

## Current target

Deliver an unmistakable TigerIQ V1 company operations dashboard before PC01 is physically available. The UI includes company progress, departments, AI employees, providers, jobs, results, quality gates, recovery and audit history using a non-authoritative mock snapshot that matches the Controller contract.

## Truth boundary

- PC01 Workforce Controller/PostgreSQL will be the live Source of Truth.
- GitHub/Vercel are not runtime queue/state sources.
- Mock data is always `authoritative=false` and visibly marked as sample data.
- No `WEB_CONTROL_V1_VISUAL_PREVIEW_READY` may be recorded until an exact-head Vercel Free Preview is READY and fetchable as the actual V1 dashboard.
- No paid Vercel action or retry spam.
