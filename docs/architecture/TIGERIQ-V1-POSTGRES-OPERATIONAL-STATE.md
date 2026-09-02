# TigerIQ V1 — PostgreSQL Operational State

Status: integration candidate, off MAIN/Production.

## Decision
PC01 PostgreSQL is the production source of live operational state. FileJournal/JSON remain allowed for tests, migration evidence and legacy compatibility only; GitHub remains source/evidence/versioning, not the live job queue.

## Reused contracts
- PR #115: decomposition, dependency DAG, scope locking, idempotency, bounded lease/retry/recovery, evidence gate and independent review semantics.
- PR #126: employee/device separation, device binding, raw lease token never persisted, stale/expired lease rejection and idempotent completed-result replay.

## Normalized data
`employees`, `devices`, `employee_device_bindings`, `ai_providers`, `goals`, `jobs`, `job_dependencies`, `job_scopes`, `leases`, `results`, `evidence`, `prompts`, `reviews`, `prompt_metrics`, `heartbeats`.

## Live-state rules
1. Job creation is idempotent and conflicting replay fails closed.
2. Assignment uses a PostgreSQL transaction plus a transaction advisory lock and `FOR UPDATE SKIP LOCKED`.
3. Dependency readiness and hierarchical scope conflicts are checked before leasing.
4. Only SHA-256 of the lease token is persisted; the raw token exists only in the lease response.
5. Lease expiry is recovered transactionally; retries are bounded by `maxAttempts`.
6. Restart recovery is `recoverExpiredLeases()`; correctness does not depend on an in-memory checkpoint.
7. A completed execution cannot advance without all declared evidence kinds.
8. Independent-review jobs enter `reviewing`; judge-required jobs enter `judging`; only qualifying PASS transitions to `done`.
9. Executor/Reviewer/Judge are separated by normalized `independenceKey`.
10. Prompt text and metrics are local operational records; provider secrets are not stored, only an optional `secretRef`.

## Transport contract
The package is transport-neutral. A PC01 Controller may map routes such as `create JOB`, `lease/assign`, `revoke`, `submit result`, `heartbeat`, `review/judge` directly to `OperationalWorkService`; Android/Web/PC01 runtime code is intentionally outside this change.

## PC01 install candidate
1. Install local PostgreSQL Community and ensure `psql` is in PATH.
2. Create a local database/user according to PC01 security policy.
3. Set `TIGERIQ_DATABASE_URL` locally without embedding a password; use local SSPI/`.pgpass`/`PGPASSWORD` according to policy.
4. Run `scripts/install-work-state-postgres.ps1`.
5. Runtime may install the free Node `pg` driver locally (`npm install --no-save pg@8`) and call `createPgPool()`; repository CI stays lockfile-safe and dependency-free.

No public listener, cloud database, billing, or Vercel durable storage is required.
