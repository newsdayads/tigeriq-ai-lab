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


## DPAPI → apksigner helper (source-only until Owner execution authorization)
- `scripts/pc-worker/sign-android-worker-with-dpapi.ps1` is the approved design candidate for the current legacy bundle `tigeriq-release.jks + signing-password.dpapi.txt + key-alias.txt`.
- The helper binds the run to the caller-supplied unsigned APK SHA-256, zipaligns before signing, and requires APK Signature Scheme v2 + v3.
- The encrypted PowerShell SecureString is decrypted only in the owning Windows user context. The managed helper writes password characters only to the apksigner standard-input pipe for `--ks-pass stdin` and `--key-pass stdin`; it does not place the password in command-line arguments, environment variables, files, clipboard, stdout, or repository content.
- The temporary BSTR and character buffer are zeroed after use.
- The signed output is accepted only when the certificate SHA-256 is exactly `63e027c013222139982b4f4ff43aff8734eac4b249fe85e94a3eadfde19c8293`; wrong/partial outputs are deleted fail-closed.
- Source/CI/review of this helper does **not** authorize credential use. Executing it with the real signer, publishing an APK, or updating release metadata remains a separate Owner-authorized security action.
