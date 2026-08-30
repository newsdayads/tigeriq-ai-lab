# WO-034 — Web Control PWA entry reconciliation

## Goal
Ensure the already-installed TigerIQ Web Control/PWA visibly surfaces company progress immediately, even when the user opens the legacy chat entry path directly.

## Acceptance gates
- Existing `/` executive command center remains primary.
- Legacy `/index.html` exposes a prominent, one-tap executive progress entry and automatically loads verified active-work progress without hiding the existing chat/composer.
- No fabricated percentage: progress comes from `/api/company-progress` evidence gates.
- Existing chat, dispatch, settings and token behavior remain intact.
- Cache behavior remains network-first/no-store for Web Control documents.
- CI, Queue Hygiene, Vercel Verify and Production GET gates PASS before DONE.

## Evidence boundary
Do not claim the user's installed PWA has refreshed until a real-device screenshot/GET confirms the new UI.
