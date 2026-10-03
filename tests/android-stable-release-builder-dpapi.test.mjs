import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const builder = readFileSync(new URL('../scripts/pc-worker/build-android-worker-release.ps1', import.meta.url), 'utf8');

describe('Android stable release builder DPAPI integration', () => {
  it('prefers the protected DPAPI bundle without provisioning plaintext password files', () => {
    expect(builder).toContain("signing-password.dpapi.txt");
    expect(builder).toContain("tigeriq-release.jks");
    expect(builder).toContain("if ($dpapiReady)");
    expect(builder).toContain("sign-android-worker-with-dpapi.ps1");
    expect(builder).toContain("app-release-unsigned.apk");
    expect(builder).toContain("ExpectedUnsignedSha256");
    expect(builder).not.toContain("Set-Content -LiteralPath $legacyStorePasswordFile");
    expect(builder).not.toContain("Set-Content -LiteralPath $legacyKeyPasswordFile");
  });

  it('retains only a pre-provisioned legacy fallback and validates the canonical signer', () => {
    expect(builder).toContain("$legacyReady");
    expect(builder).toContain("store-password.txt");
    expect(builder).toContain("key-password.txt");
    expect(builder).toContain("certificate-sha256.txt");
    expect(builder).toContain("63E027C013222139982B4F4FF43AFF8734EAC4B249FE85E94A3EADFDE19C8293");
    expect(builder).toContain("APK_SIGNING_IDENTITY_MISMATCH");
  });

  it('fails closed on receipt, signature, or artifact mismatch', () => {
    expect(builder).toContain("DPAPI_SIGNER_RECEIPT_MISSING");
    expect(builder).toContain("DPAPI_SIGNER_RECEIPT_INVALID");
    expect(builder).toContain("APK_SIGNATURE_VERIFY_FAILED");
    expect(builder).toContain("SIGNING_SECRET_SAFETY_VIOLATION");
    expect(builder).toContain("SIGNED_APK_SHA256_MISMATCH");
    expect(builder).toContain("secretsPrinted = $false");
  });
});
