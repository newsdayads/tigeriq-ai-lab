# WO-047 — Android v0.7 Employee/Device/Job Core

Priority: P0
Status: READY FOR INDEPENDENT REVIEW AFTER FINAL CI
Tracking: GitHub issue #124
Branch: `wo047/android-worker-core-v07`
Stacked base: `wo044/work-management-system`

## Scope
Only Workforce/Work Management core contracts for an Android thin worker. No APP UI/runtime, AI Router/Model Router, PC01 runtime, MAIN or Production changes.

## Real-state audit
Existing Workforce already provided worker nodes, employee records, pairing credentials, durable task mailbox, remote task broker, FileJournal persistence and retry/recovery. The missing boundary for Android v0.7 was a provider-independent Employee identity and explicit Device identity/lifecycle: Employee↔Device binding, enrollment/revoke/lost/replacement, employee-isolated queue/memory/evidence namespaces, and a durable pull/submit job protocol whose authorization is bound to both employee and device.

## Canonical identity rules
- `Employee ID` is the durable company identity. It contains no provider/model account or provider credential.
- `Device ID` is a durable installation/device identity, separate from Employee ID.
- One active Employee↔Device binding is allowed at a time in v0.7.
- Replacement must use a new Device ID and a new Binding ID.
- Lost/revoked/replaced devices cannot pull jobs or submit new results.
- Role and permissions belong to Employee identity; device binding proves which enrolled device may act for that Employee.

## Namespace rules
For employee `EMP-X`:
- queue: `workforce:v07:employee:EMP-X:queue`
- memory: `workforce:v07:employee:EMP-X:memory`
- evidence: `workforce:v07:employee:EMP-X:evidence`

Jobs are stored under the employee queue namespace. Cross-employee lookup/pull is rejected by construction and authorization.

## Durable job lifecycle
`enqueue -> queued -> pull -> leased -> submit -> completed|failed`

- enqueue dedupes by employee + idempotency key and rejects semantic conflict;
- leases are device/binding-bound and store only a SHA-256 token hash in FileJournal;
- stale/wrong-device/wrong-binding/wrong-token results fail closed;
- completed result requires evidence;
- retriable failure and expired lease requeue only while attempts remain;
- reboot recovery reconstructs identity/job state from FileJournal; in-flight expired work is never assumed complete;
- duplicate completed submit is idempotent only when result content matches.

## Android thin worker API contract
Shared machine-readable contract: `schemas/android-worker-v07.schema.json`.

Core module: `packages/workforce/src/android-v07/`:
- `types.ts` — Employee/Device/Binding/Job/API contracts;
- `registry.ts` — durable enrollment/revoke/lost/replacement + authorization;
- `queue.ts` — durable namespaced lease/dedupe/retry/recovery;
- `api.ts` — pull/submit boundary + deterministic mock Android worker;
- `index.ts` — exports.

The core never invokes or selects an AI model/provider. A caller may supply deterministic job execution to the mock worker; provider routing remains outside this package.

## Evidence/tests
`tests/android-worker-v07-core.test.ts` proves:
1. Job → Employee → Device → Result/Evidence end-to-end;
2. Employee identity has no provider/credential field;
3. queue/device isolation between two employees;
4. duplicate enqueue/result handling and conflicting replay rejection;
5. reboot + expired lease recovery + bounded retry;
6. lost/revoked device rejection and replacement with a new binding.

## Release gates
- final exact-head Typecheck + Unit + Playwright + Build PASS;
- independent review of exact diff/schema/tests;
- no APP/AI Router/PC01 runtime files changed;
- no MAIN/Production merge without Owner authorization.
