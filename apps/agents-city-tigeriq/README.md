# TigerIQ Animal City — Agents City integration stage 1

Authority: Owner-approved Issue #5424. This preview is NOT a second scheduler, a lease service, or proof of native AI worker connections.

## Goal
Apply three Agents City design lessons: agent-first offices, single chair/seat, and a live isometric view. Stage 1 reuses the canonical TigerIQ Core read-only Work Order projection for three Animal-themed rooms.

## Run on PC01 — local only

Requires Node.js >=20 and TigerIQ Core on http://127.0.0.1:8795.

From repository root run:

    node apps/agents-city-tigeriq/server.mjs

Open http://127.0.0.1:8866 on the same PC01.

Tests:

    node --test tests/agents-city-tigeriq-bridge.test.mjs

No new dependencies. Server binds to 127.0.0.1 and exposes only GET /, /app.js, /api/rooms, /health. No public release. Other routes and all mutating HTTP methods are rejected.

## Evidence and access

- Sole source: TigerIQ Core GET /api/work-orders. The projection originates from canonical GitHub Issues. Missing, stale, incomplete and errored source fails closed, showing NO jobs or old status.
- Real lease/worker identity is not supplied by this projection. Animal avatars are illustrations and room grouping is a display suggestion only, NOT actual AI dispatch or running-employee evidence.
- A closed Issue is never automatically shown as DONE. A verified-done display requires independent evidence markers; other closed Issues stay unverified.
- No Core mutation, no GitHub write, no changed credentials. Protected Core and existing Agents City lab stay untouched.
- User-visible Issue data is rendered only with DOM textContent, and links are recreated from validated GitHub issue IDs.
- The browser UI remains isolated on the local PC, with Content-Security-Policy, host validation and no cross-origin access.

## Required acceptance

C01-C03: branch, read-only bridge and Animal UI.
C04-C05: real Node tests, exact-head PR checks, accepted source merge.
C06: approved PC01 release + live browser readback.
C07: separately scoped Core native claim/lease/fencing integration and actual autonomous job acceptance. NOT implemented merely by installing the preview.

The standalone preview follows Agents City v0.5.12 principles, without copying its third-party art/source. Future delegation must use existing Core claim/lease APIs, not a second queue.