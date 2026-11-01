// GH-5135 F15/F20 — update payload integrity + verified installer handoff contract.
// Source-only verification; does not claim a published signed release or device install acceptance.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const activity = readFileSync(
  new URL('../../apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/UpdateActivity.kt', import.meta.url),
  'utf8',
);
const rules = readFileSync(
  new URL('../../apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/UpdateRules.kt', import.meta.url),
  'utf8',
);

describe('GH-5135 F15/F20 update payload integrity', () => {
  it('streams a bounded HTTPS payload through an explicit trusted redirect chain', () => {
    expect(activity).toContain('instanceFollowRedirects = false');
    expect(activity).toContain('MAX_APK_BYTES');
    expect(activity).toContain('MAX_REDIRECTS = 3');
    expect(activity).toContain('UpdateRules.isTrustedV2PayloadUrl(current)');
    expect(activity).toContain('gói cập nhật vượt giới hạn kích thước');
  });

  it('computes SHA-256 and fails closed on metadata mismatch', () => {
    expect(activity).toContain('MessageDigest.getInstance("SHA-256")');
    expect(activity).toContain('UpdateRules.matchesExpectedSha256(metadata.sha256, observedSha256)');
    expect(activity).toContain('throw SecurityException("SHA-256 không khớp metadata")');
    expect(rules).toContain('fun matchesExpectedSha256');
  });

  it('verifies persisted APK identity and signer before enabling Android installer', () => {
    const verifyStart = activity.indexOf('private fun verifyCandidateIdentity');
    const installerStart = activity.indexOf('private fun launchSystemInstaller');
    expect(verifyStart).toBeGreaterThanOrEqual(0);
    expect(installerStart).toBeGreaterThan(verifyStart);

    const verifyBlock = activity.slice(verifyStart, installerStart);
    expect(verifyBlock).toContain('candidate.packageName != packageName');
    expect(verifyBlock).toContain('candidateCode != metadata.latestVersionCode');
    expect(verifyBlock).toContain('UpdateRules.matchesPinnedSignerSha256');
    expect(verifyBlock).toContain('candidateSigner.equals(installedSigner, ignoreCase = true)');

    const successStart = activity.indexOf('onSuccess = { candidate ->');
    const successEnd = activity.indexOf('onFailure = {', successStart);
    const successBlock = activity.slice(successStart, successEnd);
    expect(successBlock).toContain('verifiedApk = candidate');
    expect(successBlock).toContain('installButton.visibility = View.VISIBLE');
    expect(successBlock).not.toContain('launchSystemInstaller(');
  });

  it('requires an explicit user action and Android permission/confirmation for installation', () => {
    expect(activity).toContain('setOnClickListener');
    expect(activity).toContain('launchSystemInstaller(candidate)');
    expect(activity).toContain('packageManager.canRequestPackageInstalls()');
    expect(activity).toContain('Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES');
    expect(activity).toContain('FileProvider.getUriForFile');
    expect(activity).toContain('Intent(Intent.ACTION_VIEW)');
    expect(activity).toContain('Android vẫn yêu cầu người dùng xác nhận trước khi cài');
    expect(activity).not.toMatch(/adb\s+install|pm\s+install|Runtime\.getRuntime|ProcessBuilder/);
  });
});
