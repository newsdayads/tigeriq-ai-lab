# TigerIQ Workforce Controller V1 — PC01 ↔ Android canonical contract

Status: repository integration only. This document does **not** claim that PC01 is physically listening on port 8790 today.

## One communication path

Android must use the Controller V1 routes below. The legacy Android-only routes are retired for V1 integration and must not be implemented on PC01:

- retired: `/v1/android/sessions`
- retired: `/v1/android/jobs/pull`
- retired: `/v1/android/jobs/submit`

Canonical Android ↔ PC01 routes:

- `POST /api/v1/jobs/lease` — receive the next job lease.
- `POST /api/v1/jobs/{jobId}/result` — return result and evidence in one atomic submission.
- `POST /api/v1/devices/{deviceId}/heartbeat` — employee/device health.
- `GET /api/v1/status` — Controller/PostgreSQL health; not an Android work-authorization endpoint.

There is no Android session store and no separate Android evidence store.

## One operational datastore

The production persistence contract is the PostgreSQL operational-state model from PR #141:

- migration: `db/migrations/001_operational_state_v1.sql`
- service: `packages/work-state/src/service.ts`
- repository: `packages/work-state/src/postgres-repository.ts`
- driver boundary: `packages/work-state/src/pg-driver.ts`

Canonical tables include `employees`, `devices`, `employee_device_bindings`, `jobs`, `leases`, `results`, `evidence`, `heartbeats`, `prompts`, and related operational tables from migration `001_operational_state_v1`.

The former #116 `workforce_*` Python schema/store has been removed. Controller startup fails closed when PostgreSQL or migration `001_operational_state_v1` is unavailable.

## Device authentication contract for CHAT 02

Every Android work request is authenticated directly; no session mint is required.

Android keeps its EC P-256 private key in Android Keystore and signs with `SHA256withECDSA`. The Controller requires these headers on every protected request:

- `X-TigerIQ-Device-Proof-V: 1`
- `X-TigerIQ-Employee-Id`
- `X-TigerIQ-Node-Id`
- `X-TigerIQ-Device-Id`
- `X-TigerIQ-Device-Key-Fingerprint`
- `X-TigerIQ-Device-Public-Key` — X.509/SPKI DER encoded as standard Base64
- `X-TigerIQ-Device-Timestamp` — epoch milliseconds
- `X-TigerIQ-Device-Nonce`
- `X-TigerIQ-Device-Challenge`
- `X-TigerIQ-Device-Signature` — Base64URL ECDSA signature

Canonical string, byte-for-byte:

`METHOD\nPATH\nEMPLOYEE_ID\nNODE_ID\nDEVICE_ID\nTIMESTAMP_MS\nNONCE\nSHA256(BODY_BYTES)`

`X-TigerIQ-Device-Challenge` is the lowercase SHA-256 hex of that canonical UTF-8 string. The signature is over the canonical UTF-8 string itself.

PC01 authorizes only when PostgreSQL has:

- active `employees.employee_id`;
- active `devices.device_id`;
- active `employee_device_bindings` for that exact employee/device pair;
- matching `devices.public_key_fingerprint`;
- matching `devices.metadata.publicKeyBase64`.

Capabilities and permissions used for job assignment come from PostgreSQL, never from Android request claims. Timestamp skew is bounded and duplicate nonce use in the running Controller process is rejected.

## Lease request

`POST /api/v1/jobs/lease`

Body may be empty or contain only:

```json
{"leaseTtlMs":120000}
```

Allowed TTL is 15 seconds to 15 minutes. PC01 derives employee/device/binding/capabilities/permissions from authenticated PostgreSQL state and calls PR #141 `OperationalWorkService.assignNextJob()` with `workerKind=device`.

Success returns:

```json
{
  "ok": true,
  "lease": {
    "leaseId": "...",
    "leaseToken": "...",
    "jobId": "...",
    "employeeId": "...",
    "deviceId": "...",
    "bindingId": "...",
    "attempt": 1,
    "expiresAt": "...",
    "job": {"jobId":"...","idempotencyKey":"...","payload":{}}
  }
}
```

`lease=null` means no eligible job. Android must checkpoint `jobId`, `idempotencyKey`, `bindingId`, `leaseId`, attempt and expiry. Lease authority must not be submitted after expiry.

## Result + evidence submission

`POST /api/v1/jobs/{jobId}/result`

Body:

```json
{
  "leaseId": "...",
  "leaseToken": "...",
  "result": {
    "status": "completed",
    "completedAt": "2026-09-02T00:00:00.000Z",
    "output": {
      "text": "AI output",
      "provider": "gemini",
      "model": "...",
      "timestamps": {},
      "attempts": [],
      "failover": {"used": false},
      "errors": []
    },
    "evidence": [
      {
        "kind": "json",
        "ref": "tigeriq://EMP/JOB/phone-ai-result.json",
        "summary": "Phone executed provider directly; secret excluded",
        "sha256": "64-lowercase-hex"
      }
    ]
  }
}
```

Important for CHAT 02: `result.output` is an **object**, not the old plain string. Provider/model/timestamps/provider attempts/failover/errors belong inside that output object. Evidence is submitted inline with the result and PR #141 persists it in canonical `evidence` within the same result transaction.

For failure, use `status=failed` plus `failure={code,message,retriable}`.

## Duplicate/expiry/restart semantics

PR #141 is authoritative:

- job creation uses idempotency keys;
- assignment uses PostgreSQL transaction locking and `FOR UPDATE SKIP LOCKED`;
- one active lease per job is enforced;
- device lease requires the active employee/device binding;
- lease token is stored only as SHA-256;
- an identical result retry for the same job attempt returns the existing persisted result;
- a conflicting duplicate result is rejected;
- stale/invalid/expired lease submissions are rejected;
- expired leases are marked expired and their jobs requeued when attempts remain;
- Controller startup calls `recoverAfterRestart()` before listening, so PostgreSQL reconstructs operational authority after PC01 restart.

Android should retain its encrypted durable checkpoint from #140. If its in-process lease token is lost after Android process/reboot, it must not fabricate authority; it waits for/reacquires work after the old lease expires and PC01 recovery requeues the job.

## PC01 network/deployment boundary

- Host: PC01 only.
- Bind: exactly `100.97.23.87`.
- Port: exactly `8790`.
- Firewall inbound remote range: Tailscale `100.64.0.0/10` only.
- No `0.0.0.0`, `::`, LAN/public alternate listener.
- No model-controlled raw shell/PowerShell endpoint.
- No MAIN/Production checkout/pull/merge in the installer.
- No paid service.

`install-workforce-controller-v1.ps1` prepares the Node Controller, free `pg@8` runtime adapter, canonical PR #141 migration, SYSTEM Scheduled Task, startup/retry recovery and Tailscale-only firewall. It does not start the Controller unless `-StartNow` is explicitly supplied.

`health-workforce-controller-v1.ps1` passes only when Tailscale is exactly `100.97.23.87`, the Scheduled Task exists, port 8790 has exactly the expected listener and no other listener, migration `001_operational_state_v1` is present, and `/api/v1/status` reports `protocol=controller-v1` and `postgres=true`.

## Repository integration gate

`.github/workflows/wo045-pc01-android-postgres-integration.yml` boots PostgreSQL 16 in CI and simulates:

Android EC device proof → Controller authentication → PostgreSQL binding → job lease → heartbeat → result + evidence → duplicate retry/conflict checks → simulated PC01 restart → expired-lease recovery → status.

Repository READY does not equal physical PC01 READY. Physical installation/listener/reboot/E2E remains a later explicit gate.
