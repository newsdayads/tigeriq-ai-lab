# TigerIQ Animal City — operational local product

Authority: Owner-approved Work Order #5424.

Animal City is a loopback-only TigerIQ operator view. It reads canonical Work Orders from TigerIQ Core and separately reads live Core runtime evidence for active workers/jobs. It is not a second scheduler, lease service, or dispatch surface.

## Product behavior

- Work Orders: `GET http://127.0.0.1:8795/api/work-orders`.
- Live workers: `GET http://127.0.0.1:8795/api/status`.
- A worker is displayed as active only when Core reports the resource as `BUSY` and an exact `running` job matches the same employee/resource/current job ID.
- A live shared lease is shown only when the matching lease is unexpired. A Core job/resource binding may still be verified without a shared lease because not every Core execution path uses the shared-lease table.
- Missing/stale/invalid sources fail closed. No cached card or worker is substituted.
- Animal rooms remain presentation grouping only. They do not create a Core assignment.

## Run manually on PC01

Requires Node.js >=20 and TigerIQ Core on `http://127.0.0.1:8795`.

From repository root:

    node apps/agents-city-tigeriq/server.mjs

Open:

    http://127.0.0.1:8866/

Operational endpoints:

    GET /health
    GET /ready
    GET /api/rooms
    GET /api/live

All mutating HTTP methods are rejected. Host validation restricts use to localhost.

## Managed PC01 operation

The reversible user-level runtime helper is:

    powershell -NoProfile -File apps/agents-city-tigeriq/pc01-operational.ps1 -Action install

Supported actions:

    install | start | stop | restart | status | uninstall

The task is registered as `TigerIQ-Animal-City` with `RunLevel Limited`, `LogonType Interactive`, a single-instance policy and automatic restart on process failure. It does not request administrator elevation, does not bypass PowerShell execution policy, does not change firewall/network/security settings, and keeps the HTTP server on `127.0.0.1`.

Default log:

    D:\TigerIQ\Logs\animal-city.log

If `D:\TigerIQ` is unavailable, the log falls back under the current user's LocalAppData.

## Tests

    node --test tests/agents-city-tigeriq-bridge.test.mjs

The repository `npm test` chain also includes this suite.

## Safety and evidence rules

- Sole Work Order source is the canonical Core Work Order projection.
- Sole active worker truth is the current Core runtime status projection.
- No browser-side call reaches Core directly; the local server normalizes and bounds both sources.
- User-visible Issue content is rendered with DOM `textContent`.
- GitHub Issue links are reconstructed from validated issue numbers.
- No credentials are read, returned or stored by Animal City.
- No public release, firewall opening, credential mutation or security-boundary change is part of this Work Order.
- No Agent/Animal illustration is treated as an NVxx identity without a verified Core binding.

## Operational acceptance for #5424

C01-C07 are the source/native-E2E foundation.

C08 requires a managed PC01 runtime that can be installed, started, stopped, restarted and read back without an ad-hoc terminal process.

C09 requires real live worker/job evidence in the UI; false or stale bindings must disappear rather than remain cached.

C10 requires a post-restart acceptance receipt proving `/health`, `/ready`, Work Orders, live worker source and rendered browser UI on the actual installed PC01 source before `DONE=true` may be restored.
