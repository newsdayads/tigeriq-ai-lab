import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const script = readFileSync(new URL('../scripts/pc-worker/build-android-worker-release.ps1', import.meta.url), 'utf8');

test('stable release bundle consumes private signing paths without copying secrets', () => {
  assert.match(script, /F:\\TigerIQ\\Secrets\\android-worker-signing/);
  assert.match(script, /TIGERIQ_ANDROID_KEYSTORE/);
  assert.match(script, /TIGERIQ_ANDROID_STORE_PASSWORD_FILE/);
  assert.match(script, /TIGERIQ_ANDROID_KEY_PASSWORD_FILE/);
  assert.doesNotMatch(script, /Copy-Item[^\n]*(store-password|key-password|\.jks)/i);
  assert.match(script, /secretsIncluded\s*=\s*\$false/);
  assert.match(script, /secretsPrinted\s*=\s*\$false/);
});

test('stable release bundle verifies exact certificate and APK digest', () => {
  assert.match(script, /apksigner(?:\.bat)?/i);
  assert.match(script, /APK_SIGNING_IDENTITY_MISMATCH/);
  assert.match(script, /Get-FileHash[^\n]*SHA256/);
  assert.match(script, /certificateSha256/);
  assert.match(script, /apkSha256/);
});

test('stable release bundle fails closed until PC01 key is provisioned', () => {
  assert.match(script, /STABLE_SIGNING_NOT_PROVISIONED/);
  assert.match(script, /APKSIGNER_MISSING/);
  assert.match(script, /ANDROID_RELEASE_BUILD_FAILED/);
  assert.match(script, /APK_SIGNATURE_VERIFY_FAILED/);
});
