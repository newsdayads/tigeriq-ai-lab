# WO-038 — Android Worker Stable Release Bundle

Status: IN_REVIEW

## Goal
Create a deterministic PC01-side release path that turns the already-approved private stable signing identity into a verified Android Worker APK without moving private keys/passwords into GitHub, CI, logs or artifacts.

## Scope
- Add `scripts/pc-worker/build-android-worker-release.ps1`.
- Require the WO-037 private signing directory and pinned certificate fingerprint.
- Build `assembleRelease` with path-only Gradle signing variables.
- Verify the produced APK with `apksigner` and reject certificate mismatch.
- Compute APK SHA-256 and emit a redacted release manifest under `F:\TigerIQ\Releases\android-worker\<version>`.
- Add deterministic static safety tests.

## Gates
- Repository CI PASS on exact head.
- Android Worker workflow PASS where applicable.
- Queue Hygiene PASS.
- Vercel deployment is not required: this WO changes only PC01 release tooling/tests/docs and the known Hobby daily deployment quota must not be retried.

## Physical boundary
Merge means `READY_FOR_STABLE_SIGNED_RELEASE_BUILD` only. It does not prove the TigerIQ private keystore exists, an APK was signed with it, a phone was installed/updated, Controller pairing succeeded, heartbeat occurred, or Gemini automation ran. Those require physical evidence.
