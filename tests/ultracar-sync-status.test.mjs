import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  buildSyncComment,
  buildWorkOrderBody,
  buildWorkOrderTitle,
  loadManifests,
  prepareReleaseManifests,
  syncIssueWithGh,
  validateReleaseManifestConsistency,
} from '../apps/ultracarhcm-v1/release/sync-ultracar-status.mjs';
import { parseOpenWorkIssue } from '../api/live-status.mjs';
import { validateWorkOrderLifecycleV2 } from '../apps/tigeriq-core/work-order-lifecycle-v2.mjs';

test('version.json and current-release.json stay strictly synchronized', () => {
  const { versionData, releaseData } = loadManifests(process.cwd());
  assert.doesNotThrow(() => validateReleaseManifestConsistency(versionData, releaseData));
  assert.equal(versionData.versionCode, 359);
  assert.equal(versionData.versionName, '1.2.13');
  assert.equal(versionData.latestVersionCode, 359);
  assert.equal(versionData.latestVersionName, '1.2.13');
});

test('generated #5129 issue satisfies both live-status dashboard and lifecycle-v2 gates', () => {
  const { versionData, releaseData } = loadManifests(process.cwd());
  const title = buildWorkOrderTitle(releaseData);
  const body = buildWorkOrderBody(versionData, releaseData);

  const issue = {
    number: 5129,
    title,
    body,
    state: 'open',
    created_at: '2026-10-22T06:00:42Z',
    updated_at: '2026-11-12T03:50:00Z',
    html_url: 'https://github.com/newsdayads/tigeriq-ai-lab/issues/5129',
    user: { login: 'newsdayads' },
    labels: [],
  };

  const lifecycle = validateWorkOrderLifecycleV2(issue);
  assert.equal(lifecycle.required, true);
  assert.equal(lifecycle.valid, true, `Lifecycle V2 missing fields: ${lifecycle.missing.join(', ')}`);

  const parsed = parseOpenWorkIssue(issue);
  assert.ok(parsed, 'parseOpenWorkIssue should return a valid row');
  assert.equal(parsed.status, 'OWNER_GATE');
  assert.equal(parsed.ownerGate, true);
  assert.equal(parsed.technicalComplete, true);
  assert.equal(parsed.ownerApprovalPending, true);
  assert.equal(parsed.progressChecklistVerified, true);
  assert.equal(parsed.progressTotal, 5);
  assert.equal(parsed.progressDone, 4);
  assert.equal(parsed.progressPercent, 80);
  assert.match(parsed.title, /1\.2\.13/);
});

test('dry-run CLI helper succeeds cleanly and sync comment contains structured state', () => {
  const { releaseData } = loadManifests(process.cwd());
  const comment = buildSyncComment(releaseData);
  assert.match(comment, /^<!-- ULTRACAR_SYNC_V359_/);
  assert.match(comment, /CURRENT_STATE=READY_FOR_OWNER_APPROVAL/);
  assert.match(comment, /DONE=false/);

  const res = syncIssueWithGh({ root: process.cwd(), dryRun: true });
  assert.equal(res.ok, true);
  assert.equal(res.dryRun, true);
  assert.equal(res.issue, 5129);
  assert.equal(res.versionCode, 359);
  assert.equal(res.versionName, '1.2.13');
});

test('manifest mismatch fails closed', () => {
  const { versionData, releaseData } = loadManifests(process.cwd());
  assert.throws(
    () => validateReleaseManifestConsistency({ ...versionData, versionCode: 335 }, releaseData),
    /Version code mismatch/,
  );
  assert.throws(
    () => validateReleaseManifestConsistency({ ...versionData, sha256: '0'.repeat(64) }, releaseData),
    /SHA-256 mismatch/,
  );
});

test('prepareReleaseManifests computes SHA-256 & updates both manifests atomically', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'ultracar-prep-'));
  try {
    mkdirSync(join(scratch, 'apps/ultracarhcm-v1/release'), { recursive: true });
    copyFileSync('version.json', join(scratch, 'version.json'));
    copyFileSync(
      'apps/ultracarhcm-v1/release/current-release.json',
      join(scratch, 'apps/ultracarhcm-v1/release/current-release.json'),
    );
    const dummyApk = join(scratch, 'UltraCar_v1.2.14.apk');
    const dummyPayload = 'dummy-apk-payload-for-test';
    writeFileSync(dummyApk, dummyPayload, 'utf8');

    const { versionData, releaseData } = prepareReleaseManifests({
      root: scratch,
      apk: dummyApk,
      versionCode: 360,
      versionName: '1.2.14',
      notes: 'Test bump',
    });

    assert.equal(versionData.versionCode, 360);
    assert.equal(versionData.versionName, '1.2.14');
    assert.equal(releaseData.releaseTag, 'v1.2.14');
    assert.equal(releaseData.sizeBytes, Buffer.byteLength(dummyPayload, 'utf8'));
    assert.equal(versionData.sha256, releaseData.sha256);
    assert.equal(
      JSON.parse(readFileSync(join(scratch, 'version.json'), 'utf8')).versionCode,
      360,
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
