# TigerIQ AI Lab — Android Worker V1

Status: repository/build preflight candidate only. Physical PC01/Tailscale/pairing/JOB-001 E2E is not claimed until `PC01_PHYSICAL_GO_LIVE_PASS`.

## Canonical Controller contract

Android V1 follows the single Controller V1 contract maintained in PR #116 and pins exact head `c0632bc110ea0d26925d3657ac485cb90b5ee010`. CI fails if PR #116 moves without a matching Android update.

The current physical endpoint is also fail-closed and pinned to Controller #116:

- Tailscale host `100.97.23.87`
- port `8790`
- canonical pilot URL `http://100.97.23.87:8790`

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

Activation is non-secret: canonical Controller URL + Employee ID. The app verifies `/api/v1/status`, creates the phone identity and exposes only a copyable public provisioning record (`employeeId`, `nodeId`, `deviceId`, fingerprint, public key) for PC01 to register in PostgreSQL. A Controller URL that does not match PR #116 fails closed before enrollment.

## Phone-owned AI / zero-cost gate

PC01 is the work control plane; it does not execute the provider prompt for this Android employee. The intended future path remains:

`Controller lease -> Android durable checkpoint -> phone-local provider connector -> provider API -> Android result/evidence -> Controller result endpoint`

Gemini is the first connector implementation, but Gemini direct execution is currently **DISABLED/fail-closed**. A local checkbox, preference, string, stored key or user statement cannot make a credential executable. `ZeroCostAuthority.current()` remains `unverified`; `ZeroCostPolicy` blocks before the API key is read or any provider network connection is opened. There is no paid fallback.

Issue #160 preflight additionally disables the credential-entry controls in the UI so the Owner is not asked to enter a provider secret while direct execution is forbidden.

## Result contract

Completed result uses the PR #116 shape with `output.text/provider/model/timestamps/attempts/failover/errors` plus evidence. Terminal provider/policy failures use `status=failed` and `failure={code,message,retriable}` while still returning sanitized output metadata and evidence. A zero-cost authority denial is non-retryable provider execution and must not call Gemini.

## Reliability

- WorkManager polling/recovery is periodic and network-constrained; the preflight candidate does not depend on Firebase/FCM.
- Job/lease/idempotency/binding/attempt/result metadata is checkpointed locally.
- Provider retry is bounded by `RetryPolicy`.
- Once a result is persisted, a submit retry reuses that persisted result and does not call the provider again.
- If Android process/reboot loses the in-process raw lease token, the app does not fabricate authority; it waits for lease expiry/requeue and reacquires through `/api/v1/jobs/lease`.
- Controller duplicate semantics remain authoritative: identical result replay is idempotent; conflicting duplicate is rejected.

## Permissions and frozen capability surface

The app source declares only `INTERNET` and `RECEIVE_BOOT_COMPLETED`; neither requires an Owner runtime permission prompt. WorkManager may merge its standard internal scheduling permissions into the APK. CI rejects notification/FCM, Accessibility, overlay/screen control, Gemini consumer-app automation, raw process/runtime loaders and privileged data/device permissions.

## Signing / update-in-place

Pilot package identity is fixed at `ai.tigeriq.worker`. Every installable pilot release must use the approved stable certificate SHA-256:

`A1:36:5F:07:F4:25:92:60:A0:6F:A0:33:F7:F8:78:52:1A:3B:08:BD:29:44:FC:16:07:49:46:64:93:7C:C1:AC`

Gradle now rejects any configured `TIGERIQ_ANDROID_KEYSTORE` whose certificate does not match that pinned pilot identity. CI intentionally has no pilot private key and proves a disposable/wrong identity is rejected. Physical install remains fail-closed: if the currently installed APK signer differs, do not uninstall or clear data.

The current preflight version is `versionCode=13`, `versionName=1.0.1-ai-employee-preflight`. The APK embeds the exact Git commit SHA in `BuildConfig.TIGERIQ_SOURCE_SHA` for physical provenance checking.

## Repository readiness gate

Issue #160 can reach `ANDROID_WORKER_PREFLIGHT_READY_WAITING_PC01` only when the same exact Android head has all three green:

1. General `CI`.
2. `Android Worker` build/unit/manifest/DEX/provenance/wrong-signer rejection workflow.
3. `Android ↔ Controller V1 Contract`, including exact Controller head + host/port + route matching.

This status is repository compatibility and install-candidate evidence only; it is not physical pairing, JOB-001, provider billing proof, MAIN or Production approval.
