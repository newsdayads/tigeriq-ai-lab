// GH-5135 F22 signing identity source contract.
// Static assertions verify current-signer selection only; release/device acceptance remains separate.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const activity = readFileSync(
  new URL('../../apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/RecoveryActivity.kt', import.meta.url),
  'utf8',
);
const rules = readFileSync(
  new URL('../../apps/ultracarhcm-v2/app/src/main/java/ai/tigeriq/ultracarhcm/v2/RecoveryRules.kt', import.meta.url),
  'utf8',
);

describe('GH-5135 F22 current signing identity source contract', () => {
  it('uses the current certificate at the end of single-signer rotation history', () => {
    expect(activity).toContain('signingInfo.signingCertificateHistory');
    expect(activity).toContain('?.lastOrNull()');
    expect(activity).not.toContain('signingCertificateHistory\n            }\n        } else {\n            info.signatures\n        }\n        val certificate = signatures?.firstOrNull()');
  });

  it('includes every current APK signer when the package has multiple signers', () => {
    expect(activity).toContain('if (signingInfo.hasMultipleSigners())');
    expect(activity).toContain('signingInfo.apkContentsSigners?.toList().orEmpty()');
    expect(activity).toContain('val fingerprints = signatures.map { certificate ->');
    expect(activity).toContain('RecoveryRules.formatSigningSha256(fingerprints)');
  });

  it('renders signer fingerprints deterministically without inventing release provenance', () => {
    expect(rules).toContain('.distinct()');
    expect(rules).toContain('.sorted()');
    expect(rules).toContain('joinToString("\\n")');
    expect(activity).toContain('Không tự hạ phiên bản, không cài APK');
  });
});
