# WO-068 — Web Control Live Backend V1

Date: 2026-09-04
Status: IMPLEMENTING — REPOSITORY GATE PENDING
Branch: `wo068/web-control-live-backend`
Base: `wo067/live-runtime-journal-recovery`
MAIN/Production: untouched

## Objective
Replace manual/static Web Control snapshots with a continuously refreshed projection built from the actual PC01 Continuous Operations, Autonomous Planner, Mission Orchestrator, and AI registry files.

## Scope
- Read live Continuous Operations state.
- Read live Autonomous Planner backlog + runtime state.
- Read live Mission Orchestrator runtime state.
- Read Provider/Model/AI Employee registries from the PC01 workspace.
- Project real goal/task/provider/employee/runtime-loop status into the existing validated Web Control snapshot schema.
- Refresh the projection on a bounded interval from the standalone Web Control process.
- Keep Web Control HTTP server loopback-only and preserve existing login/CSRF/write controls.
- No external provider calls, credentials, MAIN/Production mutation, Cloudflare deployment, or paid action.

## Acceptance
1. Live projection unit test proves goals/tasks/providers/employees/runtime-loop status derive from source files.
2. Existing Web Control server/render security tests remain PASS.
3. Typecheck, full unit suite, Playwright smoke, build, and existing PowerShell parser gate PASS on exact head.
4. Physical PC01 install remains separately gated.
