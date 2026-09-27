# Core autonomous GitHub intake

GitHub remains TigerIQ's Source of Truth. Core is the dispatcher for API/Coding/OpenClaw lanes; NV02/NV03/NV04 remain external UI workers and are not routed by Core.

## Event-driven lifecycle

1. A GitHub Issue or authoritative issue comment changes.
2. GitHub Actions workflow `TigerIQ Core Event Dispatch` runs from canonical `main`.
3. The workflow obtains a short-lived GitHub Actions OIDC token with audience `tigeriq-core`.
4. The current read-only PC01 bridge URL is resolved from issue #1402 and receives the signed event.
5. The bridge only relays the request to Core; Core verifies OIDC claims/signature, repository and canonical workflow identity.
6. Core durably deduplicates the delivery in `tigeriq_events` and wakes the matching GitHub intake lane.
7. Core evaluates the existing Work Order policy and routes eligible API/Coding/OpenClaw work as before.
8. Claims, progress, PRs and terminal results continue to be written back to GitHub.

No persistent webhook secret is required. OIDC is short-lived and bound to the canonical repository/workflow.

## Reconciliation safety net

Full GitHub reconciliation is a fallback, not the normal hot path. Reasoning and Coding intake perform full-list reconciliation no more frequently than every 300 seconds. The shared GitHub transport coalesces duplicate GETs and uses ETag / `If-None-Match` conditional requests.

When GitHub reports primary rate exhaustion, Core honors reset/retry headers and fails closed instead of spinning. Missed events are recovered by the next reconciliation pass.

## Runtime updates

`TigerIQ Core Runtime Updater` continues to poll `origin/main` every 120 seconds for gate-passed source changes. The Live Status Bridge server is canonical source under `apps/tigeriq-live-bridge/server.mjs`; updater syncs it to the PC01 runtime and reconciles by port health, so an already healthy bridge does not recreate the Cloudflare tunnel or rewrite pointer #1402 every updater cycle.

No raw token is written to GitHub, chat, or logs.
