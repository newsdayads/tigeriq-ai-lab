import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const builder = readFileSync(new URL('../scripts/pc-worker/build-android-worker-release.ps1', import.meta.url), 'utf8');

describe('Android stable release builder DPAPI integration', () => {
  it('requires the protected DPAPI bundle and never provisions plaintext password files', () => {
    expect(builder).toContain("signing-password.dpapi.txt");
    expect(builder).toContain("tigeriq-release.jks");
    expect(builder).toContain("sign-android-worker-with-dpapi.ps1");
    expect(builder).toContain("app-release-unsigned.apk");
    expect(builder).toContain("ExpectedUnsignedSha256");
    expect(builder).not.toContain("store-password.txt");
    expect(builder).not.toContain("key-password.txt");
    expect(builder).not.toContain("TIGERIQ_ANDROID_STORE_PASSWORD_FILE =");
    expect(builder).not.toContain("TIGERIQ_ANDROID_KEY_PASSWORD_FILE =");
  });

  it('uses an existing Gradle runtime without requiring a repository wrapper or network install', () => {
    expect(builder).toContain('function Resolve-GradleCommand');
    expect(builder).toContain("'gradle.bat','gradle'");
    expect(builder).toContain("GRADLE_HOME");
    expect(builder).toContain(".gradle\\wrapper\\dists\\gradle-8.7-bin");
    expect(builder).toContain("GRADLE_COMMAND_MISSING");
    expect(builder).toContain("--no-daemon clean :app:assembleRelease");
    expect(builder).not.toContain("Invoke-WebRequest");
    expect(builder).not.toContain("Start-BitsTransfer");
  });

  it('forces unsigned build then validates canonical signer receipt and artifact hash', () => {
    expect(builder).toContain("Remove-Item Env:TIGERIQ_ANDROID_KEYSTORE");
    expect(builder).toContain("63E027C013222139982B4F4FF43AFF8734EAC4B249FE85E94A3EADFDE19C8293");
    expect(builder).toContain("APK_SIGNING_IDENTITY_MISMATCH");
    expect(builder).toContain("DPAPI_SIGNER_RECEIPT_MISSING");
    expect(builder).toContain("DPAPI_SIGNER_RECEIPT_INVALID");
    expect(builder).toContain("APK_SIGNATURE_VERIFY_FAILED");
    expect(builder).toContain("SIGNING_SECRET_SAFETY_VIOLATION");
    expect(builder).toContain("SIGNED_APK_SHA256_MISMATCH");
    expect(builder).toContain("stable-private-pc01-dpapi-stdin");
    expect(builder).toContain("secretsPrinted = $false");
  });
});
