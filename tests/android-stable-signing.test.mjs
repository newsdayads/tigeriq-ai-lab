import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const gradle = readFileSync(new URL('../apps/android-worker/app/build.gradle.kts', import.meta.url), 'utf8');
const workflow = readFileSync(new URL('../.github/workflows/android-worker.yml', import.meta.url), 'utf8');
const provision = readFileSync(new URL('../scripts/pc-worker/provision-android-signing.ps1', import.meta.url), 'utf8');

describe('WO-037 Android stable signing', () => {
  it('loads signing material only from local path variables and fails on partial configuration', () => {
    expect(gradle).toContain('TIGERIQ_ANDROID_KEYSTORE');
    expect(gradle).toContain('TIGERIQ_ANDROID_STORE_PASSWORD_FILE');
    expect(gradle).toContain('TIGERIQ_ANDROID_KEY_PASSWORD_FILE');
    expect(gradle).toContain('stable signing configuration is incomplete');
    expect(gradle).toContain('file(storePasswordPath).readText().trim()');
    expect(gradle).not.toMatch(/storePassword\s*=\s*"[^"$]/);
    expect(gradle).not.toMatch(/keyPassword\s*=\s*"[^"$]/);
  });

  it('keeps TigerIQ signing secrets out of CI and proves certificate reuse only with a disposable key', () => {
    expect(workflow).toContain('TIGERIQ_STABLE_SIGNING_NOT_CONFIGURED');
    expect(workflow).toContain('app-release-unsigned.apk');
    expect(workflow).toContain('CI_ONLY_NOT_TIGERIQ_PRIVATE_KEY');
    expect(workflow).toContain('test "$first" = "$second"');
    expect(workflow).toContain('STABLE_SIGNING_CERTIFICATE_REUSE_PASS');
    expect(workflow).not.toContain('F:\\TigerIQ\\Secrets');
  });

  it('provisions one persistent private keystore and pins its fingerprint', () => {
    expect(provision).toContain("F:\\TigerIQ\\Secrets\\android-worker-signing");
    expect(provision).toContain("if (-not (Test-Path $KeyStorePath))");
    expect(provision).toContain('SIGNING_IDENTITY_CHANGED');
    expect(provision).toContain('certificateSha256');
    expect(provision).toContain("'SYSTEM','FullControl','Allow'");
    expect(provision).toContain("'BUILTIN\\Administrators','FullControl','Allow'");
  });
});
