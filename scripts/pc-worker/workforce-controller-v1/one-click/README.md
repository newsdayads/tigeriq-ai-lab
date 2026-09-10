# PC01 One-Click Go-Live — Issue #156

Status: `PC01_ONE_CLICK_BOOTSTRAP_READY` — repository/CI preparation only. Physical execution remains forbidden until Sếp is at PC01 and explicitly authorizes the run.

## Single entry point

Run only:

`PC01-GO-LIVE.cmd`

The launcher elevates and invokes `Invoke-PC01-OneClickGoLive.ps1 -ExecutePhysical`. Sếp does not need to copy multiple PowerShell fragments.

## Source-of-Truth runtime basis

- Controller PR #116 exact `c0632bc110ea0d26925d3657ac485cb90b5ee010`.
- PostgreSQL PR #141 exact `6f12d3c5f3da1616041fa48fadf8a4e8b41e7ad9`.
- Migration 001 blob `33445fd07133b5e58f2b33ee3996bf49e6547fa3`.
- Migration 002 blob `90e842318f3cf47caf671890e4bbe435cd35e8b6`.
- Bootstrap branch must be `wo056/pc01-one-click-bootstrap` at the exact current remote head, with a clean working tree. The installer never auto-checkouts/switches MAIN or another branch.

## Audit before mutation

The wrapper records Git/branch/SHA/dirty state, Node/npm, PostgreSQL/psql and PostgreSQL Windows services, Tailscale, Ollama, OpenClaw, TigerIQ/OpenClaw Scheduled Tasks, relevant processes and port 8790 ownership before any runtime mutation.

Policy:
- compatible Git/Node/Tailscale/Ollama are reused;
- Ollama remains optional fallback only;
- OpenClaw is observed but never connected, authenticated, enabled or started by this package;
- non-conflicting TigerIQ Worker/Watchdog tasks are retained;
- only known Controller/port-authority conflicts may be stopped/disabled;
- unknown port 8790 owner causes fail-closed, never blind kill/uninstall.

## Canonical PostgreSQL behavior

`Ensure-PC01PostgresRuntime.ps1` has exactly two safe paths:

1. Reuse an already configured canonical local TigerIQ PostgreSQL URL plus SYSTEM-readable protected `.pgpass`.
2. If PostgreSQL is absent, install free PostgreSQL 16 via WinGet/EDB unattended using a temporary ACL-protected option file, then create canonical local role/database and protected runtime credentials.

Canonical configuration:
- service on a fresh install: `TigerIQPostgreSQL16`;
- host: `127.0.0.1`;
- port: `5432`;
- database: `tigeriq`;
- role: `tigeriq_runtime`;
- password is never embedded in the DB URL, runner, repository, evidence or console output;
- runtime DB URL: protected local file;
- credential: protected `workforce-controller-v1.pgpass`, consumed through `PGPASSFILE` by psql and the SYSTEM Controller task.

If PostgreSQL already exists but TigerIQ cannot prove which datastore/credential is canonical, bootstrap fails with `POSTGRES_EXISTING_UNMANAGED`. It does not create a second TigerIQ datastore.

## Migration boundary

The only authorized migration state is exactly:
1. `001_operational_state_v1`
2. `002_device_proof_replay_v1`

`003_business_state_v2` is planned/design-only and must not be present or applied. Any unreviewed migration row causes fail-closed.

## Controller install

The package builds the reviewed Controller, applies/verifies exact 001+002, then installs:
- Scheduled Task: `TigerIQ Workforce Controller`;
- principal: `SYSTEM`;
- bind: only `100.97.23.87:8790`;
- firewall: inbound allow only from Tailscale `100.64.0.0/10` to `100.97.23.87:8790`;
- autostart and restart/recovery policy enabled.

## Health and restart verification

Health must confirm all of:
- correct Tailscale identity `100.97.23.87`;
- SYSTEM task exists and is Running/Ready;
- exactly one port 8790 listener and it is bound to `100.97.23.87` only;
- exact Tailscale firewall boundary;
- `/api/v1/status`: `ok=true`, `protocol=controller-v1`, `postgres=true`, Controller basis migration field `001_operational_state_v1`;
- the same PostgreSQL datastore contains exactly migrations 001+002 and `device_proof_replay_state`;
- migration 003 absent.

Restart verification stops/starts only the canonical Controller task, reruns health, and proves migration state plus durable replay-state row count survive the Controller restart.

## Evidence and rollback

Every physical attempt writes redacted evidence under `F:\TigerIQ\Evidence\pc01-one-click` and a rollback manifest. Rollback is intentionally non-destructive:
- remove/restore canonical Controller task as recorded;
- restore firewall snapshot;
- re-enable only legacy tasks disabled by that attempt;
- do not blindly restart stopped unknown processes;
- do not drop PostgreSQL tables/databases;
- do not uninstall prerequisites;
- retain migrations 001+002 and operational data.

No MAIN/Production merge, paid service, destructive uninstall, OpenClaw reconnect or physical execution is authorized by this preparation package.
