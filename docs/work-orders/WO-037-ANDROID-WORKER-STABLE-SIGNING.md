# WO-037 — Android Worker stable signing identity

## Goal
Stop Android Worker upgrades from depending on disposable CI debug certificates. Establish one persistent TigerIQ Worker signing identity that stays private on company-controlled runtime storage and can sign every later pilot/release APK with the same certificate.

## Design
- private keystore lives under `F:\TigerIQ\Secrets\android-worker-signing` by default; never repository, logs or CI artifacts;
- password values live in separate ACL-restricted local files and are never passed as source-code literals;
- Gradle reads only **paths** from `TIGERIQ_ANDROID_KEYSTORE`, `TIGERIQ_ANDROID_KEY_ALIAS`, `TIGERIQ_ANDROID_STORE_PASSWORD_FILE`, `TIGERIQ_ANDROID_KEY_PASSWORD_FILE`;
- partial signing configuration fails closed;
- CI has no TigerIQ private key. CI builds an unsigned release artifact and separately proves the signing wiring with a disposable CI-only key by signing two consecutive builds and requiring the same certificate fingerprint;
- PC01 provisioning creates the persistent key once and pins its SHA-256 certificate fingerprint. Future provisioning fails if the identity changes.

## Gates
1. Android Worker CI builds debug + unsigned release without TigerIQ secrets;
2. disposable CI signing proof shows two consecutive signed release builds use one certificate;
3. static tests verify private-path/env boundary and no embedded passwords/keystore;
4. exact-head CI + Android Worker + Queue Hygiene + Vercel Verify PASS before merge;
5. merge is only `READY_FOR_STABLE_SIGNING_PROVISION`; actual TigerIQ signing identity is not claimed until PC01 creates it and two real stable-signed APKs verify the same certificate.

## Pilot migration
The currently installed Z Flip 7 pilot may require **one** uninstall/reinstall when moving from the earlier disposable debug certificate to the permanent TigerIQ signing identity. After that migration, later Worker versions must update in place using the same signing certificate.
