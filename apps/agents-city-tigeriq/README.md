# TigerIQ Animal City — operational local product

Authority: Owner-approved Work Order #5424.

Animal City is a loopback-only TigerIQ operator view. It reads canonical Work Orders from TigerIQ Core and separately reads live Core runtime evidence for active workers/jobs. It is not a second scheduler or lease service. Owner actions can submit a new LOCAL/P2 objective exclusively through the existing Core API after explicit in-browser confirmation.

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
    GET /api/owner-config
    GET /api/owner-objectives
    POST /api/owner-objectives  (only after confirmation; LOCAL P2)

All other mutating HTTP methods are rejected. Host validation restricts use to localhost. The one POST action requires same-origin, CSRF token, one-use idempotency key, bounded body, and is passed to Core POST /api/objectives without a parallel queue.

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

    node --test tests/agents-city-tigeriq-bridge.test.mjs tests/animal-city-owner-actions.test.mjs

The repository `npm test` chain also includes this suite.

## Safety and evidence rules

- Sole Work Order source is the canonical Core Work Order projection.
- Sole active worker truth is the current Core runtime status projection.
- No browser-side call reaches Core directly; the local server normalizes and bounds both read sources, and forwards only a verified Owner action through the authorized Core endpoint.
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


## Interactive Animal Office 3D — visual extension

The office scene uses browser-native WebGL 1.0 with low-poly geometric
animal avatars (tiger, fox, panda), office rooms, desks, chairs, wall
windows, computers and plants. It requires **no CDN, API key, game engine
or new npm dependency**. Drag to orbit, wheel to zoom, click an office in
the model or its accessible text tab to view that department's Core data.
Use **Góc chuẩn** to reset the camera.

The floorplan is a visualization, not a second job orchestrator.
All mascots are decorative and remain visually idle unless the existing
Core live binding declares both `liveWorkerBindingsVerified=true` and a
worker with `activeWorkerVerified=true`. Only then may that department
show the working LED and subtle breathing motion.

This extension is **not** native Agents City Committee dispatch, and does
not claim that TigerIQ can autonomously finish a full task. Work Order
data and evidence continue to come exclusively from TigerIQ Core.

To verify an operational update on PC01: confirm the installed exact
source SHA; GET http://127.0.0.1:8866/health, GET /ready and /scene3d.js,
then open the local UI in Chrome and validate WebGL rendering,
orbit/zoom/selection, verified-worker-only lighting and Core work cards.
Do not claim UI accepted from a CI test alone.


## Owner console / actual controls (GH-5453)

The browser can now submit a new, explicit LOCAL/P2 objective to the existing Core `POST /api/objectives`. Core must return an `OBJ-...` receipt. This is *accepted for scheduling*, not an AI execution or completion claim. Provider selection remains Core-owned and the objective's `routingProfile: LOCAL` is enforced at the existing Core router, with no paid-model fallback. User confirmation is required; no automated or background objective creation by the UI. A bounded latest-objectives read via Core `GET /api/status` shows objective state and the available latest job associations, clearly marked as a partial status window. Work Order search and state filter are visual only, with real links to canonical GitHub issues. All other Core authority and TigerIQ permission gates remain unchanged.

Acceptance of the Owner controls requires actual POST success with Core receipt and subsequent status readback on PC01. Source CI alone is not a live-workflow acceptance.
