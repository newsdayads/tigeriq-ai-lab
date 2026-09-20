# Web Control Verification

## Summary of Changes
- Replaced hard-coded health endpoints with dynamic config lookups (`window.TIGERIQ_HEALTH_ENDPOINT`) and added proper live-refresh hooks (`visibilitychange`, `focus`, and cleanup intervals).
- Updated `web-control.html` with responsive layout classes (`responsive-layout`, `container-fluid`) and ARIA accessibility attributes (`aria-label`, `role="main"`, `role="region"`, `role="navigation"`).
- Extended `tests/web-control-runtime.test.ts` to assert live-refresh hooks and responsive layout enhancements.

## Manual Test Steps
1. Run `npx vitest run tests/web-control-runtime.test.ts` to verify runtime tests pass.
2. Start the core web control server and open `http://localhost:8796/` in a browser.
3. Switch tabs and return to verify automatic live-refresh execution without errors.