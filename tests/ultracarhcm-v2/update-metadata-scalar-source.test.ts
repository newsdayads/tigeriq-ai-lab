// GH-5135 F15 — update metadata strict scalar source contract.
// Source-only verification for the configured V2 TEST metadata channel; device/install acceptance remains separate.
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

describe('GH-5135 F15 strict update metadata scalar types', () => {
  it('routes remote JSON through the strict scalar validator', () => {
    expect(activity).toContain('UpdateRules.validateJsonMetadataScalars(');
    expect(activity).toContain('json.opt("latestVersionCode")');
    expect(activity).toContain('json.opt("latestVersionName")');
    expect(activity).toContain('json.opt("releaseAvailable")');
    expect(activity).toContain('if (json.has("apkUrl")) json.opt("apkUrl") else null');
    expect(activity).toContain('if (json.has("sha256")) json.opt("sha256") else null');
  });

  it('does not use coercing JSONObject scalar readers for update metadata', () => {
    expect(activity).not.toContain('json.optLong("latestVersionCode"');
    expect(activity).not.toContain('json.optString("latestVersionName"');
    expect(activity).not.toContain('json.optString("apkUrl"');
    expect(activity).not.toContain('json.optString("sha256"');
    expect(activity).not.toContain('json.optBoolean("releaseAvailable"');
    expect(activity).not.toContain('json.optBoolean("mandatory"');
  });

  it('accepts only typed release state and typed optional release fields', () => {
    expect(rules).toContain('is Int -> latestVersionCode.toLong()');
    expect(rules).toContain('is Long -> latestVersionCode');
    expect(rules).toContain('val versionName = latestVersionName as? String ?: return null');
    expect(rules).toContain('val releaseFlag = releaseAvailable as? Boolean ?: return null');
    expect(rules).toContain('null -> ""');
    expect(rules).toContain('is String -> apkUrl');
    expect(rules).toContain('is String -> sha256');
    expect(rules).toContain('is Boolean -> mandatory');
  });
});
