# Web Control V1 branch state

Date: 2026-09-02

PR #117 is being refactored to the approved TigerIQ V1 architecture. Web Control is a client of the PC01 Workforce Controller through Tailscale; GitHub/Vercel are not operational queue/state sources. The branch is CODE/TEST scope only and does not prove a live PC01 Controller connection or JOB-001 execution.

Current Web truth rules: mock is non-authoritative; Controller snapshots must be authoritative and schema-valid; no fallback to GitHub/Vercel for live state; no browser admin secret; no MAIN/Production or paid-service action.

See `docs/contracts/WEB_CONTROL_CONTROLLER_CONTRACT_V1.md` and `docs/work-orders/WO-045-WEB-CONTROL-REMOTE-OPS.md`.
