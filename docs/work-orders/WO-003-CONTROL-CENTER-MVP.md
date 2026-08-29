# Work Order — WO-003 TigerIQ Control Center MVP

Status: IMPLEMENTED / CI PENDING

## Goal
Give the Owner a local evidence-backed web surface showing what the Company OS is running: active Work Orders, blocked work, gate failures, evidence counts and release eligibility.

## Scope
- Build dashboard summaries directly from Control Plane snapshots.
- Expose list() on in-memory and durable Control Plane implementations.
- Serve a local loopback Control Center HTML page and `/api/status` JSON endpoint.
- Keep the surface read-only; no workflow mutations, credentials, MAIN or Production changes.

## Acceptance criteria
- Dashboard reflects real Work Order snapshots rather than hard-coded state.
- Active/blocked/failing gate/evidence metrics are deterministic.
- Release eligibility fails closed unless every tracked Work Order is verified with passing evidence.
- Durable runtime returns latest snapshot per Work Order.
- Local Control Center returns HTML and machine-readable status.
- Automated tests, typecheck, Playwright smoke and build pass in CI.

## Invariants
No MAIN/Production mutation. No secret provisioning. Control Center is loopback/local by default and read-only in this MVP.
