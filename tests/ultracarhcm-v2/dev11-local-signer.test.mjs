import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../../apps/ultracarhcm-v2/release/Sign-UltraCarV2Dev11LocalTask.ps1',import.meta.url),'utf8');

test('dev11 signer is pinned to exact artifact, app identity and certificate',()=>{
  for(const expected of [
    'UltraCarHCM_V2_2.0.0_dev11_MAIN_f22c408aa_UNSIGNED_ALIGNED_HANDOFF.apk',
    'UltraCarHCM_V2_2.0.0_dev11_MAIN_f22c408aa_SIGNED_TEST.apk',
    '7562C77C4C3C81A9764179AB55007BA5F25BDAE5E1C9255D5D545BF962F0064C',
    '71617043EACE89E5F220EA9168B0A9592808111B0F17EAA219F5E6ECEB569558',
    'ai.tigeriq.ultracarhcm.v2',
    "expectedVersionCode='11'",
    "expectedVersionName='2.0.0-dev.11'"
  ]) assert.ok(source.includes(expected), expected);
});

test('dev11 signer is local-user and exact-output only',()=>{
  assert.match(source,/PC01\\wdragons12x/);
  assert.match(source,/SIGNED_OUTPUT_ALREADY_EXISTS_NO_OVERWRITE/);
  assert.match(source,/DEV11_INPUT_SHA_MISMATCH/);
  assert.match(source,/DEV11_ZIPALIGN_VERIFY_FAILED/);
  assert.match(source,/DEV11_APK_IDENTITY_MISMATCH/);
  assert.doesNotMatch(source,/Copy-Item -Force|Get-ChildItem.*\.apk/i);
});

test('dev11 signer uses existing local DPAPI enrollment and erases process secrets',()=>{
  assert.match(source,/TigerIQ\\UltraCarSigner/);
  assert.match(source,/ConvertTo-SecureString/);
  assert.match(source,/env:TIGERIQ_ULTRACAR_KS_PASS/);
  assert.match(source,/env:TIGERIQ_ULTRACAR_KEY_PASS/);
  assert.match(source,/ZeroFreeBSTR/);
  assert.match(source,/Remove-Item Env:\\TIGERIQ_ULTRACAR_KS_PASS/);
  assert.match(source,/Remove-Item Env:\\TIGERIQ_ULTRACAR_KEY_PASS/);
  assert.doesNotMatch(source,/Read-Host|ConvertFrom-SecureString|Register-ScheduledTask|schtasks\s+\/create|--ks-pass\s+pass:|--key-pass\s+pass:/i);
});

test('dev11 signer verifies temporary output before publishing final output',()=>{
  assert.match(source,/\.tmp-'\+\[guid\]::NewGuid/);
  assert.match(source,/apksigner verify --verbose --print-certs \$tempOutput/);
  assert.match(source,/DEV11_CERTIFICATE_PIN_MISMATCH/);
  assert.match(source,/DEV11_SIGNED_IDENTITY_MISMATCH/);
  assert.match(source,/Move-Item -LiteralPath \$tempOutput -Destination \$output/);
  assert.match(source,/Remove-Item -LiteralPath \$tempOutput -Force/);
});

test('dev11 signer verifies v2 v3 certificate and signed package identity',()=>{
  assert.match(source,/Verified using v2 scheme/);
  assert.match(source,/Verified using v3 scheme/);
  assert.match(source,/DEV11_CERTIFICATE_PIN_MISMATCH/);
  assert.match(source,/DEV11_SIGNED_IDENTITY_MISMATCH/);
});

test('dev11 signer has no Drive, install, production or task-creation mutation',()=>{
  assert.match(source,/DRIVE=NOT_REQUESTED/);
  assert.match(source,/INSTALL=NOT_REQUESTED/);
  assert.match(source,/PRODUCTION=false/);
  assert.doesNotMatch(source,/adb\s+install|Start-ScheduledTask|Register-ScheduledTask|Google Drive|G:\\Drive|Production release/i);
});
