import { describe, expect, it } from 'vitest';
import {
  assessFullParityRelease,
  mandatoryFeatureIds,
  mandatoryHardwareIds,
  mandatoryRegressionIds,
} from '../../apps/ultracarhcm-v2/release/check-full-parity.mjs';

const fullSha = 'A'.repeat(64);
const evidence = 'B'.repeat(64);
const cert = 'C'.repeat(64);
const v1Sha = '07FA280005D71C0D4E38C085C3077ED01B66497E1E3EB54B0C2ED4D7999F038E';
const accepted = (id: string) => ({
  id, status: 'ACCEPTED', signedApkSha256: fullSha,
  deviceId: 'REAL_DEVICE_WITH_VERIFIABLE_RECEIPT',
  evidenceSha256: evidence, acceptedAt: '2026-11-17T06:30:00+07:00',
});

function hypotheticalAcceptedFixture() {
  return {
    signedApk: {
      packageName: 'ai.tigeriq.ultracarhcm.v2',
      sha256: fullSha,
      certificateSha256: cert,
      verifiedV2: true,
      verifiedV3: true,
    },
    sourceGitSha: 'E'.repeat(64),
    v1Baseline: { sha256: v1Sha, versionCode: 369, versionName: '1.2.23' },
    features: Object.fromEntries(mandatoryFeatureIds.map(id => [id, accepted(id)])),
    regressions: Object.fromEntries(mandatoryRegressionIds.map(id => [id, accepted(id)])),
    hardware: Object.fromEntries(mandatoryHardwareIds.map(id => [id, accepted(id)])),
    ownerMediaRightsVerified: true,
    adminLicenseBackendVerified: true,
    ownerFinalAcceptance: true,
  };
}

describe('GH-5135 fail-closed full-parity release gate (logic test, NOT real acceptance)', () => {
  it('must never publish when proofs are absent', () => {
    const r = assessFullParityRelease(null);
    expect(r.canPublish).toBe(false);
    expect(r.blockerCount).toBeGreaterThan(35);
    expect(r.blockers).toContain('GEAR_R_PHYSICAL_MISSING_PHYSICAL_EVIDENCE');
    expect(r.blockers).toContain('OWNER_FINAL_ACCEPTANCE_MISSING');
    expect(r.blockers).toContain('SIGNED_APK_SHA_MISSING');
  });
  it('requires all 22 source groups plus 10 latest regression behaviors and hardware gates', () => {
    expect(mandatoryFeatureIds).toHaveLength(22);
    expect(mandatoryRegressionIds).toHaveLength(10);
    expect(mandatoryHardwareIds).toContain('DEX_EXTERNAL');
    expect(mandatoryHardwareIds).toContain('USB_UVC_PHYSICAL');
    const fixture = hypotheticalAcceptedFixture();
    fixture.features.F05.status = 'SOURCE_ONLY_NOT_ACCEPTED';
    fixture.hardware.DEX_EXTERNAL.evidenceSha256 = '';
    const r = assessFullParityRelease(fixture);
    expect(r.canPublish).toBe(false);
    expect(r.blockers).toContain('F05_MISSING_DEVICE_ACCEPTANCE');
    expect(r.blockers).toContain('DEX_EXTERNAL_MISSING_PHYSICAL_EVIDENCE');
  });
  it('rejects the mislabeled S10 V1.2.31 internal Build362 as a Golden release substitute', () => {
    const mock = hypotheticalAcceptedFixture();
    mock.v1Baseline.sha256 = 'D8B8DE0A454ACB88E911AD11331EFF91884714466EF8B4554807D8D3447F82FC';
    mock.v1Baseline.versionCode = 362;
    mock.v1Baseline.versionName = '1.2.16';
    const result = assessFullParityRelease(mock);
    expect(result.canPublish).toBe(false);
    expect(result.blockers).toContain('GOLDEN_V1_1223_BUILD369_IDENTITY_NOT_PINNED');
  });

  it('can pass only a structurally complete hypothetical set; mock input is NOT an APK', () => {
    const mock = hypotheticalAcceptedFixture();
    const result = assessFullParityRelease(mock);
    expect(result.canPublish).toBe(true);
    expect(result.blockers).toEqual([]);
    mock.signedApk.sha256 = 'not-a-sha';
    expect(assessFullParityRelease(mock).canPublish).toBe(false);
  });
});
