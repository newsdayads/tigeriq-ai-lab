# TigerIQ AI Employee V1 — Android

Status: repository/build candidate only. Physical PC01/Tailscale/Gemini/Z Flip/Z Fold E2E is not claimed.

## Canonical Controller contract

Android V1 follows the single Controller V1 contract maintained in PR #116. The Android source pins the exact approved Controller head in `ControllerV1Contract.SOURCE_HEAD`, and CI fails if PR #116 moves without a matching Android update.

Work transport is only:

- `GET /api/v1/status` — compatibility/health check only.
- `POST /api/v1/jobs/lease` — receive the next job lease.
- `POST /api/v1/jobs/{jobId}/result` — submit result + evidence atomically.
- `POST /api/v1/devices/{deviceId}/heartbeat` — device health.

Retired and forbidden in V1 runtime:

- `/v1/android/sessions`
- `/v1/android/jobs/pull`
- `/v1/android/jobs/submit`
- `/v1/inference`

There is no Android Controller session token.

## Device identity and authentication

The phone creates an EC P-256 private key in hardware-backed Android Keystore. Every protected lease/result/heartbeat request signs the PR #116 canonical string with `SHA256withECDSA` and sends the required `X-TigerIQ-Device-*` proof headers. The private key never leaves Android Keystore.

Activation is deliberately non-secret: controller URL + Employee ID. The app verifies `/api/v1/status`, creates the phone identity and exposes only a copyable public provisioning record (`employeeId`, `nodeId`, `deviceId`, fingerprint, public key) for PC01 to register in PostgreSQL. Gemini credentials are not part of Controller provisioning.

## Phone-owned AI

PC01 is the work control plane; it does not execute the provider prompt for this Android employee.

`Controller lease -> Android durable checkpoint -> phone-local provider connector -> Gemini API -> Android result/evidence -> Controller result endpoint`

Gemini is the first provider. `LocalAiProviderRegistry` and `AiProviderConnector` keep a provider-neutral boundary for future phone-local providers. The Gemini API key is stored only through Android Keystore-backed encrypted local storage and is excluded from Controller requests, result/evidence and logs.

## Result contract

Completed result uses the PR #116 shape:

```json
{
  "status": "completed",
  "completedAt": "...",
  "output": {
    "text": "...",
    "provider": "gemini",
    "model": "...",
    "timestamps": {},
    "attempts": [],
    "failover": {"used": false},
    "errors": []
  },
  "evidence": []
}
```

Terminal provider failures use `status=failed` and `failure={code,message,retriable}` while still returning sanitized output metadata and evidence.

## Reliability

- WorkManager wake/recovery is periodic and network-constrained.
- Job/lease/idempotency/binding/attempt/result metadata is checkpointed locally.
- Provider retry is bounded by `RetryPolicy`.
- Once a result is persisted, a submit retry reuses that persisted result and does not call Gemini again.
- If Android process/reboot loses the in-process raw lease token, the app does not fabricate authority; it waits for lease expiry/requeue and reacquires through `/api/v1/jobs/lease`.
- Controller duplicate semantics remain authoritative: identical result replay is idempotent; conflicting duplicate is rejected.

## Frozen capability surface

The V1 APK excludes legacy direct-package Android sources from compilation and the merged-manifest/DEX CI gate rejects Accessibility, overlay/screen control, Gemini consumer-app automation, raw process/runtime loaders and privileged data/device permissions. The runtime needs only Internet, notification and boot-recovery permissions.

## Repository readiness gate

`ANDROID_CONTROLLER_V1_CONTRACT_READY` may be posted to PR #140 only after the same exact Android head has all three green:

1. General `CI`.
2. `Android Worker` build/unit/manifest/DEX/signing-continuity workflow.
3. `Android ↔ Controller V1 Contract`, which checks Android against the live PR #116 head and runs focused contract tests.

This marker is repository compatibility evidence only; it is not physical E2E or Production approval.
