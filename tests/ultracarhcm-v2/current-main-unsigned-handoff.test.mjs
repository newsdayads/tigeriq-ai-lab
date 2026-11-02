import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(
  new URL('../../apps/ultracarhcm-v2/release/Prepare-UltraCarV2Dev11UnsignedHandoff.ps1',import.meta.url),
  'utf8',
);

test('F10 handoff preparer requires an explicit exact main SHA and clean tracked worktree',()=>{
  assert.match(source,/ValidatePattern\('\^\[0-9a-fA-F\]\{40\}\$'\)/);
  assert.match(source,/git -C \$RepoRoot rev-parse HEAD/);
  assert.match(source,/if\(\$head -cne \$ExpectedMainSha\)/);
  assert.match(source,/EXACT_MAIN_SHA_REQUIRED/);
  assert.match(source,/status --porcelain --untracked-files=no/);
  assert.match(source,/TRACKED_WORKTREE_MUST_BE_CLEAN/);
});

test('F10 handoff preparer builds release without changing source identity',()=>{
  assert.match(source,/:app:assembleRelease/);
  assert.match(source,/app-release-unsigned\.apk/);
  assert.match(source,/expectedPackage='ai\.tigeriq\.ultracarhcm\.v2'/);
  assert.match(source,/expectedVersionCode='11'/);
  assert.match(source,/expectedVersionName='2\.0\.0-dev\.11'/);
  assert.match(source,/HANDOFF_APK_IDENTITY_MISMATCH/);
});

test('F10 handoff preparer proves unsigned input and aligned output fail closed',()=>{
  assert.match(source,/apksigner verify --verbose \$unsigned/);
  assert.match(source,/UNSIGNED_BUILD_UNEXPECTEDLY_SIGNED/);
  assert.match(source,/zipalign -f 4 \$unsigned \$tempOutput/);
  assert.match(source,/zipalign -c -v 4 \$tempOutput/);
  assert.match(source,/ALIGNED_HANDOFF_UNEXPECTEDLY_SIGNED/);
  assert.match(source,/HANDOFF_OUTPUT_ALREADY_EXISTS_NO_OVERWRITE/);
  assert.match(source,/HANDOFF_MANIFEST_ALREADY_EXISTS_NO_OVERWRITE/);
});

test('F10 handoff receipt pins source, artifact digest, identity and signer certificate',()=>{
  for(const expected of [
    "schema='tigeriq.ultracarhcm-v2.unsigned-handoff.v1'",
    'sourceSha=$head',
    'artifactSha256=$artifactSha',
    'requiredSignerCertificateSha256=$expectedSignerCert',
    "signed=$false",
    "production=$false",
  ]) assert.ok(source.includes(expected),expected);
  assert.match(source,/MAIN_'\+\$shortSha/);
  assert.match(source,/F10_UNSIGNED_HANDOFF_PREP_PASS/);
});

test('F10 handoff preparer has no signer, credential, task, device, Drive or Production mutation',()=>{
  assert.doesNotMatch(source,/apksigner\s+sign/i);
  assert.doesNotMatch(source,/ConvertTo-SecureString|ConvertFrom-SecureString|DPAPI|keystore-pass|key-pass/i);
  assert.doesNotMatch(source,/Register-ScheduledTask|Start-ScheduledTask|schtasks/i);
  assert.doesNotMatch(source,/\badb\b|pm\s+grant|am\s+start|install\s+-r/i);
  assert.doesNotMatch(source,/Google Drive|G:\\Drive/i);
  assert.match(source,/INSTALL=NOT_REQUESTED/);
  assert.match(source,/DRIVE=NOT_REQUESTED/);
  assert.match(source,/PRODUCTION=false/);
});
