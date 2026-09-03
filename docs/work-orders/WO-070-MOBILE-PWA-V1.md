# WO-070 — Mobile PWA V1

Date: 2026-09-04
Status: IMPLEMENTING — REPOSITORY GATE PENDING
Branch: `wo070/mobile-pwa-v1`
Base: `wo069/web-control-ui-v2`
MAIN/Production: untouched

## Objective
Make Web Control installable and app-like on iPhone/Android without weakening the existing authentication or real-time control semantics.

## Scope
- Web App Manifest and app icon.
- iOS/Android standalone/mobile metadata.
- Same-origin service worker registration.
- Service worker MUST NOT cache authenticated HTML, CSRF tokens, API responses, control state, goals, or runtime data.
- Static PWA resources may be cached; operational requests remain network-only.
- Existing loopback binding, login, CSRF and write controls remain unchanged.
- No Cloudflare deployment in this work order.

## Acceptance
1. Manifest/icon/registration/service-worker routes return correct content types.
2. CSP permits only same-origin PWA script/worker/manifest resources.
3. Service worker source explicitly excludes operational HTML/API/control caching.
4. Renderer includes iOS standalone metadata and manifest link.
5. Existing security/render/live-backend tests plus full CI PASS.
