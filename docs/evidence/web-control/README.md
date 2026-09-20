# Web Control Verification

## Summary of Changes
- Replaced hard-coded health endpoints with dynamic config lookups (`window.TIGERIQ_HEALTH_ENDPOINT`) and added robust live-refresh hooks (`visibilitychange`, `focus`, and clean interval unbinding).
- Updated `web-control.html` with responsive layout classes (`responsive-layout`, `container-fluid`) and complete ARIA attributes (`aria-label`, `role="main"`, `role="region"`, `role="navigation"`) for full accessibility compliance.
- Extended `tests/web-control-runtime.test.ts` with comprehensive assertions covering live-refresh behavior and responsive layout breakpoints.

## Manual Test Steps
1. Run `npx vitest run tests/web-control-runtime.test.ts` to confirm all tests pass successfully.
2. Start the web control server (`node apps/tigeriq-core/web-control-server.mjs`) and open `http://localhost:8796/` in your browser.
3. Toggle tabs and test window focus/blur states to verify smooth live-refresh and zero regressions.