# TigerIQ Workforce Controller V1 — PC01 local-first

Status: repository-prepared only. This package does **not** claim that port 8790 is listening on PC01.

## Fixed deployment boundary

- Host: PC01 only.
- Bind: exactly `100.97.23.87`.
- Port: exactly `8790`.
- Allowed inbound network: Tailscale CGNAT `100.64.0.0/10` only.
- Persistence: PostgreSQL only; startup fails closed when PostgreSQL is unavailable.
- No public/wildcard bind (`0.0.0.0`/`::`).
- No model-controlled raw command/shell endpoint.
- No MAIN/Production checkout, pull or merge in the installer.

## CHAT 03 PostgreSQL handoff contract

No concrete PostgreSQL adapter/schema from CHAT 03 is present in the currently accessible work-management branch. V1 therefore isolates persistence behind `PostgresStore` and expects CHAT 03 to provide only the local DSN handoff file:

`F:\TigerIQ\Secrets\postgres-workforce.dsn`

The file contains one PostgreSQL DSN line, is never committed, and the installer restricts its ACL to SYSTEM and local Administrators. Replacing `PostgresStore` with the final CHAT 03 adapter must not require changing the HTTP API or Scheduled Task contract.

## API V1

- `GET /api/v1/status` and compatibility `GET /api/workforce/status`
- `GET /api/v1/employees`
- `POST /api/v1/employees`
- `POST /api/v1/devices`
- `POST /api/v1/devices/{deviceId}/heartbeat`
- `POST /api/v1/jobs`
- `POST /api/v1/jobs/{jobId}/prompts`
- `POST /api/v1/jobs/lease`
- `POST /api/v1/jobs/{jobId}/lease/heartbeat`
- `POST /api/v1/jobs/{jobId}/evidence`
- `POST /api/v1/jobs/{jobId}/result`

Admin endpoints require `X-TigerIQ-Admin-Secret`. Device endpoints require `X-TigerIQ-Device-Id` plus a bearer token. Device credentials are returned once and only their SHA-256 digest is persisted. Lease credentials are also persisted only as SHA-256 digests.

## PostgreSQL model

Schema creates the bounded operational tables:

`workforce_employee`, `workforce_device`, `workforce_job`, `workforce_prompt`, `workforce_lease`, `workforce_heartbeat`, `workforce_result`, `workforce_evidence`.

Job creation has a unique idempotency key. Leasing uses `FOR UPDATE SKIP LOCKED`. Expired leases are marked expired and their jobs are requeued before the next lease operation. Lease heartbeat has a bounded TTL of 30–900 seconds. Result submission is retry-safe for the same job/lease/device and evidence IDs are idempotent.

## Install/autostart/recovery

`install-workforce-controller-v1.ps1` is a reviewed static installer. It:

1. refuses any host except PC01;
2. verifies the live Tailscale IPv4 is exactly `100.97.23.87`;
3. refuses installation if port 8790 already has an unknown listener;
4. requires the local CHAT 03 PostgreSQL DSN handoff;
5. creates a versioned Python virtual environment and installs pinned `psycopg[binary]`;
6. migrates/checks PostgreSQL before registering runtime;
7. registers `TigerIQ Workforce Controller` as SYSTEM with AtStartup, bounded one-minute restarts, `IgnoreNew`, and a five-minute recovery trigger for late network/Tailscale availability;
8. creates an inbound firewall rule only for local address `100.97.23.87`, port 8790, remote `100.64.0.0/10`;
9. does not start the service unless `-StartNow` is explicitly supplied.

## Deterministic health gate

`health_workforce_controller_v1.py` returns PASS only when all are true:

- Tailscale reports exactly `100.97.23.87`;
- exactly one listener exists on port 8790 and it is bound to `100.97.23.87`;
- there is no wildcard or other-address listener on 8790;
- Scheduled Task `TigerIQ Workforce Controller` exists;
- `GET http://100.97.23.87:8790/api/v1/status` returns HTTP 200 with `ok=true` and `postgres=true`.

## Physical deployment gate for the next PC01 session

Do not close Issue #100 or advance #137 until the following evidence is collected from PC01 in order:

1. Secure Worker V3 + Watchdog status still healthy.
2. Tailscale IPv4 is still exactly `100.97.23.87`.
3. CHAT 03 PostgreSQL DSN handoff file exists locally; PostgreSQL readiness succeeds without exposing the DSN.
4. Run the reviewed installer from the PR #116 branch with explicit start enabled under an authorized SYSTEM/elevated context.
5. Scheduled Task exists and is running or ready with the expected triggers/restart policy.
6. Health gate returns PASS for exact bind, no wildcard/public listener, HTTP 200 and PostgreSQL readiness.
7. Restart the task and repeat the health gate.
8. Only then run reboot/network-loss recovery and physical JOB E2E; record immutable evidence before changing #100/#137 status.

No physical PC01 port, PostgreSQL, reboot or E2E result is asserted by this repository-only preparation.
