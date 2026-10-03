# WO-037 — Android Worker stable signing identity

## Goal
Keep every Android Worker update on the already-established TigerIQ stable signing lineage. The canonical certificate SHA-256 is `63e027c013222139982b4f4ff43aff8734eac4b249fe85e94a3eadfde19c8293` and has been physically proven for in-place updates from v0.7 onward.

## Current design
- the stable identity already exists; **never generate a replacement key** for later releases;
- signer material remains outside GitHub/CI and is supplied to the release script only through an explicitly selected local signing directory;
- the release script requires `TIGERIQ_ANDROID_SIGNING_DIR` or `-SecretsDir`; there is no assumed `F:\TigerIQ` location;
- the selected directory must contain the recovered canonical keystore/password files and a fingerprint pinned to the canonical certificate;
- Gradle receives only signing **paths** through `TIGERIQ_ANDROID_KEYSTORE`, `TIGERIQ_ANDROID_KEY_ALIAS`, `TIGERIQ_ANDROID_STORE_PASSWORD_FILE`, and `TIGERIQ_ANDROID_KEY_PASSWORD_FILE`;
- partial or wrong-signer configuration fails closed;
- CI never receives the TigerIQ private key and continues to build unsigned release artifacts plus disposable signing-contract proof.

## Recovery rule
PC01 currently has legacy protected signer material outside the old documented `F:\TigerIQ\Secrets\android-worker-signing` location. If the canonical signer cannot be exposed through an already-authorized execution path, stop at `CANONICAL_SIGNING_IDENTITY_RECOVERY_REQUIRED`. Do **not** call key generation, copy secrets into the repo, switch signer identity, or publish an unsigned/wrong-signed APK.

## Release gates
1. Android source exact-head checks pass;
2. independent source review passes;
3. release tooling confirms the canonical certificate fingerprint;
4. signed APK verifies against the canonical certificate and records SHA-256;
5. publication happens only after the signing execution path is explicitly authorized;
6. physical Z Flip acceptance remains separate from source/signing evidence.

## Pilot lineage
v0.6 and earlier used disposable debug identities. v0.7 established the stable TigerIQ certificate and required the one-time migration. v0.7+ must preserve the same certificate so subsequent versions update in place.


## DPAPI preferred signing path
- When the existing canonical bundle contains `tigeriq-release.jks`, `signing-password.dpapi.txt`, and `key-alias.txt`, the release builder must prefer the DPAPI/stdin path.
- Gradle builds an unsigned release with signing environment variables cleared; the exact unsigned APK SHA-256 is then bound into `sign-android-worker-with-dpapi.ps1`.
- The protected password is decrypted only under the owning Windows user context and is sent to apksigner through stdin. It is not provisioned into plaintext password files, command-line arguments, environment variables, clipboard, logs, or repository content.
- The helper requires v2 + v3 signatures and the canonical certificate SHA-256 before the release builder accepts the artifact.
- The current release builder accepts only the protected DPAPI bundle. It does not read, create, or fall back to plaintext password files.
