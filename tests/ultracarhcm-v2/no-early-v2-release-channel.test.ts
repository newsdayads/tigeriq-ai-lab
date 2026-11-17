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

describe('GH-5135 cannot claim an OTA-ready TEST APK before real full-parity acceptance', () => {
  it('uses owner-accepted V1 Build369 as Golden; S10 Build362 is only auxiliary evidence', () => {
    expect(officialV1.sha256).toBe('07FA280005D71C0D4E38C085C3077ED01B66497E1E3EB54B0C2ED4D7999F038E');
    expect(officialV1.versionCode).toBe(369);
    expect(officialV1.versionName).toBe('1.2.23');
    expect(auxiliaryS10V1.v1.installedMatchesDriveFile).toBe(true);
    expect(auxiliaryS10V1.v1.sha256).toBe(auxiliaryS10V1.v1.installedS10BaseSha256);
    expect(auxiliaryS10V1.v1.embeddedVersionCode).toBe(362);
    expect(auxiliaryS10V1.v1.sha256).not.toBe(officialV1.sha256);
    expect(auxiliaryS10V1.canonicalGolden.sha256).toBe(officialV1.sha256);
    expect(auxiliaryS10V1.v1.baselineRole).toBe('AUXILIARY_S10_UI_ONLY_NOT_GOLDEN');
    expect(features.features).toHaveLength(22);
    expect(features.acceptanceRule).toContain('No row is PASS/ACCEPTED from source evidence alone');
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
