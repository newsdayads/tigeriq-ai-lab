import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const helper = readFileSync(new URL('../scripts/pc-worker/sign-android-worker-with-dpapi.ps1', import.meta.url), 'utf8');

describe('Android DPAPI apksigner helper', () => {
  it('binds signing to the established certificate and exact unsigned artifact', () => {
    expect(helper).toContain('63E027C013222139982B4F4FF43AFF8734EAC4B249FE85E94A3EADFDE19C8293');
    expect(helper).toContain('ExpectedUnsignedSha256');
    expect(helper).toContain('UNSIGNED_APK_SHA256_MISMATCH');
    expect(helper).toContain('APK_SIGNING_IDENTITY_MISMATCH');
    expect(helper).toContain('APK_V2_SIGNATURE_REQUIRED');
    expect(helper).toContain('APK_V3_SIGNATURE_REQUIRED');
  });

  it('uses DPAPI SecureString and stdin instead of command-line, file or clipboard password transport', () => {
    expect(helper).toContain('ConvertTo-SecureString');
    expect(helper).toContain("'--ks-pass', 'stdin'");
    expect(helper).toContain("'--key-pass', 'stdin'");
    expect(helper).toContain('ZeroFreeBSTR');
    expect(helper).toContain('[Array]::Clear');
    expect(helper).not.toMatch(/--ks-pass['",\s]+pass:/i);
    expect(helper).not.toMatch(/--key-pass['",\s]+pass:/i);
    expect(helper).not.toContain('Set-Clipboard');
    expect(helper).not.toContain('store-password.txt');
    expect(helper).not.toContain('key-password.txt');
  });

  it('never provisions or rotates signing identity', () => {
    expect(helper).not.toContain('genkeypair');
    expect(helper).not.toContain('New-RandomSecret');
    expect(helper).toContain('CANONICAL_SIGNING_IDENTITY_RECOVERY_REQUIRED');
  });

  it('deletes wrong or partial signed outputs fail closed', () => {
    expect(helper).toContain("Remove-Item -LiteralPath $output, ($output + '.idsig')");
    expect(helper).toContain('plaintextSecretPrinted = $false');
    expect(helper).toContain('plaintextSecretWrittenToDisk = $false');
    expect(helper).toContain("passwordTransport = 'stdin-only'");
  });
});
