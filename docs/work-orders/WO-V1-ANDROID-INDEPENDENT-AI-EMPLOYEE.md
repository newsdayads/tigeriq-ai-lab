# TigerIQ V1 — Android Independent AI Employee

Status: IN_PROGRESS — REPO/BUILD/TEST ONLY; PHYSICAL PC01 E2E PENDING
Branch: `wo-v1/android-independent-ai-employee`
Base lineage: PR #132 exact `21bbb09875a171d5b6003a188e70230c4e87b6d2`

## Owner-approved architecture

PC01 is the control plane and operating-data authority. Each Android phone is an independent AI employee.

Intended runtime path:

`PC01 -> Tailscale -> Android JOB -> phone-owned AI provider API -> Android RESULT/EVIDENCE -> Tailscale -> PC01`

The phone MUST NOT forward the prompt to PC01/TigerIQ so PC01 calls the AI provider on the phone's behalf.

## Reused from prior Android work

Keep:
- Android Keystore device identity and hardware-backed proof;
- Employee/Device identity and authoritative binding;
- activation/provisioning;
- durable checkpoint and encrypted local job/result material;
- lease authority, dedupe/idempotency boundary and bounded retry;
- WorkManager periodic recovery, reboot/app-update recovery and network retry;
- result/evidence submission.

Frozen from execution:
- Accessibility;
- overlay/screen control;
- Gemini-app UI automation;
- legacy foreground UI worker.

## Controller V1 contract — PR #116

The only V1 work protocol is:
- `GET /api/v1/status` — health/compatibility only;
- `POST /api/v1/jobs/lease` — lease next JOB;
- `POST /api/v1/jobs/{jobId}/result` — submit RESULT + evidence;
- `POST /api/v1/devices/{deviceId}/heartbeat` — device heartbeat.

Retired from V1 Android runtime:
- `/v1/android/sessions`;
- `/v1/android/jobs/pull`;
- `/v1/android/jobs/submit`;
- `/v1/inference`.

Authentication uses Android Keystore EC P-256 + `SHA256withECDSA` device proof per PR #116. There is no Android Controller session token.

## V1 phone-owned AI

Provider connector boundary is `AiProviderConnector` + `LocalAiProviderRegistry`.

First connector implementation: Gemini API.
- Gemini API key is stored only in `SecureSecretStore`, encrypted with Android Keystore AES/GCM.
- Provider/model config is local to the phone.
- Provider credential is never included in PC01 activation/provisioning, JOB, RESULT, evidence or logs.

### Issue #150 — zero-cost authority

A locally mutable `free_confirmed`/billing flag is not valid billing authority and has been removed from the execution path.

Current repository truth:
- no local checkbox/string/preference can make an unverified credential executable;
- legacy local billing state is removed/ignored;
- `ZeroCostAuthority.current()` is `unverified` because no independently verifiable provider-side zero-spend boundary is wired;
- `ZeroCostPolicy` blocks execution before Gemini key read/network connection;
- no paid fallback exists;
- Gemini direct remains implemented but **disabled/fail-closed** until an independent enforceable non-billable authority can be added without fabricating billing evidence.

Regression must prove a legacy/local `free_confirmed` claim still produces zero provider calls.

## Standard RESULT payload

Controller V1 receives `result.output` as an object containing:
- `text`;
- `provider`;
- `model`;
- `timestamps`;
- `attempts`;
- `failover`;
- `errors`;
- plus inline `evidence[]` in the same result request.

Provider-attempt metadata is sanitized and checkpointed across bounded retry. Provider secret is excluded.

## Repository gates

Can prove without physical PC01:
- source architecture gate;
- zero-cost authority fail-closed regression without network;
- Controller V1 compatibility against live PR #116 head;
- unit tests;
- debug + unsigned release APK build;
- merged manifest/DEX audit;
- no Accessibility/UI automation packaged;
- no server inference/retired Android work protocol packaged;
- no hard-coded provider secret;
- stable-signing continuity mechanism with disposable CI identity.

Cannot honestly prove without physical PC01/phone/provider-side authority:
- Tailscale reachability;
- live Controller provisioning;
- real JOB-001 lease/result acceptance;
- enforceable provider zero-spend billing authority;
- live Gemini auth/quota/provider result;
- reboot/network physical recovery;
- Z Flip/Z Fold behavior;
- independent exact-head review.

## Physical acceptance remains blocked on zero-cost authority

Physical Gemini JOB execution MUST NOT be attempted until an enforceable independent zero-cost authority exists. Once that separate prerequisite exists, physical acceptance can verify Controller lease -> phone provider execution -> RESULT/evidence -> dedupe/recovery.

No MAIN/Production and no paid-service activation in this work order.
