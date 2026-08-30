# WO-031 — Mobile Workforce Board

Priority: P0
Status: IMPLEMENTING
Date: 2026-08-31

## Objective
Provide a mobile-first, read-only Workforce operations board without making Vercel a durable Workforce authority.

## Scope
- `/workforce` static mobile board on Vercel.
- `/api/workforce-status` stateless read-only ingress.
- PC01/Farm Controller remains the durable authority.
- Ingress target is configured only by server environment and must use HTTPS; credentials must not be embedded in the URL.
- Optional status bearer credential stays in Vercel environment only and is never returned to the browser.
- Controller response is allow-listed/sanitized to Workforce aggregate status fields only.
- If no ingress is configured or the controller is unreachable, the board must show `Not connected` and must not fabricate live node/employee/task data.
- Existing `/api/control` remains the source for Web Control/GitHub queue health.

## Gates
- Unit tests for disconnected state, HTTPS enforcement, credential isolation and response sanitization.
- Existing repository CI PASS.
- Queue Hygiene PASS.
- Vercel Verify PASS.
- Preview READY and `/workforce` renders successfully.
- Merge only at an exact tested head, then verify Production `/workforce`, `/api/workforce-status`, and `/api/control`.
- Preserve canonical PC01 issues #57/#58; no canary creation.

## Non-claims
- No live PC01 status ingress is claimed until an authorized reachable HTTPS status path is configured.
- No physical device, PC01 runtime, provider credential, billing or Driver mutation is part of this Work Order.
