# WO-034 — Web Control PWA entry reconciliation

## Goal
Make the already-installed TigerIQ Web Control/PWA surface the executive Command Center instead of reopening the legacy chat entry, without removing chat.

## Acceptance gates
- `/` remains the executive Command Center.
- A PWA/window already sitting on `/index.html` is navigated to `/command-center.html` when the new service worker activates.
- A fresh direct navigation to `/index.html` is redirected to `/command-center.html`.
- Clicking `Chat` from `/command-center.html` to `/index.html` remains allowed, so existing chat/dispatch/settings/token behavior is preserved.
- Service worker remains network-first; no stale HTML cache is introduced.
- Deterministic test verifies the redirect/allow-chat rules.
- CI, Queue Hygiene, Vercel Verify and Production GET gates must PASS before DONE.

## Evidence boundary
Do not claim the installed iPhone PWA visibly refreshed until a later real-device screenshot confirms it. Production code/deployment PASS is a separate gate.
