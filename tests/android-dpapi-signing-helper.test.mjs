import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { androidReleaseBuildFailureClass } from '../apps/openclaw-tigeriq-runtime/operator.mjs';

const helper = readFileSync(new URL('../scripts/pc-worker/sign-android-worker-with-dpapi.ps1', import.meta.url), 'utf8');
const operator = readFileSync(new URL('../apps/openclaw-tigeriq-runtime/operator.mjs', import.meta.url), 'utf8');

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
    expect(helper).toContain('ANDROID_SDK_ROOT');
    expect(helper).toContain('ANDROID_HOME');
    expect(helper).toContain("Android\\Sdk");
    expect(helper).toContain('build-tools');
    expect(helper).toContain('ANDROID_" + $toolRole + "_DISCOVERY_NO_SDK_ROOT');
    expect(helper).toContain('ANDROID_" + $toolRole + "_DISCOVERY_NO_BUILD_TOOLS_DIR');
    expect(helper).toContain('ANDROID_" + $toolRole + "_DISCOVERY_BINARY_MISSING');
    expect(helper).toContain('[Array]::Clear');
    expect(helper).not.toMatch(/--ks-pass['",\s]+pass:/i);
    expect(helper).not.toMatch(/--key-pass['",\s]+pass:/i);
    expect(helper).not.toContain('Set-Clipboard');
    expect(helper).not.toContain('store-password.txt');
    expect(helper).not.toContain('key-password.txt');
    expect(helper).not.toContain('stderr.Trim()');
    expect(helper).toContain('.Dispose()');
  });

  it('forwards tool arguments without colliding with PowerShell automatic $args', () => {
    expect(helper).toContain('[string[]]$ToolArgs');
    expect(helper).toContain('New-ToolProcessStartInfo $FileName $ToolArgs');
    expect(helper).not.toContain('[string[]]$Args');
    expect(helper).toContain('certificate SHA-256 digest:\\s*([0-9a-fA-F:]+)');
  });

  it('uses a hash-pinned portable apksigner jar without weakening stdin secret transport', () => {
    expect(helper).toContain('ApkSignerJar');
    expect(helper).toContain('ExpectedApkSignerJarSha256');
    expect(helper).toContain('APKSIGNER_JAR_SHA256_REQUIRED');
    expect(helper).toContain('APKSIGNER_JAR_SHA256_MISMATCH');
    expect(helper).toContain('JAVA_RUNTIME_REQUIRED');
    expect(helper).toContain('JAVA_HOME');
    expect(helper).toContain('TIGERIQ_JAVA');
    expect(helper).toContain("apksignerMode = 'portable-pinned-jar'");
    expect(helper).toContain('[switch]$PrealignedInput');
    expect(helper).toContain("if (-not $PrealignedInput)");
    expect(helper).toContain("$signerInput = $unsigned");
    expect(helper).toContain("'--ks-pass', 'stdin'");
    expect(helper).toContain("'--key-pass', 'stdin'");
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

  it('classifies signer helper failures with bounded machine-safe codes', () => {
    expect(helper).toContain("throw 'DPAPI_PASSWORD_DECRYPT_FAILED'");
    const codes = [
      'UNSIGNED_APK_SHA256_MISMATCH',
      'CANONICAL_SIGNING_IDENTITY_RECOVERY_REQUIRED',
      'OUTPUT_APK_MUST_DIFFER_FROM_UNSIGNED_APK',
      'DPAPI_PASSWORD_DECRYPT_FAILED',
      'APK_V2_SIGNATURE_REQUIRED',
      'APK_V3_SIGNATURE_REQUIRED',
    ];
    for (const code of codes) {
      expect(operator).toContain(`'${code}'`);
      expect(androidReleaseBuildFailureClass({ stderr: `PowerShell stopped: ${code}` })).toBe(code);
      expect(androidReleaseBuildFailureClass({ stdout: `diagnostic ${code}` })).toBe(code);
    }
    expect(androidReleaseBuildFailureClass({ stderr: 'unexpected opaque failure' })).toBe('UNCLASSIFIED');
  });
});
