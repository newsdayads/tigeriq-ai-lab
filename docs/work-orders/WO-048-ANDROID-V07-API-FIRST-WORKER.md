# WO-048 — Android v0.7 API-first thin worker

Status: IN_PROGRESS — DEVICE-SMOKE USABLE / BACKEND JOB HTTP INTEGRATION BLOCKED

Branch: `wo048/android-v07-api-first-worker`  
Current Android head: `75bec04526b5338f03d560a0461fd85dc69ca44d`  
PR: #132

## Scope

Implement only Android thin-worker client responsibilities against the locked v0.7 contract. No provider API key, no AI Router ownership, no Web/PC01 implementation, no MAIN/Production release.

## Current Android runtime

- Employee/Device enrollment client.
- Hardware-backed Android Keystore signing key; StrongBox preferred when available, TEE/default AndroidKeyStore fallback.
- Challenge signing and short-lived TigerIQ session token lifecycle.
- FCM wake receiver plus 15-minute WorkManager polling fallback.
- Unique WorkManager execution per job/idempotency identity.
- Durable local checkpoint for retry, reboot and network recovery without assuming in-flight work completed.
- Result/evidence submit client through TigerIQ API contract.
- Operator state limited to READY / WORKING / NEED_ATTENTION.
- Accessibility automation is not the v0.7 execution engine.

## v0.7.1 owner-usable onboarding

Physical install of v0.7 on Samsung proved the APK launched but exposed four backend-oriented fields (Gateway, Employee ID, Credential ID, bootstrap token). That was not owner-usable.

v0.7.1 replaces that flow with:
- `KIỂM TRA MÁY NÀY`: immediately verifies hardware-backed Android Keystore and WorkManager on the real phone without requiring a Gateway.
- One-field activation: `TIQ1.<base64url(JSON)>` containing HTTPS gateway, Employee ID, Credential ID and one-time bootstrap token.
- The one-time activation value is cleared from UI state before network enrollment and is not durably persisted.
- No new Android permission, Accessibility, overlay, provider key or external-app automation is introduced.

Exact-head gates for `75bec045...`:
- CI run `33538342552`: PASS.
- Android Worker run `33538342649`: PASS — bank-safe source gate, Android unit tests, debug + unsigned release build, merged APK manifest/DEX audit, signing continuity, artifacts.
- Debug artifact `9812663263`.
- Unsigned release artifact `9812663854`.

## Real integration blocker found during physical-test audit

The Android client calls:
- `POST /v1/android/jobs/pull`
- `POST /v1/android/jobs/submit`

The current Inference Gateway HTTP server branch exposes session/inference/health routes, while the cross-stream Android package currently provides `AndroidThinWorkerApi` as a TypeScript class but not a deployed HTTP route surface for these two Android endpoints.

Therefore a successful enrollment alone would still not prove real Job → Inference → Result/Evidence end-to-end. This is a backend integration dependency, not an Android UI problem. Android must not fake READY until authoritative deployed endpoints exist.

## Remaining release gates

1. Backend owning stream must expose authoritative authenticated Android job pull/submit HTTP routes compatible with the v0.7 contract and current coordinator/gateway stack.
2. Generate a real one-time TigerIQ activation code from that deployed environment.
3. Z Flip smoke: `KIỂM TRA MÁY NÀY`, activation, real Job → Inference → Result/Evidence, reboot/network recovery, no duplicate job.
4. Z Fold smoke with the same exact candidate lineage.
5. Fresh independent exact-head review.
6. Approved stable TigerIQ signing identity for final pilot candidate.

Keep PR draft / do-not-merge. No MAIN/Production release without the remaining gates and explicit Owner authorization.
