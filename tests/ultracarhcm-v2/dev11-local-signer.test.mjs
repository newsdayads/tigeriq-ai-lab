import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../../apps/ultracarhcm-v2/release/Sign-UltraCarV2Dev11LocalTask.ps1',import.meta.url),'utf8');

test('dev11 signer is pinned to exact artifact, app identity and certificate',()=>{
  for(const expected of [
    'UltraCarHCM_V2_2.0.0_dev11_MAIN_9140534_UNSIGNED_ALIGNED_HANDOFF.apk',
    'UltraCarHCM_V2_2.0.0_dev11_MAIN_9140534_SIGNED_TEST.apk',
    '73EF300739F7C356B7F6939EAC52246D8FEBA43B62335D40B9CA526E86E9D03C',
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
  assert.doesNotMatch(source,/Copy-Item -Force|Remove-Item.*SIGNED_TEST|Get-ChildItem.*\.apk/i);
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

test('dev11 signer verifies v2 v3 certificate and signed package identity',()=>{
  assert.match(source,/apksigner verify --verbose --print-certs/);
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
