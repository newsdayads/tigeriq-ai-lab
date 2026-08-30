# WO-031 — Mobile Workforce Board

Priority: P0
Status: IMPLEMENTING
Date: 2026-08-31

## Objective
Provide a mobile-first executive operations board where the Owner can understand within seconds: what TigerIQ is doing now, verified progress, current gate, recent activity, Workforce capacity, infrastructure health, and whether Owner action is required. Vercel remains a stateless Web Control surface; PC01/Farm Controller remains the durable Workforce authority.

## Scope
- `/workforce` executive-first mobile board on Vercel.
- `/api/company-progress` derives current engineering progress from the actual open Work Order PR and exact-head GitHub Actions evidence. Progress is gate-based rather than AI-estimated.
- Base engineering gates: Code/PR -> CI -> Queue Hygiene -> Vercel Verify -> Merge/Production. Android work adds the Android Worker build gate.
- `/api/workforce-status` remains the stateless read-only Workforce ingress.
- PC01/Farm Controller remains the durable authority for live node/employee/task state.
- Ingress target is configured only by server environment and must use HTTPS; credentials must not be embedded in the URL.
- Optional status bearer credential stays in Vercel environment only and is never returned to the browser.
- Controller response is allow-listed/sanitized to Workforce aggregate status fields only.
- If no Workforce ingress is configured or the controller is unreachable, the board explicitly says it is disconnected and never fabricates phone/node/employee data.
- Existing `/api/control` remains the source for Vercel/GitHub/PC01 queue health.
- Executive dashboard hides technical detail by default while still exposing evidence-backed gate state and activity.

## Owner-facing layout
1. TigerIQ 24/7 status bar.
2. Current priority Work Order with deterministic progress percentage.
3. Gate list with PASS/RUNNING/FAIL/PENDING.
4. Recent exact-head engineering activity.
5. Workforce employee/node/task/capacity summary.
6. Department and task lifecycle summaries.
7. `Cần Sếp` panel, explicitly green when no Owner action is required.
8. Infrastructure health and canonical PC01 queue.

## Gates
- Unit tests for disconnected Workforce state, HTTPS enforcement, credential isolation and response sanitization.
- Unit tests for deterministic company progress and failed/running gate handling.
- Existing repository CI PASS.
- Queue Hygiene PASS.
- Vercel Verify PASS.
- Preview READY and `/workforce`, `/api/company-progress`, `/api/workforce-status` render successfully.
- Merge only at an exact tested head, then verify Production `/workforce`, `/api/company-progress`, `/api/workforce-status`, and `/api/control`.
- Preserve canonical PC01 issues #57/#58; no canary creation.

## Non-claims
- Engineering progress does not imply live Android execution.
- No live PC01 Workforce ingress is claimed until an authorized reachable HTTPS status path is configured.
- No physical device, PC01 runtime, provider credential, billing or Driver mutation is part of this Work Order.
