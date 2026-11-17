// The OTA release flag is not an escape hatch around GH-5135 hardware QA.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assessFullParityRelease } from '../../apps/ultracarhcm-v2/release/check-full-parity.mjs';

const root = process.cwd();
const release = JSON.parse(readFileSync(resolve(root, 'apps/ultracarhcm-v2/release/update-channel.json'), 'utf8'));
const features = JSON.parse(readFileSync(resolve(root, 'tests/ultracarhcm-v2/f01-f22-source-matrix.json'), 'utf8'));
const auxiliaryS10V1 = JSON.parse(readFileSync(resolve(root, 'tests/ultracarhcm-v2/v1-2-31-evidence.json'), 'utf8'));
const officialV1 = JSON.parse(readFileSync(resolve(root, 'apps/ultracarhcm-v1/release/current-release.json'), 'utf8'));
const goldenArtifact = JSON.parse(readFileSync(resolve(root, 'tests/ultracarhcm-v2/golden-v1-build369-label-vs-manifest362-evidence.json'), 'utf8'));

describe('GH-5135 cannot claim an OTA-ready TEST APK before real full-parity acceptance', () => {
  it('distinguishes Owner release label from actual signed Golden APK metadata and S10 auxiliary', () => {
    expect(officialV1.sha256).toBe('07FA280005D71C0D4E38C085C3077ED01B66497E1E3EB54B0C2ED4D7999F038E');
    expect(officialV1.versionCode).toBe(369);
    expect(officialV1.versionName).toBe('1.2.23');
    expect(goldenArtifact.status).toBe('VERIFIED_UNRESOLVED');
    expect(goldenArtifact.actualSignedFile.sha256).toBe(officialV1.sha256);
    expect(goldenArtifact.actualSignedFile.embeddedVersionCode).toBe(362);
    expect(goldenArtifact.actualSignedFile.embeddedVersionName).toBe('1.2.16');
    expect(goldenArtifact.releaseLabel.versionCode).toBe(369);
    expect(goldenArtifact.independentVerification.temporaryCopyRemoved).toBe(true);
    expect(goldenArtifact.actualSignedFile.embeddedVersionCode).not.toBe(officialV1.versionCode);
    expect(auxiliaryS10V1.v1.installedMatchesDriveFile).toBe(true);
    expect(auxiliaryS10V1.v1.sha256).toBe(auxiliaryS10V1.v1.installedS10BaseSha256);
    expect(auxiliaryS10V1.v1.embeddedVersionCode).toBe(362);
    expect(auxiliaryS10V1.v1.sha256).not.toBe(officialV1.sha256);
    expect(auxiliaryS10V1.canonicalGolden.sha256).toBe(officialV1.sha256);
    expect(auxiliaryS10V1.v1.baselineRole).toBe('AUXILIARY_S10_UI_ONLY_NOT_GOLDEN');
    expect(features.features).toHaveLength(22);
    expect(features.acceptanceRule).toContain('No row is PASS/ACCEPTED from source evidence alone');
  });

  it('pins unresolved Golden Build369 filename vs embedded Build362 as a release blocker', () => {
    const result = assessFullParityRelease(null);
    expect(result.canPublish).toBe(false);
    expect(result.blockers).toContain('GOLDEN_V1_BUILD369_RELEASE_LABEL_VS_EMBEDDED_BUILD362_UNRESOLVED');
    expect(release.releaseAvailable).toBe(false);
  });

  it('requires a separately verified complete device acceptance receipt before OTA release flag', () => {
    const receipt = resolve(root, 'apps/ultracarhcm-v2/release/full-parity-accepted.json');
    const observed = existsSync(receipt)
      ? assessFullParityRelease(JSON.parse(readFileSync(receipt, 'utf8')))
      : assessFullParityRelease(null);
    if (release.releaseAvailable === true) {
      expect(existsSync(receipt)).toBe(true);
      expect(observed.canPublish).toBe(true);
    } else {
      expect(release.releaseAvailable).toBe(false);
      expect(observed.canPublish).toBe(false);
    }
  });
});
