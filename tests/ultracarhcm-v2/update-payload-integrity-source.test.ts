// GH-5135 F15/F20 — update payload integrity source contract.
// Source-only verification; does not claim a configured release channel or install acceptance.
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
  it('streams a bounded HTTPS payload without following redirects', () => {
    expect(activity).toContain('instanceFollowRedirects = false');
    expect(activity).toContain('MAX_APK_BYTES');
    expect(activity).toContain('gói cập nhật vượt giới hạn kích thước');
  });

  it('computes SHA-256 and fails closed on metadata mismatch', () => {
    expect(activity).toContain('MessageDigest.getInstance("SHA-256")');
    expect(activity).toContain('UpdateRules.matchesExpectedSha256(metadata.sha256, observedSha256)');
    expect(activity).toContain('throw SecurityException("SHA-256 không khớp metadata")');
    expect(rules).toContain('fun matchesExpectedSha256');
  });

  it('does not hand an unverified URL directly to an installer or browser', () => {
    expect(activity).not.toContain('Intent.ACTION_VIEW');
    expect(activity).not.toContain('startActivity(');
    expect(activity).toContain('Gói chỉ được xác minh tính toàn vẹn');
  });
});
