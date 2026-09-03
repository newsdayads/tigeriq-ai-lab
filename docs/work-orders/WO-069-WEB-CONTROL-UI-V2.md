# WO-069 — Web Control UI V2

Date: 2026-09-04
Status: IMPLEMENTING — REPOSITORY GATE PENDING
Branch: `wo069/web-control-ui-v2`
Base: `wo068/web-control-live-backend`
MAIN/Production: untouched

## Objective
Replace the sparse Web Control presentation with a dense, glanceable operations dashboard suitable for desktop and iPhone use while preserving the real-data-only rule and existing secure control paths.

## UX requirements
- Clear TigerIQ identity and recognizable navigation icons.
- Immediate system health strip: PC01 runtime, live freshness, workers, queue, authorization.
- Visual KPI cards with progress/context rather than bare numbers.
- Goal pipeline, AI Workforce, Live Queue, Provider/API Center, Authorization, Evidence and Massive AI Workflow visible without ambiguity.
- Mobile layout optimized for quick control from iPhone.
- Existing login, CSRF, PAUSE/RESUME, Goal submission and loopback-only server behavior preserved.
- Never fabricate AI/provider/runtime data.

## Acceptance
1. Existing renderer/security regression tests PASS.
2. New UI contract test verifies navigation icons, health strip, KPI context, mobile navigation and all operational surfaces.
3. Typecheck, unit suite, Playwright smoke and build PASS on exact code head.
4. MAIN/Production untouched; physical PC01 deployment separately gated.
