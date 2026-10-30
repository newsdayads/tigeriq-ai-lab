// GH-5135 F15 — canonical V2 TEST update-channel contract.
// Verifies a real metadata endpoint while preserving an explicit no-release state.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const channel = JSON.parse(
  readFileSync(new URL('../../apps/ultracarhcm-v2/release/update-channel.json', import.meta.url), 'utf8'),
);
const strings = readFileSync(
  new URL('../../apps/ultracarhcm-v2/app/src/main/res/values/strings.xml', import.meta.url),
  'utf8',
);
const build = readFileSync(
  new URL('../../apps/ultracarhcm-v2/app/build.gradle', import.meta.url),
  'utf8',
);
const rules = readFileSync(
  new URL('../../apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/UpdateRules.kt', import.meta.url),
  'utf8',
);
const activity = readFileSync(
  new URL('../../apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/UpdateActivity.kt', import.meta.url),
  'utf8',
);

describe('GH-5135 F15 canonical V2 TEST update channel', () => {
  it('pins the app to the canonical repository metadata endpoint', () => {
    const endpoint =
      'https://raw.githubusercontent.com/newsdayads/tigeriq-ai-lab/main/apps/ultracarhcm-v2/release/update-channel.json';
    expect(strings).toContain(endpoint);
    expect(rules).toContain(endpoint);
    expect(rules).toContain('fun isTrustedMetadataUrl');
    expect(activity).toContain('UpdateRules.isTrustedMetadataUrl(endpoint)');
  });

  it('advertises the current dev11 build without fabricating a downloadable release', () => {
    expect(channel).toMatchObject({
      schemaVersion: 1,
      channel: 'ultracarhcm-v2-test',
      packageName: 'ai.tigeriq.ultracarhcm.v2',
      releaseAvailable: false,
      latestVersionCode: 11,
      latestVersionName: '2.0.0-dev.11',
      mandatory: false,
    });
    expect(channel).not.toHaveProperty('apkUrl');
    expect(channel).not.toHaveProperty('sha256');
    expect(build).toContain('versionCode 11');
    expect(build).toContain("versionName '2.0.0-dev.11'");
    expect(channel.releaseNotes).toContain('preview1');
    expect(channel.releaseNotes).toContain('chưa ký');
  });

  it('fails closed until a V2-tagged signed release URL and SHA-256 are published', () => {
    expect(rules).toContain('metadata.releaseAvailable && metadata.latestVersionCode > currentVersionCode');
    expect(rules).toContain('value.startsWith(TRUSTED_RELEASE_PREFIX)');
    expect(rules).toContain('if (safeUrl.isNotEmpty() || safeSha.isNotEmpty()) return null');
    expect(rules).toContain('if (mandatory) return null');
    expect(activity).toContain('if (!metadata.releaseAvailable)');
    expect(activity).toContain('hiện chưa có APK V2 TEST ký số được phát hành');
    expect(activity).not.toContain('Intent.ACTION_VIEW');
  });
});
