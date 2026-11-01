// GH-5135 F15/F20 — canonical V2 TEST update channel + user-confirmed installer handoff.
// Source-only evidence; does not prove a signed release exists or that Android device installation passed.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) =>
  readFileSync(new URL('../../' + path, import.meta.url), 'utf8');

const channel = JSON.parse(read('apps/ultracarhcm-v2/release/update-channel.json'));
const strings = read('apps/ultracarhcm-v2/app/src/main/res/values/strings.xml');
const build = read('apps/ultracarhcm-v2/app/build.gradle');
const rules = read('apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/UpdateRules.kt');
const activity = read('apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/UpdateActivity.kt');
const manifest = read('apps/ultracarhcm-v2/app/src/main/AndroidManifest.xml');
const providerPaths = read('apps/ultracarhcm-v2/app/src/main/res/xml/update_file_paths.xml');

describe('GH-5135 F15/F20 canonical V2 TEST update channel', () => {
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
    expect(activity).not.toContain('downloadAndVerify(metadata)\n                launchSystemInstaller');
  });

  it('allows only bounded trusted HTTPS release redirects before reading payload bytes', () => {
    expect(rules).toContain('fun isTrustedV2PayloadUrl');
    expect(rules).toContain('"release-assets.githubusercontent.com"');
    expect(rules).toContain('"objects.githubusercontent.com"');
    expect(activity).toContain('private fun openTrustedPayloadConnection');
    expect(activity).toContain('instanceFollowRedirects = false');
    expect(activity).toContain('MAX_REDIRECTS = 3');
    expect(activity).toContain('URI(current).resolve(location).toString()');
    expect(activity).toContain('UpdateRules.isTrustedV2PayloadUrl(current)');
  });

  it('persists candidate privately and verifies hash package version and signer before enabling install', () => {
    expect(activity).toContain('File(cacheDir, "updates")');
    expect(activity).toContain('FileOutputStream(target, false)');
    expect(activity).toContain('output.fd.sync()');
    expect(activity).toContain('UpdateRules.matchesExpectedSha256(metadata.sha256, observedSha256)');
    expect(activity).toContain('packageManager.getPackageArchiveInfo(file.absolutePath, flags)');
    expect(activity).toContain('candidate.packageName != packageName');
    expect(activity).toContain('candidateCode != metadata.latestVersionCode');
    expect(activity).toContain('EXPECTED_SIGNER_SHA256');
    expect(activity).toContain('UpdateRules.matchesPinnedSignerSha256(EXPECTED_SIGNER_SHA256, candidateSigner)');
    expect(activity).toContain('candidateSigner.equals(installedSigner, ignoreCase = true)');
    expect(activity).toContain('installButton.visibility = View.VISIBLE');
  });

  it('hands only the verified cache file to Android system installer with user permission gates', () => {
    expect(build).toContain("implementation 'androidx.core:core-ktx:1.12.0'");
    expect(manifest).toContain('android.permission.REQUEST_INSTALL_PACKAGES');
    expect(manifest).toContain('android:name="androidx.core.content.FileProvider"');
    expect(manifest).toContain('android:authorities="${applicationId}.fileprovider"');
    expect(manifest).toContain('android:resource="@xml/update_file_paths"');
    expect(providerPaths).toContain('<cache-path name="verified_updates" path="updates/"/>');
    expect(activity).toContain('Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES');
    expect(activity).toContain('packageManager.canRequestPackageInstalls()');
    expect(activity).toContain('FileProvider.getUriForFile');
    expect(activity).toContain('Intent(Intent.ACTION_VIEW)');
    expect(activity).toContain('Intent.FLAG_GRANT_READ_URI_PERMISSION');
    expect(activity).toContain('Android vẫn yêu cầu người dùng xác nhận trước khi cài');
    expect(activity).not.toMatch(/adb\s+install|pm\s+install|Runtime\.getRuntime|ProcessBuilder/);
  });
});
