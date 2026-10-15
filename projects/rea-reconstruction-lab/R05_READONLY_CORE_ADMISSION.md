# REA GH-4780 — R05 read-only Core admission diagnostic

**Scope: source-only diagnostic, not lease admission.** This utility does NOT grant access, install REA, alter PC01, claim/release a Core lease, or verify a caller's identity.

## Source and verified real-world gap

[Actual PC01 Core readback](https://github.com/newsdayads/tigeriq-ai-lab/issues/4780#issuecomment-6189075602): on 2026-10-15T09:35:53Z, 14 enabled resources, zero shared leases, **zero NV02 resource rows**. The absence of shared leases does not imply an authorized NV02 writer. Core [live-status](../../apps/tigeriq-core/core.mjs) is a read-only projection; [acquireSharedResourceLease](../../apps/tigeriq-core/shared-resource-lease.mjs) requires an enabled employee-matched resource, and only the authorized Core executor can claim.

## Diagnostic states

The new r05-readonly-core-admission.mjs accepts an untrusted live-status-shaped JSON object. It fails closed for invalid shape, invalid rows, impossible UTC timestamp, stale (>120s) or far-future (>15s) input, or oversized data. Valid snapshots distinguish NV02_RESOURCE_ABSENT, NV02_RESOURCE_BUSY, NV02_RESOURCE_NOT_READY (all NV02 rows blocked by health, credentials, or disabled state) and REAL_ATOMIC_CLAIM_AND_DEVICE_AUTH_REQUIRED. Missing/unknown resource statuses fail closed as INVALID_RESOURCE; ready-looking rows are never authorization. Only fixed status codes and numeric counts are emitted, never lease tokens, resource IDs or provider metadata.

Every result has sourceAuthenticated=false, leaseOwned=false, deviceAuthorized=false, installAuthorized=false, mutated=false. Even a visible idle row does **not** authorize atomic claim or installation.

## CLI and tests

For already-permitted **sanitized** input on an independent machine, pass JSON over stdin, not an arbitrary host path:

~~~sh
node projects/rea-reconstruction-lab/r05-readonly-core-admission.mjs --read-only < sanitized-live-status.json
~~~

CLI output is sanitized fixed JSON; input max 256 KiB. CI tests cover absence, contention, stale reads, bogus lease evidence and actual Node subprocess behavior **of this diagnostic**, not actual REA runtime.

## Next real action

R05 remains **unchecked** until a legitimate executor identity/resource binding, independently authorized device action and Core-issued atomic work/resource/lease receipt with appropriate TTL/heartbeat (and fencing if the actual contract supports it) are read back. No invented lease, no impersonation, no registry mutation. R02 NO-GO, R06 installation and R07 MCP remain separate gates.

## Core status safety regression (15/10/2026)

Core `publicStatus()` distinguishes `WAIT_KEY`, `RATE_LIMITED`, `ERROR`, `OFFLINE`, `DISABLED`, `BUSY`, `ON_DEMAND`, `IDLE`, and `READY`. The read-only projection is *not* an authenticated action grant. When all NV02 rows are unhealthy/disabled or busy, the diagnostic must not suggest a free claim candidate. Added tests cover unknown/missing statuses, five unavailable statuses, mixed contention and health, and CLI no-authorization flags. The actual NV02 resource and device authorization still require separate Core/PC01 receipts. Changes are source-only and do not alter Core, resource registry, leases, PC01, or REA installation.
