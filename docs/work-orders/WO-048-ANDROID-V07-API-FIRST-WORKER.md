# WO-048 — Android v0.7 API-first thin worker

Status: IN_PROGRESS

Unlock evidence: Gate #130 emitted `CONTRACT_V07_INDEPENDENT_REVIEW_PASS` and `CONTRACT_V07_READY` for exact head `9ce2aea4967c6986601f136b3f7491f8fea8c9ff` on PR #131; CI run `33378194824` PASS.

Baseline: APP PR #109 / `wo012/android-phone-first-worker` exact `96819b4c960d7930c5f5d2105c4df07d4bfcbd00`.

Branch: `wo048/android-v07-api-first-worker`.

## Scope

Implement only Android thin-worker client responsibilities against the locked v0.7 contract. No provider API key, no AI Router ownership, no Web/PC01/Work Management implementation, no MAIN/Production release.

## Required runtime

- Employee/Device enrollment client.
- Hardware-backed Android Keystore signing key; StrongBox preferred when available, TEE/default AndroidKeyStore fallback.
- Challenge signing and short-lived TigerIQ session token lifecycle.
- FCM receiver feeding unique durable work.
- Unique WorkManager execution per job/idempotency identity.
- Durable local checkpoint for retry, reboot and network recovery without assuming in-flight work completed.
- Result/evidence submit through TigerIQ API contract.
- Operator state limited to READY / WORKING / NEED_ATTENTION.
- Accessibility automation is not the v0.7 execution engine.

## Started in M1

- `WorkerState` state contract added.
- `DeviceKeyStore` added with Employee+Device-scoped EC signing identity, AndroidKeyStore hardware backing, StrongBox on Android 9+ when available and safe fallback.
- `DurableCheckpointStore` added for local in-flight job/lease-hash/phase checkpointing.

## Next

1. Enrollment/session API client and token store.
2. WorkManager + FCM integration and dedupe.
3. Result/evidence submit + retry/recovery.
4. UI state wiring; remove Accessibility from readiness/execution path.
5. Android build/tests, exact-head CI, independent review, then physical smoke only. 
