import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../apps/ultracarhcm-v1/release/Invoke-UltraCarTestApk.ps1',import.meta.url),'utf8');
test('parameterized version, code, and verification default',()=>{
  assert.match(source,/\$Version\b/);
  assert.match(source,/\$VersionCode\b/);
  assert.match(source,/\$Mode='VerifyOnly'/);
  assert.match(source,/\^v\(\?:1\\\.0\\\.\)\?/);
});
test('no stage selection by wildcard or dynamic latest',()=>{
  assert.match(source,/\$prefix\+'_signed_TEST\.apk'/);
  assert.match(source,/\$prefix\+'_aligned_TEST\.apk'/);
  assert.doesNotMatch(source,/Get-ChildItem.*\*.*apk|Sort-Object.*LastWriteTime/i);
});
test('local signature acceptance includes identity, v2/v3, pinned cert and sha',()=>{
  for(const term of ['SIGNED_SHA_REQUIRED','SIGNED_SHA_MISMATCH','APK_IDENTITY_MISMATCH','V2_V3_SIGNATURE_REQUIRED','CERTIFICATE_PIN_MISMATCH','LOCAL_APK_VERIFY_PASS'])assert.ok(source.includes(term),term);
});
test('sign refuses overwrite and requires exact aligned hash',()=>{
  for(const term of ['SIGNED_ALREADY_EXISTS_NO_OVERWRITE','EXACT_ALIGNED_APK_MISSING','ALIGNED_SHA_REQUIRED','ALIGNED_SHA_MISMATCH','ZIPALIGN_VERIFY_FAILED','LOCAL_APK_SIGN_PASS'])assert.ok(source.includes(term),term);
});
test('no embedded secrets or Drive side effects',()=>{
  assert.match(source,/--ks-pass 'env:TIGERIQ_ULTRACAR_KS_PASS'/);
  assert.match(source,/--key-pass 'env:TIGERIQ_ULTRACAR_KEY_PASS'/);
  assert.doesNotMatch(source,/--ks-pass\s+pass:|--key-pass\s+pass:|Copy-Item|Remove-Item|Start-ScheduledTask|Register-ScheduledTask|git pull|ExecutionPolicy Bypass/i);
});
test('cloud and device QA remain separately unverified',()=>{
  assert.match(source,/CLOUD=UNVERIFIED\|DEX=UNVERIFIED/);
});
